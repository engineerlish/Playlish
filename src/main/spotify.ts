/**
 * Minimal Spotify Web API client for the spike. It is deliberately the only module that talks to api.spotify.com,
 * so endpoint changes (like the February 2026 ones) stay fixable in one place. The MVP version adds the shared
 * request queue, caching and typed responses for every endpoint.
 */

import { toApiError } from './spotify/errors';

export { SpotifyApiError, describeApiError } from './spotify/errors';

export const API_BASE = 'https://api.spotify.com/v1';
// CHANGE HERE: how many times to retry "device not found" right after the SDK device registers, and the wait between tries.
// A new SDK device can take several seconds before the Web API knows about it.
export const DEVICE_RETRIES = 12;
export const DEVICE_RETRY_DELAY_MS = 1000;

/** Things the client needs from the outside; all optional, and replaced in tests. */
export interface SpotifyDeps {
  /** HTTP client; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Base URL of the Web API without a trailing slash; defaults to the real API. */
  baseUrl?: string;
  /** Waits for the given milliseconds; defaults to a timer. */
  delay?: (ms: number) => Promise<void>;
}

/** Sleeps for `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sends a JSON PUT and retries on 404 ("device not found"), because a freshly created SDK device is not always
 * known to the Web API yet. Every other error is thrown immediately: in particular 429 (rate limit or quota) is never
 * retried here, so a quota problem cannot turn into a request storm.
 */
async function putWithDeviceRetry(accessToken: string, path: string, body: unknown, deps: SpotifyDeps): Promise<void> {
  const fetchFn = deps.fetch ?? ((input, init) => fetch(input, init));
  const baseUrl = deps.baseUrl ?? API_BASE;
  const wait = deps.delay ?? sleep;

  for (let attempt = 0; ; attempt++) {
    const res = await fetchFn(`${baseUrl}${path}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.ok) return;
    const err = await toApiError(res);
    if (err.status === 404 && attempt < DEVICE_RETRIES) {
      await wait(DEVICE_RETRY_DELAY_MS);
      continue;
    }
    throw err;
  }
}

/**
 * Makes the SDK device the active Connect device without starting playback (PUT /me/player).
 * Retries on 404 until the Web API knows about the freshly created device.
 */
export function transferPlayback(accessToken: string, deviceId: string, deps: SpotifyDeps = {}): Promise<void> {
  return putWithDeviceRetry(accessToken, '/me/player', { device_ids: [deviceId], play: false }, deps);
}

/**
 * Starts playback of one track on the given device (PUT /me/player/play).
 * Retries briefly on 404 because a freshly created SDK device is not always known to the API yet.
 */
export function startPlayback(accessToken: string, deviceId: string, trackUri: string, deps: SpotifyDeps = {}): Promise<void> {
  return putWithDeviceRetry(accessToken, `/me/player/play?device_id=${encodeURIComponent(deviceId)}`, { uris: [trackUri] }, deps);
}
