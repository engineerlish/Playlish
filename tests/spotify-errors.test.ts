import { describe, expect, it } from 'vitest';
import { SpotifyApiError, describeApiError, toApiError } from '../src/main/spotify/errors';

/** A Response like Spotify's error responses. */
function response(status: number, body: string | object | null, headers: Record<string, string> = {}): Response {
  const text = body === null ? null : typeof body === 'string' ? body : JSON.stringify(body);
  return new Response(text, { status, statusText: status === 503 ? 'Service Unavailable' : 'Error', headers });
}

describe('toApiError', () => {
  it('reads status, message and reason from the classic error shape', async () => {
    const error = await toApiError(response(403, { error: { status: 403, message: 'Premium required', reason: 'PREMIUM_REQUIRED' } }));

    expect(error).toMatchObject({ status: 403, reason: 'PREMIUM_REQUIRED', message: 'Premium required' });
  });

  it('reads the July 2026 quota shape', async () => {
    const error = await toApiError(response(429, { status: 429, message: 'Too many requests', reason: 'QUOTA_EXCEEDED' }, { 'Retry-After': '30' }));

    expect(error).toMatchObject({ status: 429, reason: 'QUOTA_EXCEEDED', retryAfterSec: 30 });
    expect(error.isQuota).toBe(true);
    expect(error.isRateLimit).toBe(false);
  });

  it('treats a 429 without a quota reason as a rate limit', async () => {
    const error = await toApiError(response(429, { error: { status: 429, message: 'API rate limit exceeded' } }, { 'Retry-After': '4' }));

    expect(error.isRateLimit).toBe(true);
    expect(error.retryAfterSec).toBe(4);
  });

  it('survives an error body that is not JSON, or no body at all', async () => {
    const html = await toApiError(response(503, '<html>maintenance</html>'));
    const empty = await toApiError(response(500, null));

    expect(html).toMatchObject({ status: 503, reason: undefined, message: 'Service Unavailable' });
    expect(empty.status).toBe(500);
  });

  it.each([['abc'], ['0'], ['-5'], ['']])('ignores an unusable Retry-After of "%s"', async (value) => {
    const error = await toApiError(response(429, { status: 429, message: 'slow down' }, { 'Retry-After': value }));

    expect(error.retryAfterSec).toBeUndefined();
  });
});

describe('describeApiError', () => {
  it('explains the quota, shared across the developer account, and what Playlish does', () => {
    const message = describeApiError(new SpotifyApiError(429, 'QUOTA_EXCEEDED', 'Too many requests'));

    expect(message).toMatch(/developer account/);
    expect(message).toMatch(/Background updates are paused/);
  });

  it('describes a rate limit as a retry that really happens, with the wait (#24)', () => {
    expect(describeApiError(new SpotifyApiError(429, undefined, 'x', 7))).toBe('Spotify asked Playlish to slow down. Trying again in 7 seconds.');
    expect(describeApiError(new SpotifyApiError(429, undefined, 'x'))).toMatch(/a few seconds/);
  });

  it('asks for Premium only when Spotify says so', () => {
    expect(describeApiError(new SpotifyApiError(403, 'PREMIUM_REQUIRED', 'x'))).toMatch(/Premium/);
    expect(describeApiError(new SpotifyApiError(403, undefined, 'Forbidden'))).toBe('Spotify error 403: Forbidden');
  });

  it('asks the user to log in again on 401', () => {
    expect(describeApiError(new SpotifyApiError(401, undefined, 'expired'))).toMatch(/log in again/i);
  });

  it('never repeats an access token that ended up in an error message', async () => {
    const tokenLike = `BQ${'t'.repeat(150)}`;
    const error = await toApiError(response(401, { error: { status: 401, message: 'Invalid access token' } }));

    expect(error.message).not.toContain(tokenLike);
    expect(describeApiError(error)).not.toContain(tokenLike);
  });
});
