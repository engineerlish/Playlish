import { createHash, randomBytes } from 'node:crypto';

export const AUTHORIZE_URL = 'https://accounts.spotify.com/authorize';
export const TOKEN_URL = 'https://accounts.spotify.com/api/token';
// CHANGE HERE: scopes requested at login. The Web Playback SDK rejects tokens without `streaming`, `user-read-email` and
// `user-read-private` ("Invalid token scopes"); the other two let us control playback through the Web API.
export const SCOPES = [
  'streaming',
  'user-read-email',
  'user-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
];
// CHANGE HERE: how long we wait for the user to finish logging in in the browser.
export const LOGIN_TIMEOUT_MS = 5 * 60_000;
// CHANGE HERE: refresh the access token this long before it expires.
export const REFRESH_MARGIN_MS = 60_000;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

interface PendingLogin {
  verifier: string;
  state: string;
  resolve: () => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
}

/** Raised when the session can no longer be refreshed and the user must log in again. */
export class SessionExpiredError extends Error {
  constructor() {
    super('Your Spotify session expired. Please log in again.');
    this.name = 'SessionExpiredError';
  }
}

/** Encodes bytes as base64url (RFC 7636) without padding. */
function base64Url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Things the class needs from the outside; all optional, and replaced in tests. */
export interface AuthDeps {
  /** HTTP client; defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Clock in epoch milliseconds; defaults to Date.now. */
  now?: () => number;
  /** Called whenever Spotify hands us a (new) refresh token so the caller can persist it. */
  onRefreshToken?: (refreshToken: string) => void;
}

/**
 * Authorization Code flow with PKCE. No client secret is ever used or stored.
 * Spike limitation: tokens live in memory only. Persistence in Windows Credential Manager comes with the MVP.
 */
export class Auth {
  private accessToken: string | null = null;
  private refreshToken: string | null = null;
  private expiresAtMs = 0;
  private pending: PendingLogin | null = null;
  private refreshing: Promise<string> | null = null;

  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly onRefreshToken: (refreshToken: string) => void;

  constructor(
    private readonly clientId: string,
    private readonly redirectUri: string,
    deps: AuthDeps = {},
  ) {
    this.fetchFn = deps.fetch ?? ((input, init) => fetch(input, init));
    this.now = deps.now ?? Date.now;
    this.onRefreshToken = deps.onRefreshToken ?? (() => undefined);
  }

  /** Restores a session from a previously saved refresh token; the first getAccessToken() call will refresh it. */
  restore(refreshToken: string): void {
    this.refreshToken = refreshToken;
  }

  /** Forgets the session (used on sign-out or when the saved token is rejected). */
  clear(): void {
    this.accessToken = null;
    this.refreshToken = null;
    this.expiresAtMs = 0;
  }

  /** True once a login has produced a refresh token. */
  isLoggedIn(): boolean {
    return this.refreshToken !== null;
  }

  /**
   * Starts a login: builds the authorize URL, hands it to `openUrl` (the system browser) and
   * resolves once the loopback server reports the callback and the code has been exchanged.
   */
  startLogin(openUrl: (url: string) => Promise<void>): Promise<void> {
    this.pending?.reject(new Error('Login restarted'));

    const verifier = base64Url(randomBytes(64));
    const challenge = base64Url(createHash('sha256').update(verifier).digest());
    const state = base64Url(randomBytes(16));

    const url = new URL(AUTHORIZE_URL);
    url.search = new URLSearchParams({
      client_id: this.clientId,
      response_type: 'code',
      redirect_uri: this.redirectUri,
      code_challenge_method: 'S256',
      code_challenge: challenge,
      state,
      scope: SCOPES.join(' '),
    }).toString();

    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error('Login timed out. Please try again.'));
      }, LOGIN_TIMEOUT_MS);
      this.pending = { verifier, state, resolve, reject, timer };
      openUrl(url.toString()).catch((err: Error) => this.failPending(err));
    });
  }

  /** Called by the loopback server with the query string of /callback. Throws with a user-readable message on failure. */
  async handleCallback(params: URLSearchParams): Promise<void> {
    const pending = this.pending;
    if (!pending) throw new Error('No login is in progress.');

    const error = params.get('error');
    if (error) {
      const err = new Error(error === 'access_denied' ? 'Login was cancelled.' : `Spotify returned an error: ${error}`);
      this.failPending(err);
      throw err;
    }
    if (params.get('state') !== pending.state) {
      const err = new Error('Login response did not match the request (state mismatch).');
      this.failPending(err);
      throw err;
    }
    const code = params.get('code');
    if (!code) {
      const err = new Error('Login response had no authorization code.');
      this.failPending(err);
      throw err;
    }

    try {
      const token = await this.postToken({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.redirectUri,
        code_verifier: pending.verifier,
      });
      this.applyToken(token);
      clearTimeout(pending.timer);
      this.pending = null;
      pending.resolve();
    } catch (err) {
      this.failPending(err as Error);
      throw err;
    }
  }

  /** Returns a valid access token, refreshing it first if it is about to expire. Concurrent callers share one refresh. */
  async getAccessToken(): Promise<string> {
    if (this.accessToken && this.now() < this.expiresAtMs - REFRESH_MARGIN_MS) return this.accessToken;
    if (!this.refreshToken) throw new SessionExpiredError();
    this.refreshing ??= this.refresh().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  /** Exchanges the refresh token for a new access token. A rejected refresh token means the session is gone. */
  private async refresh(): Promise<string> {
    try {
      const token = await this.postToken({ grant_type: 'refresh_token', refresh_token: this.refreshToken ?? '' });
      this.applyToken(token);
      return token.access_token;
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        this.accessToken = null;
        this.refreshToken = null;
      }
      throw err;
    }
  }

  /** Stores a token response; Spotify may or may not rotate the refresh token. */
  private applyToken(token: TokenResponse): void {
    this.accessToken = token.access_token;
    if (token.refresh_token) {
      this.refreshToken = token.refresh_token;
      this.onRefreshToken(token.refresh_token);
    }
    this.expiresAtMs = this.now() + token.expires_in * 1000;
  }

  /** Rejects and clears the in-flight login. */
  private failPending(err: Error): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = null;
    pending.reject(err);
  }

  /** POSTs to the token endpoint (PKCE: client_id only, no secret). */
  private async postToken(body: Record<string, string>): Promise<TokenResponse> {
    const res = await this.fetchFn(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.clientId, ...body }),
    });
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 400 && /invalid_grant/.test(text)) throw new SessionExpiredError();
      throw new Error(`Spotify token request failed (${res.status}): ${text.slice(0, 200)}`);
    }
    return (await res.json()) as TokenResponse;
  }
}
