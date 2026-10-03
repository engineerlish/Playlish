import { describe, expect, it, vi } from 'vitest';
import {
  DASHBOARD_URL,
  SetupController,
  explainLoginFailure,
  explainPlayerFailure,
  parseClientId,
  waitingHints,
  type PlayerCheck,
  type SetupDeps,
  type SetupView,
} from '../src/main/setup';

const REDIRECT = 'http://127.0.0.1:43821/callback';
const ID = '0123456789abcdef0123456789abcdef';

/** A controller with recording fakes; login and the player check are controlled by the test. */
function setup(overrides: Partial<SetupDeps> = {}) {
  const views: SetupView[] = [];
  const saved: string[] = [];
  const opened: string[] = [];
  const copied: string[] = [];
  let done = 0;
  let loginResolve!: () => void;
  let loginReject!: (e: Error) => void;
  let playerResolve!: (r: PlayerCheck) => void;
  const login = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        loginResolve = resolve;
        loginReject = reject;
      }),
  );
  const checkPlayer = vi.fn(
    () =>
      new Promise<PlayerCheck>((resolve) => {
        playerResolve = resolve;
      }),
  );
  const cancelLogin = vi.fn(() => loginReject(new Error('Login was cancelled.')));
  const deps: SetupDeps = {
    redirectUri: REDIRECT,
    initialClientId: null,
    saveClientId: (id) => saved.push(id),
    login,
    cancelLogin,
    checkPlayer,
    openExternal: (url) => {
      opened.push(url);
      return Promise.resolve();
    },
    copyText: (text) => copied.push(text),
    onChange: (v) => views.push(v),
    onDone: () => done++,
    ...overrides,
  };
  const controller = new SetupController(deps);
  return {
    controller,
    views,
    saved,
    opened,
    copied,
    login,
    cancelLogin,
    checkPlayer,
    done: () => done,
    finishLogin: () => loginResolve(),
    failLogin: (message: string) => loginReject(new Error(message)),
    finishPlayer: (r: PlayerCheck) => playerResolve(r),
    last: () => views.at(-1) as SetupView,
  };
}

/** Lets pending promise callbacks run. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('parseClientId', () => {
  it('accepts a Client ID and normalizes spaces and case', () => {
    expect(parseClientId(` ${ID.slice(0, 16).toUpperCase()} ${ID.slice(16)}\n`)).toEqual({ ok: true, clientId: ID });
  });

  it.each([
    ['', /Paste the Client ID/],
    [ID.slice(1), /exactly 32 characters; this has 31/],
    [`${ID}${ID}`, /64 characters/],
    ['z'.repeat(32), /0-9 and the letters a-f/],
    ['PASTE_YOUR_SPOTIFY_CLIENT_ID_HERE', /exactly 32 characters/],
  ])('explains what is wrong with %j', (input, message) => {
    const result = parseClientId(input);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(message);
  });
});

describe('explaining failures', () => {
  it('turns a timeout into the likely causes, including the exact Redirect URI', () => {
    const error = explainLoginFailure(new Error('Login timed out. Please try again.'), REDIRECT);

    expect(error.code).toBe('login-timeout');
    expect(error.hints.join(' ')).toContain(REDIRECT);
    expect(error.hints.join(' ')).toMatch(/User Management/);
  });

  it('recognises a cancelled login, a refused one and anything else', () => {
    expect(explainLoginFailure(new Error('Login was cancelled.'), REDIRECT).code).toBe('login-cancelled');
    expect(explainLoginFailure(new Error('Login response did not match the request (state mismatch).'), REDIRECT).code).toBe('login-refused');
    expect(explainLoginFailure(new Error('Spotify returned an error: invalid_scope'), REDIRECT).code).toBe('login-refused');
    expect(explainLoginFailure(new TypeError('fetch failed'), REDIRECT)).toMatchObject({ code: 'login-failed', message: 'Login failed: fetch failed' });
  });

  it('explains a non-Premium account in plain words', () => {
    const error = explainPlayerFailure('account_error', 'This functionality is restricted to premium users only');

    expect(error.code).toBe('not-premium');
    expect(error.hints.join(' ')).toMatch(/Premium/);
  });

  it('separates player authentication problems from other player failures', () => {
    expect(explainPlayerFailure('authentication_error', 'Invalid token scopes.').code).toBe('player-auth');
    expect(explainPlayerFailure('initialization_error', 'Failed to initialize player').code).toBe('player-failed');
  });

  it('shows Spotify\'s own error page names while waiting, because those pages never come back', () => {
    const hints = waitingHints(REDIRECT).join(' ');

    expect(hints).toMatch(/Invalid client/);
    expect(hints).toMatch(/Invalid redirect URI/);
    expect(hints).toContain(REDIRECT);
  });
});

describe('SetupController', () => {
  it('walks a new user through every step to done', async () => {
    const s = setup();
    expect(s.controller.view()).toMatchObject({ step: 'welcome', stepNumber: 1, stepCount: 6 });

    await s.controller.dispatch({ type: 'next' });
    await s.controller.dispatch({ type: 'open-dashboard' });
    await s.controller.dispatch({ type: 'copy-redirect-uri' });
    await s.controller.dispatch({ type: 'next' });
    await s.controller.dispatch({ type: 'set-client-id', value: ID.toUpperCase() });
    expect(s.last().clientIdValid).toBe(true);
    await s.controller.dispatch({ type: 'next' });
    const loggingIn = s.controller.dispatch({ type: 'login' });
    await flush();
    expect(s.last()).toMatchObject({ step: 'login', busy: true });
    expect(s.last().waitingHints.length).toBeGreaterThan(0);
    s.finishLogin();
    await flush();
    expect(s.last()).toMatchObject({ step: 'player-check', busy: true });
    s.finishPlayer({ ok: true });
    await loggingIn;
    await s.controller.dispatch({ type: 'finish' });

    expect(s.last()).toMatchObject({ step: 'done', busy: false, error: null });
    expect(s.opened).toEqual([DASHBOARD_URL]);
    expect(s.copied).toEqual([REDIRECT]);
    expect(s.saved).toEqual([ID]);
    expect(s.login).toHaveBeenCalledWith(ID);
    expect(s.done()).toBe(1);
  });

  it('will not leave the Client ID step with an invalid value, and clears the error as you type', async () => {
    const s = setup();
    await s.controller.dispatch({ type: 'next' });
    await s.controller.dispatch({ type: 'next' });
    await s.controller.dispatch({ type: 'set-client-id', value: 'abc' });

    await s.controller.dispatch({ type: 'next' });
    expect(s.last()).toMatchObject({ step: 'client-id', error: { code: 'client-id-format' } });
    expect(s.saved).toEqual([]);

    await s.controller.dispatch({ type: 'set-client-id', value: ID });
    expect(s.last().error).toBeNull();
  });

  it('starts at the login step when a Client ID is already saved', () => {
    const s = setup({ initialClientId: ID });

    expect(s.controller.view()).toMatchObject({ step: 'login', clientId: ID });
  });

  it('cancels a login in progress and offers to try again', async () => {
    const s = setup({ initialClientId: ID });

    const loggingIn = s.controller.dispatch({ type: 'login' });
    await flush();
    await s.controller.dispatch({ type: 'cancel-login' });
    await loggingIn;

    expect(s.cancelLogin).toHaveBeenCalled();
    expect(s.last()).toMatchObject({ step: 'login', busy: false, error: { code: 'login-cancelled' } });
  });

  it('explains a login timeout and lets the user retry', async () => {
    const s = setup({ initialClientId: ID });

    const first = s.controller.dispatch({ type: 'login' });
    await flush();
    s.failLogin('Login timed out. Please try again.');
    await first;
    expect(s.last().error?.code).toBe('login-timeout');

    const second = s.controller.dispatch({ type: 'retry' });
    await flush();
    expect(s.last()).toMatchObject({ busy: true, error: null });
    s.finishLogin();
    await flush();
    s.finishPlayer({ ok: true });
    await second;
    expect(s.last().step).toBe('done');
  });

  it('stops at the player check for a non-Premium account and can retry the check alone', async () => {
    const s = setup({ initialClientId: ID });

    const run = s.controller.dispatch({ type: 'login' });
    await flush();
    s.finishLogin();
    await flush();
    s.finishPlayer({ ok: false, kind: 'account_error', message: 'premium users only' });
    await run;
    expect(s.last()).toMatchObject({ step: 'player-check', error: { code: 'not-premium' } });

    const retry = s.controller.dispatch({ type: 'retry' });
    await flush();
    s.finishPlayer({ ok: true });
    await retry;

    expect(s.login).toHaveBeenCalledTimes(1);
    expect(s.checkPlayer).toHaveBeenCalledTimes(2);
    expect(s.last().step).toBe('done');
  });

  it('goes back one step at a time but not while busy, and finish only works at the end', async () => {
    const s = setup();
    await s.controller.dispatch({ type: 'next' });
    await s.controller.dispatch({ type: 'back' });
    expect(s.last().step).toBe('welcome');
    await s.controller.dispatch({ type: 'back' });
    expect(s.last().step).toBe('welcome');
    await s.controller.dispatch({ type: 'finish' });
    expect(s.done()).toBe(0);

    const busy = setup({ initialClientId: ID });
    const run = busy.controller.dispatch({ type: 'login' });
    await flush();
    await busy.controller.dispatch({ type: 'back' });
    expect(busy.last().step).toBe('login');
    busy.failLogin('Login was cancelled.');
    await run;
  });

  it('sends the user back to the Client ID step if login is attempted without a valid one', async () => {
    const s = setup({ initialClientId: 'not-valid' });

    await s.controller.dispatch({ type: 'login' });

    expect(s.last().step).toBe('client-id');
    expect(s.login).not.toHaveBeenCalled();
  });
});
