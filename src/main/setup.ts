/*
 * First-run setup (#40): guides the user from nothing to a working player with their own Spotify app.
 *
 *   welcome -> create-app -> client-id -> login -> player-check -> done
 *
 * Pure logic with injected side effects, so every step and every failure can be tested without Electron or Spotify.
 * The window only renders `SetupView` and sends `SetupAction`s.
 */

import type { SetupAction, SetupError, SetupErrorCode, SetupStep, SetupView } from '../shared/types';

export type { SetupAction, SetupError, SetupErrorCode, SetupStep, SetupView };

export const DASHBOARD_URL = 'https://developer.spotify.com/dashboard';

export const STEP_ORDER: readonly SetupStep[] = ['welcome', 'create-app', 'client-id', 'login', 'player-check', 'done'];

/** Outcome of starting the player after login. */
export type PlayerCheck = { ok: true } | { ok: false; kind: string; message: string };

export interface SetupDeps {
  redirectUri: string;
  /** The Client ID already in settings, if any. */
  initialClientId: string | null;
  saveClientId(clientId: string): void;
  /** Runs a browser login with this Client ID; resolves when logged in. */
  login(clientId: string): Promise<void>;
  cancelLogin(): void;
  /** Starts the player and reports whether Spotify accepts the account for playback. */
  checkPlayer(): Promise<PlayerCheck>;
  openExternal(url: string): Promise<void>;
  copyText(text: string): void;
  /** Called whenever the view changes. */
  onChange(view: SetupView): void;
  /** Called once when setup is complete. */
  onDone(): void;
}

/** Normalizes what the user pasted (spaces, case) and checks it looks like a Spotify Client ID. */
export function parseClientId(input: string): { ok: true; clientId: string } | { ok: false; message: string } {
  const value = input.replace(/\s+/g, '').toLowerCase();
  if (value === '') return { ok: false, message: 'Paste the Client ID from your app’s settings in the Spotify dashboard.' };
  if (/^[0-9a-f]{32}$/.test(value)) return { ok: true, clientId: value };
  if (/^[0-9a-f]{64}$/.test(value)) return { ok: false, message: 'That is 64 characters. The Client ID has 32; make sure you did not paste it twice.' };
  if (value.length !== 32) return { ok: false, message: `A Client ID has exactly 32 characters; this has ${value.length}.` };
  return { ok: false, message: 'A Client ID only contains the digits 0-9 and the letters a-f.' };
}

/** What can go wrong while the browser is open, shown during the wait. */
export function waitingHints(redirectUri: string): string[] {
  return [
    'If Spotify shows an error page instead of coming back to Playlish, cancel here and check:',
    'INVALID_CLIENT: Invalid client - the Client ID is mistyped, or the app was not saved in the dashboard.',
    `INVALID_CLIENT: Invalid redirect URI - the Redirect URI in the dashboard must be exactly ${redirectUri} (no trailing slash, 127.0.0.1 not localhost).`,
    'Logging in with another account than the one that owns the app: add it under User Management in the dashboard (Development Mode allows the owner and five users).',
  ];
}

/** Turns a login failure into a message with things to check. */
export function explainLoginFailure(error: unknown, redirectUri: string): SetupError {
  const message = error instanceof Error ? error.message : String(error);
  if (/cancelled/i.test(message)) {
    return { code: 'login-cancelled', message: 'Login was cancelled.', hints: ['Try again when you are ready.'] };
  }
  if (/timed out/i.test(message)) {
    return {
      code: 'login-timeout',
      message: 'Spotify did not send you back to Playlish.',
      hints: [
        'Check the Client ID against the dashboard.',
        `Check that the Redirect URI is exactly ${redirectUri} and that you pressed Save.`,
        'If you logged in with another account than the app owner, add it under User Management in the dashboard.',
      ],
    };
  }
  if (/state mismatch|no authorization code|Spotify returned an error/i.test(message)) {
    return { code: 'login-refused', message: `Spotify did not accept the login: ${message}`, hints: ['Start the login again from this window, not from an old browser tab.'] };
  }
  return { code: 'login-failed', message: `Login failed: ${message}`, hints: ['Check your internet connection and try again.'] };
}

/** Turns a failed player start into a message with things to check. */
export function explainPlayerFailure(kind: string, message: string): SetupError {
  if (kind === 'account_error' || /premium/i.test(message)) {
    return {
      code: 'not-premium',
      message: 'Spotify did not accept this account for playback.',
      hints: [
        'Playback needs Spotify Premium, for you and for the owner of the developer app.',
        'Family and Duo members need their own Premium login; a mobile-only plan is not enough.',
      ],
    };
  }
  if (kind === 'authentication_error') {
    return { code: 'player-auth', message: 'Spotify rejected the login for the player.', hints: ['Log in again; if it repeats, sign out and back in.'] };
  }
  return {
    code: 'player-failed',
    message: `The player could not start: ${message}`,
    hints: ['Check your internet connection.', 'If it keeps failing, use Report an issue so the details are kept.'],
  };
}

/** Drives the setup steps. */
export class SetupController {
  private step: SetupStep = 'welcome';
  private clientIdInput: string;
  private busy = false;
  private error: SetupError | null = null;
  private loginRun = 0;

  constructor(private readonly deps: SetupDeps) {
    this.clientIdInput = deps.initialClientId ?? '';
    if (deps.initialClientId && parseClientId(deps.initialClientId).ok) this.step = 'login';
  }

  /** The current view. */
  view(): SetupView {
    return {
      step: this.step,
      stepNumber: STEP_ORDER.indexOf(this.step) + 1,
      stepCount: STEP_ORDER.length,
      redirectUri: this.deps.redirectUri,
      clientId: this.clientIdInput,
      clientIdValid: parseClientId(this.clientIdInput).ok,
      busy: this.busy,
      error: this.error,
      waitingHints: this.step === 'login' && this.busy ? waitingHints(this.deps.redirectUri) : [],
    };
  }

  /** Handles one user action. */
  async dispatch(action: SetupAction): Promise<void> {
    switch (action.type) {
      case 'open-dashboard':
        await this.deps.openExternal(DASHBOARD_URL);
        return;
      case 'copy-redirect-uri':
        this.deps.copyText(this.deps.redirectUri);
        return;
      case 'set-client-id':
        this.clientIdInput = action.value;
        if (this.error?.code === 'client-id-format') this.error = null;
        this.changed();
        return;
      case 'back':
        if (this.busy) return;
        this.go(STEP_ORDER[Math.max(0, STEP_ORDER.indexOf(this.step) - 1)] ?? 'welcome');
        return;
      case 'next':
        await this.next();
        return;
      case 'login':
      case 'retry':
        if (this.step === 'player-check') await this.checkPlayer();
        else await this.login();
        return;
      case 'cancel-login':
        if (this.step === 'login' && this.busy) this.deps.cancelLogin();
        return;
      case 'finish':
        if (this.step === 'done') this.deps.onDone();
        return;
    }
  }

  /** Moves forward from steps that need no work. */
  private async next(): Promise<void> {
    if (this.busy) return;
    if (this.step === 'welcome') this.go('create-app');
    else if (this.step === 'create-app') this.go('client-id');
    else if (this.step === 'client-id') {
      const parsed = parseClientId(this.clientIdInput);
      if (!parsed.ok) {
        this.error = { code: 'client-id-format', message: parsed.message, hints: [] };
        this.changed();
        return;
      }
      this.clientIdInput = parsed.clientId;
      this.deps.saveClientId(parsed.clientId);
      this.go('login');
    } else if (this.step === 'login') await this.login();
  }

  /** Runs the browser login, then the player check. */
  private async login(): Promise<void> {
    const parsed = parseClientId(this.clientIdInput);
    if (!parsed.ok) {
      this.go('client-id');
      return;
    }
    const run = ++this.loginRun;
    this.busy = true;
    this.error = null;
    this.changed();
    try {
      await this.deps.login(parsed.clientId);
    } catch (err) {
      if (run !== this.loginRun) return;
      this.busy = false;
      this.error = explainLoginFailure(err, this.deps.redirectUri);
      this.changed();
      return;
    }
    if (run !== this.loginRun) return;
    this.busy = false;
    this.step = 'player-check';
    await this.checkPlayer();
  }

  /** Starts the player and waits for Spotify to accept (or refuse) the account. */
  private async checkPlayer(): Promise<void> {
    this.busy = true;
    this.error = null;
    this.changed();
    const result = await this.deps.checkPlayer();
    this.busy = false;
    if (result.ok) this.step = 'done';
    else this.error = explainPlayerFailure(result.kind, result.message);
    this.changed();
  }

  /** Switches step and clears the previous step's error. */
  private go(step: SetupStep): void {
    this.step = step;
    this.error = null;
    this.changed();
  }

  /** Tells the window. */
  private changed(): void {
    this.deps.onChange(this.view());
  }
}
