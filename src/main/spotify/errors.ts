/*
 * Errors from the Spotify Web API, and the plain-language messages the UI shows for them.
 */

interface ApiErrorBody {
  error?: { status?: number; message?: string; reason?: string };
  status?: number;
  message?: string;
  reason?: string;
}

/** A failed Web API call with enough detail to show a clear message. */
export class SpotifyApiError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string | undefined,
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'SpotifyApiError';
  }

  /** The per-developer-account quota is used up (July 2026 Development Mode quota). */
  get isQuota(): boolean {
    return this.status === 429 && this.reason === 'QUOTA_EXCEEDED';
  }

  /** An ordinary rate limit (too many calls in Spotify's rolling 30 second window). */
  get isRateLimit(): boolean {
    return this.status === 429 && !this.isQuota;
  }
}

/** Thrown for background work while Playlish holds back because the quota is used up. */
export class QuotaPausedError extends Error {
  constructor(readonly until: Date) {
    super(`Background requests are paused until ${until.toISOString()} because the Spotify quota is used up.`);
    this.name = 'QuotaPausedError';
  }
}

/** Parses an error response into a SpotifyApiError (tolerates non-JSON and empty bodies). */
export async function toApiError(res: Response): Promise<SpotifyApiError> {
  let body: ApiErrorBody = {};
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    // Non-JSON error body; fall through with defaults.
  }
  const retryAfter = Number(res.headers.get('Retry-After'));
  return new SpotifyApiError(
    res.status,
    body.error?.reason ?? body.reason,
    body.error?.message ?? body.message ?? res.statusText,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  );
}

/**
 * Turns an API error into a message for the UI. Every message describes what Playlish actually does: the request
 * queue retries rate-limited requests after Retry-After (#24), and pauses background work when the quota is used up.
 */
export function describeApiError(err: SpotifyApiError): string {
  if (err.isQuota) {
    return 'Your Spotify developer quota is used up (it is shared by all apps on your developer account). Background updates are paused for a while; what you do yourself is still tried.';
  }
  if (err.isRateLimit) {
    return `Spotify asked Playlish to slow down. Trying again in ${err.retryAfterSec ?? 'a few'} seconds.`;
  }
  if (err.status === 403 && err.reason === 'PREMIUM_REQUIRED') {
    return 'Spotify Premium is required for playback.';
  }
  if (err.status === 401) return 'Spotify rejected the login token. Please log in again.';
  return `Spotify error ${err.status}: ${err.message}`;
}
