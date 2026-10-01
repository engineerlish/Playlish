import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTHORIZE_URL, Auth, LOGIN_TIMEOUT_MS, REFRESH_MARGIN_MS, SCOPES, SessionExpiredError, TOKEN_URL } from '../src/main/auth';

const CLIENT_ID = '0123456789abcdef0123456789abcdef';
const REDIRECT_URI = 'http://127.0.0.1:43821/callback';

/** A token endpoint response. */
function tokenResponse(opts: { access?: string; refresh?: string | null; expiresIn?: number } = {}): Response {
  const body: Record<string, unknown> = { access_token: opts.access ?? 'access-1', expires_in: opts.expiresIn ?? 3600 };
  if (opts.refresh !== null) body['refresh_token'] = opts.refresh ?? 'refresh-1';
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

/** A failed token endpoint response. */
function errorResponse(status: number, body: unknown): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

/** The form fields of a recorded token request. */
function formOf(call: Parameters<typeof fetch>): URLSearchParams {
  const body = call[1]?.body;
  if (!(body instanceof URLSearchParams)) throw new Error('expected a URLSearchParams body');
  return body;
}

/** Builds an Auth with a scripted fetch and a controllable clock. */
function setup() {
  const fetchMock = vi.fn<typeof fetch>();
  const clock = { now: 1_000_000 };
  const savedTokens: string[] = [];
  const auth = new Auth(CLIENT_ID, REDIRECT_URI, {
    fetch: fetchMock,
    now: () => clock.now,
    onRefreshToken: (t) => savedTokens.push(t),
  });

  /** Starts a login and returns what the browser would have been sent to. */
  function begin() {
    const opened: string[] = [];
    const login = auth.startLogin((url) => {
      opened.push(url);
      return Promise.resolve();
    });
    login.catch(() => undefined); // tests assert on rejections explicitly; avoid unhandled-rejection noise
    const url = new URL(opened[0] ?? 'http://missing');
    return { login, url, state: url.searchParams.get('state') ?? '', challenge: url.searchParams.get('code_challenge') ?? '' };
  }

  /** Completes a login with a successful token exchange. */
  async function loginOk(token: Parameters<typeof tokenResponse>[0] = {}) {
    const started = begin();
    fetchMock.mockResolvedValueOnce(tokenResponse(token));
    await auth.handleCallback(new URLSearchParams({ code: 'the-code', state: started.state }));
    await started.login;
    fetchMock.mockClear();
    return started;
  }

  return { auth, fetchMock, clock, savedTokens, begin, loginOk };
}

describe('Auth: starting a login', () => {
  it('builds a PKCE authorize URL for the configured app', () => {
    const { begin } = setup();

    const { url } = begin();

    expect(`${url.origin}${url.pathname}`).toBe(AUTHORIZE_URL);
    expect(url.searchParams.get('client_id')).toBe(CLIENT_ID);
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT_URI);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('requests the scopes the Web Playback SDK needs', () => {
    const { begin } = setup();

    const scopes = begin().url.searchParams.get('scope')?.split(' ');

    expect(scopes).toEqual(SCOPES);
    expect(scopes).toEqual(expect.arrayContaining(['streaming', 'user-read-email', 'user-read-private']));
  });

  it('never puts a client secret in the URL', () => {
    const { begin } = setup();

    expect(begin().url.search).not.toMatch(/secret/i);
  });

  it('uses a different state for every login', () => {
    const { begin } = setup();

    const first = begin();
    const second = begin();

    expect(first.state).not.toBe('');
    expect(first.state).not.toBe(second.state);
    expect(first.challenge).not.toBe(second.challenge);
  });

  it('fails the login if the browser cannot be opened', async () => {
    const { auth } = setup();

    const login = auth.startLogin(() => Promise.reject(new Error('no default browser')));

    await expect(login).rejects.toThrow('no default browser');
    await expect(auth.handleCallback(new URLSearchParams({ code: 'x', state: 'y' }))).rejects.toThrow('No login is in progress.');
  });

  it('rejects the earlier login when a new one starts', async () => {
    const { begin } = setup();

    const first = begin();
    begin();

    await expect(first.login).rejects.toThrow('Login restarted');
  });

  it('times out when the user never comes back', async () => {
    vi.useFakeTimers();
    try {
      const { auth, begin } = setup();
      const { login } = begin();

      await vi.advanceTimersByTimeAsync(LOGIN_TIMEOUT_MS);

      await expect(login).rejects.toThrow('Login timed out');
      await expect(auth.handleCallback(new URLSearchParams({ code: 'x' }))).rejects.toThrow('No login is in progress.');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Auth: handling the callback', () => {
  it('exchanges the code using PKCE and no client secret', async () => {
    const { auth, fetchMock, savedTokens, begin } = setup();
    const { login, state, challenge } = begin();
    fetchMock.mockResolvedValueOnce(tokenResponse({ access: 'at', refresh: 'rt' }));

    await auth.handleCallback(new URLSearchParams({ code: 'the-code', state }));
    await login;

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0] as Parameters<typeof fetch>;
    expect(call[0]).toBe(TOKEN_URL);
    expect(call[1]?.method).toBe('POST');
    const form = formOf(call);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('the-code');
    expect(form.get('client_id')).toBe(CLIENT_ID);
    expect(form.get('redirect_uri')).toBe(REDIRECT_URI);
    expect([...form.keys()].some((k) => /secret/i.test(k))).toBe(false);

    // The verifier sent to Spotify must hash to the challenge that was in the browser URL (RFC 7636, S256).
    const verifier = form.get('code_verifier') ?? '';
    expect(verifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(challenge);

    expect(auth.isLoggedIn()).toBe(true);
    expect(savedTokens).toEqual(['rt']);
    await expect(auth.getAccessToken()).resolves.toBe('at');
    expect(fetchMock).toHaveBeenCalledTimes(1); // no extra refresh right after login
  });

  it('rejects a callback when no login is in progress', async () => {
    const { auth, fetchMock } = setup();

    await expect(auth.handleCallback(new URLSearchParams({ code: 'x', state: 'y' }))).rejects.toThrow('No login is in progress.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects a callback with the wrong state and does not call Spotify', async () => {
    const { auth, fetchMock, begin } = setup();
    const { login } = begin();

    await expect(auth.handleCallback(new URLSearchParams({ code: 'x', state: 'forged' }))).rejects.toThrow('state mismatch');
    await expect(login).rejects.toThrow('state mismatch');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(auth.isLoggedIn()).toBe(false);
  });

  it('rejects a callback without a code', async () => {
    const { auth, begin } = setup();
    const { login, state } = begin();

    await expect(auth.handleCallback(new URLSearchParams({ state }))).rejects.toThrow('no authorization code');
    await expect(login).rejects.toThrow('no authorization code');
  });

  it('reports a cancelled login clearly', async () => {
    const { auth, begin } = setup();
    const { login, state } = begin();

    await expect(auth.handleCallback(new URLSearchParams({ error: 'access_denied', state }))).rejects.toThrow('Login was cancelled.');
    await expect(login).rejects.toThrow('Login was cancelled.');
  });

  it('includes other Spotify error codes in the message', async () => {
    const { auth, begin } = setup();
    const { login, state } = begin();

    await expect(auth.handleCallback(new URLSearchParams({ error: 'invalid_scope', state }))).rejects.toThrow('invalid_scope');
    await expect(login).rejects.toThrow('invalid_scope');
  });

  it('accepts only one callback per login', async () => {
    const { auth, fetchMock, begin } = setup();
    const { login, state } = begin();
    fetchMock.mockResolvedValueOnce(tokenResponse());
    await auth.handleCallback(new URLSearchParams({ code: 'c', state }));
    await login;

    await expect(auth.handleCallback(new URLSearchParams({ code: 'c', state }))).rejects.toThrow('No login is in progress.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['a 5xx response', () => errorResponse(503, 'upstream down'), '503'],
    ['a rejected code', () => errorResponse(400, { error: 'invalid_grant', error_description: 'Invalid authorization code' }), 'expired'],
    ['a network failure', () => Promise.reject(new TypeError('fetch failed')), 'fetch failed'],
    ['a malformed body', () => new Response('<html>not json</html>', { status: 200 }), 'JSON'],
  ])('fails the login on %s and stays logged out', async (_name, respond, message) => {
    const { auth, fetchMock, begin } = setup();
    const { login, state } = begin();
    fetchMock.mockImplementationOnce(() => Promise.resolve(respond()));

    await expect(auth.handleCallback(new URLSearchParams({ code: 'c', state }))).rejects.toThrow(message);
    await expect(login).rejects.toThrow(message);
    expect(auth.isLoggedIn()).toBe(false);
  });
});

describe('Auth: access tokens and refresh', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('throws SessionExpiredError when nobody is logged in', async () => {
    const { auth, fetchMock } = setup();

    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reuses the token until the refresh margin, then refreshes', async () => {
    const { auth, fetchMock, clock, loginOk } = setup();
    await loginOk({ access: 'first', expiresIn: 3600 });

    clock.now += 3600_000 - REFRESH_MARGIN_MS - 1;
    await expect(auth.getAccessToken()).resolves.toBe('first');
    expect(fetchMock).not.toHaveBeenCalled();

    clock.now += 1; // exactly at the margin
    fetchMock.mockResolvedValueOnce(tokenResponse({ access: 'second', refresh: null }));
    await expect(auth.getAccessToken()).resolves.toBe('second');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the refresh token and client id, but no secret', async () => {
    const { auth, fetchMock, clock, loginOk } = setup();
    await loginOk({ refresh: 'rt-1' });
    clock.now += 3600_000;
    fetchMock.mockResolvedValueOnce(tokenResponse({ access: 'new', refresh: null }));

    await auth.getAccessToken();

    const form = formOf(fetchMock.mock.calls[0] as Parameters<typeof fetch>);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('rt-1');
    expect(form.get('client_id')).toBe(CLIENT_ID);
    expect([...form.keys()].some((k) => /secret/i.test(k))).toBe(false);
  });

  it('keeps the old refresh token when Spotify does not rotate it', async () => {
    const { auth, fetchMock, clock, savedTokens, loginOk } = setup();
    await loginOk({ refresh: 'rt-1' });
    clock.now += 3600_000;
    fetchMock.mockResolvedValueOnce(tokenResponse({ access: 'a2', refresh: null }));
    await auth.getAccessToken();
    clock.now += 3600_000;
    fetchMock.mockResolvedValueOnce(tokenResponse({ access: 'a3', refresh: null }));

    await auth.getAccessToken();

    expect(formOf(fetchMock.mock.calls[1] as Parameters<typeof fetch>).get('refresh_token')).toBe('rt-1');
    expect(savedTokens).toEqual(['rt-1']);
  });

  it('saves and uses a rotated refresh token', async () => {
    const { auth, fetchMock, clock, savedTokens, loginOk } = setup();
    await loginOk({ refresh: 'rt-1' });
    clock.now += 3600_000;
    fetchMock.mockResolvedValueOnce(tokenResponse({ access: 'a2', refresh: 'rt-2' }));
    await auth.getAccessToken();
    clock.now += 3600_000;
    fetchMock.mockResolvedValueOnce(tokenResponse({ access: 'a3', refresh: null }));

    await auth.getAccessToken();

    expect(savedTokens).toEqual(['rt-1', 'rt-2']);
    expect(formOf(fetchMock.mock.calls[1] as Parameters<typeof fetch>).get('refresh_token')).toBe('rt-2');
  });

  it('shares one refresh between concurrent callers', async () => {
    const { auth, fetchMock, clock, loginOk } = setup();
    await loginOk();
    clock.now += 3600_000;
    fetchMock.mockResolvedValueOnce(tokenResponse({ access: 'shared', refresh: null }));

    const tokens = await Promise.all([auth.getAccessToken(), auth.getAccessToken(), auth.getAccessToken()]);

    expect(tokens).toEqual(['shared', 'shared', 'shared']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('ends the session when the refresh token is rejected', async () => {
    const { auth, fetchMock, clock, loginOk } = setup();
    await loginOk();
    clock.now += 3600_000;
    fetchMock.mockResolvedValueOnce(errorResponse(400, { error: 'invalid_grant', error_description: 'Refresh token revoked' }));

    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(SessionExpiredError);

    expect(auth.isLoggedIn()).toBe(false);
    fetchMock.mockClear();
    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(SessionExpiredError);
    expect(fetchMock).not.toHaveBeenCalled(); // does not keep hammering Spotify with a dead token
  });

  it.each([
    ['a 5xx response', () => Promise.resolve(errorResponse(502, 'bad gateway')), '502'],
    ['a network failure', () => Promise.reject(new TypeError('fetch failed')), 'fetch failed'],
  ])('keeps the session after %s and retries next time', async (_name, fail, message) => {
    const { auth, fetchMock, clock, loginOk } = setup();
    await loginOk();
    clock.now += 3600_000;
    fetchMock.mockImplementationOnce(fail);

    await expect(auth.getAccessToken()).rejects.toThrow(message);

    expect(auth.isLoggedIn()).toBe(true);
    fetchMock.mockResolvedValueOnce(tokenResponse({ access: 'recovered', refresh: null }));
    await expect(auth.getAccessToken()).resolves.toBe('recovered');
  });

  it('restores a saved session and refreshes on first use', async () => {
    const { auth, fetchMock } = setup();
    auth.restore('saved-refresh-token');
    fetchMock.mockResolvedValueOnce(tokenResponse({ access: 'from-restore', refresh: null }));

    expect(auth.isLoggedIn()).toBe(true);
    await expect(auth.getAccessToken()).resolves.toBe('from-restore');
    expect(formOf(fetchMock.mock.calls[0] as Parameters<typeof fetch>).get('refresh_token')).toBe('saved-refresh-token');
  });

  it('forgets the session on clear()', async () => {
    const { auth, loginOk } = setup();
    await loginOk();

    auth.clear();

    expect(auth.isLoggedIn()).toBe(false);
    await expect(auth.getAccessToken()).rejects.toBeInstanceOf(SessionExpiredError);
  });
});
