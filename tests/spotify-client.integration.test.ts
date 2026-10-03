import * as fs from 'node:fs';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Auth, SessionExpiredError } from '../src/main/auth';
import { MalformedResponseError, SpotifyClient, isInsufficientScope } from '../src/main/spotify/client';
import { QuotaPausedError, SpotifyApiError } from '../src/main/spotify/errors';
import { RequestQueue } from '../src/main/spotify/queue';
import type { Episode, Track } from '../src/main/spotify/types';
import { FakeSpotify, type RecordedRequest } from './helpers/fake-spotify';

/*
 * Integration tests: the real client, request queue and (where relevant) Auth, against the local fake Spotify server
 * answering with fixtures in the current API shapes (tests/fixtures/spotify). Nothing here talks to real Spotify.
 */

const FIXTURES = path.join(import.meta.dirname, 'fixtures', 'spotify');
/** Loads a fixture file. */
const fixture = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(FIXTURES, name), 'utf8')) as unknown;
const ok = (name: string) => ({ status: 200, body: fixture(name) });
const NO_CONTENT = { status: 204 };

let fake: FakeSpotify;
let token: string;
let waits: number;

/** A client wired to the fake server, with a real queue and no real waiting for device retries. */
function makeClient(queue = new RequestQueue()) {
  return new SpotifyClient({
    getAccessToken: () => Promise.resolve(token),
    baseUrl: `${fake.baseUrl}/v1`,
    queue,
    delay: () => {
      waits++;
      return Promise.resolve();
    },
  });
}

/** The one request recorded for a route. */
function only(method: string, route: string): RecordedRequest {
  const requests = fake.requestsFor(method, route);
  expect(requests).toHaveLength(1);
  return requests[0] as RecordedRequest;
}

beforeEach(async () => {
  fake = await FakeSpotify.start();
  token = 'access-1';
  waits = 0;
});

afterEach(async () => {
  await fake.stop();
});

describe('reads parse the current response shapes', () => {
  it('reads the profile without the fields removed in February 2026, and caches it', async () => {
    fake.on('GET', '/v1/me', ok('me.json'));
    const client = makeClient();

    const me = await client.me();
    await client.me();

    expect(me).toMatchObject({ id: 'fixtureuser', display_name: 'Fixture User' });
    expect(me).not.toHaveProperty('email');
    expect(me).not.toHaveProperty('product');
    expect(fake.requestsFor('GET', '/v1/me')).toHaveLength(1);
  });

  it('reads playback state with tracks and episodes, and treats 204 as nothing playing', async () => {
    fake.on('GET', '/v1/me/player', ok('player.json'), ok('player-episode.json'), NO_CONTENT);
    const client = makeClient();

    const playing = await client.playbackState();
    const episode = await client.playbackState();
    const nothing = await client.playbackState();

    expect(playing?.is_playing).toBe(true);
    expect((playing?.item as Track).album.name).toBe('Fixture Album 1');
    expect(episode?.item?.type).toBe('episode');
    expect(nothing).toBeNull();
    expect(fake.requestsFor('GET', '/v1/me/player')[0]?.query.get('additional_types')).toBe('track,episode');
  });

  it('reads devices and the queue (which can hold episodes)', async () => {
    fake.on('GET', '/v1/me/player/devices', ok('devices.json'));
    fake.on('GET', '/v1/me/player/queue', ok('queue.json'));
    const client = makeClient();

    const devices = await client.devices();
    const queue = await client.queueState();

    expect(devices.map((d) => d.name)).toEqual(['Playlish', 'Phone']);
    expect(queue.queue.map((i) => i.type)).toEqual(['track', 'episode', 'track']);
  });

  it('pages saved tracks within the API limit and caches each page briefly', async () => {
    fake.on('GET', '/v1/me/tracks', ok('saved-tracks.json'));
    const client = makeClient();

    const page = await client.savedTracks(0, 500);
    await client.savedTracks(0, 500);
    await client.savedTracks(50, 50);

    expect(page.items[0]?.track.name).toBe('Fixture Track 1');
    const requests = fake.requestsFor('GET', '/v1/me/tracks');
    expect(requests).toHaveLength(2);
    expect(requests[0]?.query.get('limit')).toBe('50');
    expect(requests[1]?.query.get('offset')).toBe('50');
  });

  it('reads playlists by items.total and playlist entries under item, cached by snapshot', async () => {
    fake.on('GET', '/v1/me/playlists', ok('playlists.json'));
    fake.on('GET', '/v1/playlists/playlist0000000000001/items', ok('playlist-items.json'));
    const client = makeClient();

    const lists = await client.playlists();
    const mine = lists.items[0];
    const entries = await client.playlistItems(mine?.id ?? '', mine?.snapshot_id ?? '');
    await client.playlistItems(mine?.id ?? '', mine?.snapshot_id ?? '');
    await client.playlistItems(mine?.id ?? '', 'snapshot-2');

    expect(mine?.items.total).toBe(3);
    expect(entries.items.map((e) => e.item?.type ?? null)).toEqual(['track', 'episode', null]);
    expect((entries.items[1]?.item as Episode).show?.name).toBe('Fixture Show');
    expect(fake.requestsFor('GET', '/v1/playlists/playlist0000000000001/items')).toHaveLength(2);
  });

  it("reports Spotify's refusal for someone else's playlist", async () => {
    fake.on('GET', '/v1/playlists/playlist0000000000002/items', { status: 403, body: fixture('error-not-owner.json') });

    await expect(makeClient().playlistItems('playlist0000000000002', 'snapshot-1')).rejects.toMatchObject({ status: 403 });
  });

  it('searches with at most 10 per type, keeps null playlist entries, and caches by query', async () => {
    fake.on('GET', '/v1/search', ok('search.json'));
    const client = makeClient();

    const results = await client.search('  Fixture ', ['track', 'album', 'artist', 'playlist'], 0, 50);
    await client.search('fixture', ['track', 'album', 'artist', 'playlist'], 0, 50);

    const request = only('GET', '/v1/search');
    expect(request.query.get('limit')).toBe('10');
    expect(request.query.get('q')).toBe('Fixture');
    expect(request.query.get('type')).toBe('track,album,artist,playlist');
    expect(results.tracks?.items).toHaveLength(10);
    expect(results.playlists?.items[1]).toBeNull();
  });
});

describe('library changes', () => {
  it('saves in chunks of 40 URIs and refreshes cached library pages afterwards', async () => {
    fake.on('GET', '/v1/me/tracks', ok('saved-tracks.json'));
    fake.on('PUT', '/v1/me/library', { status: 200 });
    const client = makeClient();
    await client.savedTracks();
    const uris = Array.from({ length: 41 }, (_, i) => `spotify:track:track${String(i).padStart(17, '0')}`);

    await client.saveToLibrary(uris);
    await client.savedTracks();

    const puts = fake.requestsFor('PUT', '/v1/me/library');
    expect(puts.map((r) => r.query.get('uris')?.split(',').length)).toEqual([40, 1]);
    expect(fake.requestsFor('GET', '/v1/me/tracks')).toHaveLength(2);
  });

  it('removes items with DELETE and checks membership in order across chunks', async () => {
    fake.on('DELETE', '/v1/me/library', { status: 200 });
    fake.on('GET', '/v1/me/library/contains', { status: 200, body: Array.from({ length: 40 }, () => true) }, { status: 200, body: [false] });
    const client = makeClient();
    const uris = Array.from({ length: 41 }, (_, i) => `spotify:album:album${String(i).padStart(17, '0')}`);

    await client.removeFromLibrary(uris.slice(0, 2));
    const flags = await client.libraryContains(uris);

    expect(only('DELETE', '/v1/me/library').query.get('uris')?.split(',')).toEqual(uris.slice(0, 2));
    expect(flags).toHaveLength(41);
    expect(flags.at(-1)).toBe(false);
  });
});

describe('playback commands', () => {
  it('plays items or a context on a device', async () => {
    fake.on('PUT', '/v1/me/player/play', NO_CONTENT);
    const client = makeClient();

    await client.play({ deviceId: 'dev-1', uris: ['spotify:track:a'] });
    await client.play({ contextUri: 'spotify:playlist:p', offset: { position: 2 }, positionMs: 1500.7 });

    const [first, second] = fake.requestsFor('PUT', '/v1/me/player/play');
    expect(first?.query.get('device_id')).toBe('dev-1');
    expect(first?.body).toEqual({ uris: ['spotify:track:a'] });
    expect(second?.query.has('device_id')).toBe(false);
    expect(second?.body).toEqual({ context_uri: 'spotify:playlist:p', offset: { position: 2 }, position_ms: 1500 });
  });

  it('retries "device not found" for play and transfer while a new device registers', async () => {
    fake.on('PUT', '/v1/me/player/play', { status: 404, body: fixture('error-no-device.json') }, NO_CONTENT);
    fake.on('PUT', '/v1/me/player', { status: 404 }, { status: 404 }, NO_CONTENT);
    const client = makeClient();

    await client.play({ deviceId: 'dev-1', uris: ['spotify:track:a'] });
    await client.transfer('dev-1', true);

    expect(fake.requestsFor('PUT', '/v1/me/player/play')).toHaveLength(2);
    expect(fake.requestsFor('PUT', '/v1/me/player')).toHaveLength(3);
    expect(fake.requestsFor('PUT', '/v1/me/player')[2]?.body).toEqual({ device_ids: ['dev-1'], play: true });
    expect(waits).toBe(3);
  });

  it('does not retry "no active device" for other commands', async () => {
    fake.on('PUT', '/v1/me/player/pause', { status: 404, body: fixture('error-no-device.json') });

    await expect(makeClient().pause()).rejects.toMatchObject({ status: 404, reason: 'NO_ACTIVE_DEVICE' });
    expect(fake.requestsFor('PUT', '/v1/me/player/pause')).toHaveLength(1);
  });

  it('sends every other command with the documented method, path and parameters', async () => {
    for (const [m, p] of [
      ['PUT', '/v1/me/player/pause'], ['POST', '/v1/me/player/next'], ['POST', '/v1/me/player/previous'], ['PUT', '/v1/me/player/seek'],
      ['PUT', '/v1/me/player/shuffle'], ['PUT', '/v1/me/player/repeat'], ['PUT', '/v1/me/player/volume'], ['POST', '/v1/me/player/queue'],
    ] as const) fake.on(m, p, NO_CONTENT);
    const client = makeClient();

    await client.pause('d');
    await client.next();
    await client.previous();
    await client.seek(-50);
    await client.shuffle(true);
    await client.repeat('context');
    await client.volume(140);
    await client.addToQueue('spotify:episode:e', 'd');

    expect(only('PUT', '/v1/me/player/pause').query.get('device_id')).toBe('d');
    expect(only('PUT', '/v1/me/player/seek').query.get('position_ms')).toBe('0');
    expect(only('PUT', '/v1/me/player/shuffle').query.get('state')).toBe('true');
    expect(only('PUT', '/v1/me/player/repeat').query.get('state')).toBe('context');
    expect(only('PUT', '/v1/me/player/volume').query.get('volume_percent')).toBe('100');
    expect(only('POST', '/v1/me/player/queue').query.get('uri')).toBe('spotify:episode:e');
    expect(only('POST', '/v1/me/player/next').headers.authorization).toBe('Bearer access-1');
  });
});

describe('errors (#8)', () => {
  it('reports an expired access token as 401 without retrying', async () => {
    fake.on('GET', '/v1/me/player/devices', { status: 401, body: fixture('error-expired-token.json') });

    await expect(makeClient().devices()).rejects.toMatchObject({ status: 401 });
    expect(fake.requestsFor('GET', '/v1/me/player/devices')).toHaveLength(1);
  });

  it('reports a non-Premium account', async () => {
    fake.on('PUT', '/v1/me/player/play', { status: 403, body: fixture('error-premium.json') });

    await expect(makeClient().play({ uris: ['spotify:track:a'] })).rejects.toMatchObject({ status: 403, reason: 'PREMIUM_REQUIRED' });
  });

  it('recognises a login that lacks a newer permission', async () => {
    fake.on('GET', '/v1/me/tracks', { status: 403, body: fixture('error-scope.json') });

    const error = await makeClient().savedTracks().catch((e: unknown) => e);

    expect(isInsufficientScope(error)).toBe(true);
    expect(isInsufficientScope(new SpotifyApiError(403, 'PREMIUM_REQUIRED', 'Premium required'))).toBe(false);
  });

  it('waits out a rate limit and retries the same request', async () => {
    fake.on('GET', '/v1/me/player/devices', { status: 429, headers: { 'Retry-After': '1' }, body: { error: { status: 429, message: 'API rate limit exceeded' } } }, ok('devices.json'));

    const started = Date.now();
    const devices = await makeClient().devices();

    expect(devices).toHaveLength(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
    expect(fake.requestsFor('GET', '/v1/me/player/devices')).toHaveLength(2);
  });

  it('never retries a quota error and then refuses background work', async () => {
    fake.on('GET', '/v1/me/tracks', { status: 429, body: fixture('error-quota.json') });
    const client = makeClient();

    await expect(client.savedTracks()).rejects.toMatchObject({ status: 429, reason: 'QUOTA_EXCEEDED' });
    await expect(client.savedAlbums(0, 50, 'background')).rejects.toBeInstanceOf(QuotaPausedError);
    expect(fake.requestsFor('GET', '/v1/me/tracks')).toHaveLength(1);
    expect(fake.requestsFor('GET', '/v1/me/albums')).toHaveLength(0);
  });

  it('passes server errors through without retrying', async () => {
    fake.on('GET', '/v1/me/player/queue', { status: 503, body: '<html>maintenance</html>' });

    await expect(makeClient().queueState()).rejects.toMatchObject({ status: 503 });
    expect(fake.requestsFor('GET', '/v1/me/player/queue')).toHaveLength(1);
  });

  it('reports network loss', async () => {
    fake.on('GET', '/v1/me/player', { status: 200, dropConnection: true });

    await expect(makeClient().playbackState()).rejects.toBeInstanceOf(TypeError);
  });

  it('rejects malformed and truncated responses clearly', async () => {
    fake.on('GET', '/v1/me/player/devices', { status: 200, body: { nope: true } });
    fake.on('GET', '/v1/me/tracks', { status: 200, body: '{"items": [' });
    fake.on('GET', '/v1/me/library/contains', { status: 200, body: [true] });
    const client = makeClient();

    await expect(client.devices()).rejects.toBeInstanceOf(MalformedResponseError);
    await expect(client.savedTracks()).rejects.toBeInstanceOf(MalformedResponseError);
    await expect(client.libraryContains(['spotify:track:a', 'spotify:track:b'])).rejects.toBeInstanceOf(MalformedResponseError);
  });

  it('asks for a fresh access token on every request', async () => {
    fake.on('GET', '/v1/me/player/devices', ok('devices.json'));
    const client = makeClient();

    await client.devices();
    token = 'access-2';
    await client.devices();

    expect(fake.requestsFor('GET', '/v1/me/player/devices').map((r) => r.headers.authorization)).toEqual(['Bearer access-1', 'Bearer access-2']);
  });
});

describe('with the real Auth (token refresh)', () => {
  /** An Auth whose token endpoint is the fake server. */
  function authAgainstFake(onSessionExpired: () => void = () => undefined) {
    const fetchToFake: typeof fetch = (input, init) => fetch((input as string).replace('https://accounts.spotify.com', fake.baseUrl), init);
    return new Auth('0123456789abcdef0123456789abcdef', 'http://127.0.0.1:43821/callback', { fetch: fetchToFake, onSessionExpired });
  }

  it('refreshes an expired session before calling the API', async () => {
    fake.on('POST', '/api/token', { status: 200, body: { access_token: 'fresh-access', expires_in: 3600, token_type: 'Bearer' } });
    fake.on('GET', '/v1/me', ok('me.json'));
    const auth = authAgainstFake();
    auth.restore('saved-refresh-token');
    const client = new SpotifyClient({ getAccessToken: () => auth.getAccessToken(), baseUrl: `${fake.baseUrl}/v1` });

    await client.me();

    expect(only('POST', '/api/token').body).toContain('refresh_token=saved-refresh-token');
    expect(only('GET', '/v1/me').headers.authorization).toBe('Bearer fresh-access');
  });

  it('ends the session without calling the API when the refresh token is rejected', async () => {
    let expired = 0;
    fake.on('POST', '/api/token', { status: 400, body: { error: 'invalid_grant', error_description: 'Refresh token revoked' } });
    const auth = authAgainstFake(() => expired++);
    auth.restore('revoked');
    const client = new SpotifyClient({ getAccessToken: () => auth.getAccessToken(), baseUrl: `${fake.baseUrl}/v1` });

    await expect(client.devices()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(expired).toBe(1);
    expect(fake.requestsFor('GET', '/v1/me/player/devices')).toHaveLength(0);
  });
});
