import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEVICE_RETRIES,
  DEVICE_RETRY_DELAY_MS,
  SpotifyApiError,
  describeApiError,
  startPlayback,
  transferPlayback,
} from '../src/main/spotify';
import { FakeSpotify } from './helpers/fake-spotify';

const TOKEN = 'secret-access-token';
const PLAY = '/v1/me/player/play';
const TRANSFER = '/v1/me/player';
const TRACK = 'spotify:track:4cOdK2wGLETKBW3PvgPWqT';

let fake: FakeSpotify;
let waits: number[];

/** Dependencies that point the client at the fake server and make "waiting" instant but observable. */
function deps() {
  return {
    baseUrl: `${fake.baseUrl}/v1`,
    delay: (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    },
  };
}

/** Runs a call that is expected to fail and returns the error. */
async function failure(call: Promise<void>): Promise<unknown> {
  try {
    await call;
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to fail');
}

beforeEach(async () => {
  fake = await FakeSpotify.start();
  waits = [];
});

afterEach(async () => {
  await fake.stop();
});

describe('startPlayback', () => {
  it('sends the track to the chosen device with the bearer token', async () => {
    fake.on('PUT', PLAY, { status: 204 });

    await startPlayback(TOKEN, 'device-1', TRACK, deps());

    const [request] = fake.requestsFor('PUT', PLAY);
    expect(request?.query.get('device_id')).toBe('device-1');
    expect(request?.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(request?.headers['content-type']).toBe('application/json');
    expect(request?.body).toEqual({ uris: [TRACK] });
  });

  it('url-encodes the device id', async () => {
    fake.on('PUT', PLAY, { status: 204 });

    await startPlayback(TOKEN, 'a b&c=d', TRACK, deps());

    expect(fake.requestsFor('PUT', PLAY)[0]?.query.get('device_id')).toBe('a b&c=d');
  });

  it('retries "device not found" and succeeds once the device is known', async () => {
    fake.on('PUT', PLAY, { status: 404, body: { error: { status: 404, message: 'Device not found' } } }, { status: 404 }, { status: 204 });

    await startPlayback(TOKEN, 'device-1', TRACK, deps());

    expect(fake.requestsFor('PUT', PLAY)).toHaveLength(3);
    expect(waits).toEqual([DEVICE_RETRY_DELAY_MS, DEVICE_RETRY_DELAY_MS]);
  });

  it('gives up after the retry limit and reports the 404', async () => {
    fake.on('PUT', PLAY, { status: 404, body: { error: { status: 404, message: 'Device not found' } } });

    const error = await failure(startPlayback(TOKEN, 'device-1', TRACK, deps()));

    expect(error).toBeInstanceOf(SpotifyApiError);
    expect((error as SpotifyApiError).status).toBe(404);
    expect((error as SpotifyApiError).message).toBe('Device not found');
    expect(fake.requestsFor('PUT', PLAY)).toHaveLength(DEVICE_RETRIES + 1);
    expect(waits).toHaveLength(DEVICE_RETRIES);
  });

  it.each([
    [401, { error: { status: 401, message: 'The access token expired' } }],
    [403, { error: { status: 403, message: 'Player command failed: Premium required', reason: 'PREMIUM_REQUIRED' } }],
    [429, { status: 429, message: 'Too many requests', reason: 'QUOTA_EXCEEDED' }],
    [500, { error: { status: 500, message: 'Server error' } }],
    [502, 'Bad Gateway'],
  ])('does not retry a %i response', async (status, body) => {
    fake.on('PUT', PLAY, { status, body });

    const error = await failure(startPlayback(TOKEN, 'device-1', TRACK, deps()));

    expect((error as SpotifyApiError).status).toBe(status);
    expect(fake.requestsFor('PUT', PLAY)).toHaveLength(1);
    expect(waits).toEqual([]);
  });

  it('reads the reason from the classic error shape', async () => {
    fake.on('PUT', PLAY, { status: 403, body: { error: { status: 403, message: 'Premium required', reason: 'PREMIUM_REQUIRED' } } });

    const error = (await failure(startPlayback(TOKEN, 'd', TRACK, deps()))) as SpotifyApiError;

    expect(error.reason).toBe('PREMIUM_REQUIRED');
    expect(error.message).toBe('Premium required');
  });

  it('reads the reason from the July 2026 quota shape', async () => {
    fake.on('PUT', PLAY, {
      status: 429,
      headers: { 'Retry-After': '30' },
      body: { status: 429, message: 'Too many requests', reason: 'QUOTA_EXCEEDED' },
    });

    const error = (await failure(startPlayback(TOKEN, 'd', TRACK, deps()))) as SpotifyApiError;

    expect(error.status).toBe(429);
    expect(error.reason).toBe('QUOTA_EXCEEDED');
    expect(error.retryAfterSec).toBe(30);
  });

  it('survives an error response that is not JSON', async () => {
    fake.on('PUT', PLAY, { status: 503, body: '<html>maintenance</html>' });

    const error = (await failure(startPlayback(TOKEN, 'd', TRACK, deps()))) as SpotifyApiError;

    expect(error).toBeInstanceOf(SpotifyApiError);
    expect(error.status).toBe(503);
    expect(error.reason).toBeUndefined();
  });

  it('survives an error response with no body', async () => {
    fake.on('PUT', PLAY, { status: 500 });

    const error = (await failure(startPlayback(TOKEN, 'd', TRACK, deps()))) as SpotifyApiError;

    expect(error.status).toBe(500);
    expect(typeof error.message).toBe('string');
  });

  it.each([['abc'], ['0'], ['-5'], ['']])('ignores an unusable Retry-After of "%s"', async (value) => {
    fake.on('PUT', PLAY, { status: 429, headers: { 'Retry-After': value }, body: { status: 429, message: 'slow down' } });

    const error = (await failure(startPlayback(TOKEN, 'd', TRACK, deps()))) as SpotifyApiError;

    expect(error.retryAfterSec).toBeUndefined();
  });

  it('lets network failures through untouched and does not retry them', async () => {
    fake.on('PUT', PLAY, { status: 204, dropConnection: true });

    const error = await failure(startPlayback(TOKEN, 'd', TRACK, deps()));

    expect(error).toBeInstanceOf(TypeError);
    expect(error).not.toBeInstanceOf(SpotifyApiError);
    expect(waits).toEqual([]);
  });

  it('does not leak the access token into error messages', async () => {
    fake.on('PUT', PLAY, { status: 401, body: { error: { status: 401, message: 'Invalid access token' } } });

    const error = (await failure(startPlayback(TOKEN, 'd', TRACK, deps()))) as SpotifyApiError;

    expect(error.message).not.toContain(TOKEN);
    expect(describeApiError(error)).not.toContain(TOKEN);
  });
});

describe('transferPlayback', () => {
  it('makes the device active without starting playback', async () => {
    fake.on('PUT', TRANSFER, { status: 204 });

    await transferPlayback(TOKEN, 'device-1', deps());

    const [request] = fake.requestsFor('PUT', TRANSFER);
    expect(request?.body).toEqual({ device_ids: ['device-1'], play: false });
    expect(request?.headers.authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('retries while the device is not yet known, then succeeds', async () => {
    fake.on('PUT', TRANSFER, { status: 404 }, { status: 404 }, { status: 404 }, { status: 204 });

    await transferPlayback(TOKEN, 'device-1', deps());

    expect(fake.requestsFor('PUT', TRANSFER)).toHaveLength(4);
    expect(waits).toHaveLength(3);
  });

  it('does not retry quota errors', async () => {
    fake.on('PUT', TRANSFER, { status: 429, body: { status: 429, message: 'Too many requests', reason: 'QUOTA_EXCEEDED' } });

    const error = (await failure(transferPlayback(TOKEN, 'device-1', deps()))) as SpotifyApiError;

    expect(error.reason).toBe('QUOTA_EXCEEDED');
    expect(fake.requestsFor('PUT', TRANSFER)).toHaveLength(1);
  });
});

describe('describeApiError', () => {
  it('explains a quota problem as shared across the developer account', () => {
    const message = describeApiError(new SpotifyApiError(429, 'QUOTA_EXCEEDED', 'Too many requests', 12));

    expect(message).toMatch(/quota/i);
    expect(message).toMatch(/developer account/i);
  });

  it('tells rate limit and quota problems apart', () => {
    const rate = describeApiError(new SpotifyApiError(429, undefined, 'Too many requests', 7));
    const quota = describeApiError(new SpotifyApiError(429, 'QUOTA_EXCEEDED', 'Too many requests', 7));

    expect(rate).toMatch(/slow down/i);
    expect(rate).toContain('7');
    expect(rate).not.toBe(quota);
  });

  it('copes with a rate limit that has no Retry-After', () => {
    expect(describeApiError(new SpotifyApiError(429, undefined, 'Too many requests'))).toMatch(/slow down/i);
  });

  it('asks for Premium on PREMIUM_REQUIRED', () => {
    expect(describeApiError(new SpotifyApiError(403, 'PREMIUM_REQUIRED', 'Premium required'))).toMatch(/premium/i);
  });

  it('does not claim Premium is the problem for other 403s', () => {
    const message = describeApiError(new SpotifyApiError(403, undefined, 'Forbidden'));

    expect(message).not.toMatch(/premium/i);
    expect(message).toContain('403');
  });

  it('asks the user to log in again on 401', () => {
    expect(describeApiError(new SpotifyApiError(401, undefined, 'expired'))).toMatch(/log in again/i);
  });

  it('includes status and message for anything else', () => {
    expect(describeApiError(new SpotifyApiError(500, undefined, 'Server error'))).toBe('Spotify error 500: Server error');
  });
});

describe('default dependencies', () => {
  it('uses the global fetch and a real timer when none are injected', async () => {
    vi.useFakeTimers();
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    try {
      const done = startPlayback(TOKEN, 'device-1', TRACK);
      await vi.advanceTimersByTimeAsync(DEVICE_RETRY_DELAY_MS);
      await done;

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(fetchSpy.mock.calls[0]?.[0] as string).toBe('https://api.spotify.com/v1/me/player/play?device_id=device-1');
    } finally {
      vi.useRealTimers();
    }
  });
});
