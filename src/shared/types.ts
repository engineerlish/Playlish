/**
 * Types shared by the main process, the preload scripts and the renderer pages.
 * This file must contain types only (no runtime code) so every build target can import it with `import type`.
 */

import type { Page } from './pages';

/** Commands the playback host (hidden SDK window) can execute directly. */
export type PlayerCommand =
  | { type: 'toggle' }
  | { type: 'fadeToggle' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'volume'; value: number }
  | { type: 'seek'; positionMs: number }
  | { type: 'mute'; muted: boolean };

export type RepeatMode = 'off' | 'context' | 'track';

/**
 * Commands the UI window may send. The main process sends them to the playback host when Playlish is the playing
 * device, or to the Web API when another device plays. Shuffle and repeat always go through the Web API (the SDK has
 * no calls for them).
 */
export type UiCommand = PlayerCommand | { type: 'shuffle'; on: boolean } | { type: 'repeat'; mode: RepeatMode };

/** An image offered by Spotify in several sizes. */
export interface ArtImage {
  url: string;
  width: number | null;
  height: number | null;
}

/** Playback state as reported by the Web Playback SDK, reduced to what the main process needs. */
export interface PlaybackState {
  paused: boolean;
  positionMs: number;
  durationMs: number;
  track: string;
  artists: string;
  album: string;
  /** Volume 0..1 the user asked for (not the transient value during a fade, and not 0 while muted). */
  volume: number;
  /** Epoch ms when the position was sampled, so the UI can interpolate without polling. */
  sampledAt: number;
  trackUri: string | null;
  /** Album art (or episode image) in every size Spotify offers. */
  images: ArtImage[];
  shuffle: boolean;
  repeat: RepeatMode;
  muted: boolean;
}

/** What the Now Playing bar shows, from this device (SDK events) or another device (polled Web API). */
export interface NowPlaying {
  /** 'here' when Playlish itself is the playing device. */
  source: 'here' | 'elsewhere';
  /** Name of the other device, when source is 'elsewhere'. */
  deviceName: string | null;
  paused: boolean;
  positionMs: number;
  durationMs: number;
  /** Epoch ms when positionMs was sampled. */
  sampledAt: number;
  track: string;
  artists: string;
  trackUri: string | null;
  /** The smallest image big enough for the bar, or null. */
  artUrl: string | null;
  shuffle: boolean;
  repeat: RepeatMode;
  /** 0..1, or null when the device does not allow volume changes. */
  volume: number | null;
  muted: boolean;
}

/** One resource sample covering every process of the app (main, GPU, renderers, utility). */
export interface MetricsSample {
  time: string;
  processes: number;
  workingSetMb: number;
  privateMb: number;
  cpuPercent: number;
}

/* ----- Spotify Connect devices (#44) ----- */

export interface DeviceInfo {
  id: string;
  name: string;
  /** Spotify's device type, such as Computer, Smartphone or Speaker. */
  type: string;
  active: boolean;
  /** Spotify does not allow controlling this device through the Web API. */
  restricted: boolean;
  /** Playlish's own player. */
  isThisDevice: boolean;
  /** 0..1, or null when unknown or not adjustable. */
  volume: number | null;
}

export interface DevicesView {
  /** Null until the list was loaded once. */
  list: DeviceInfo[] | null;
  loading: boolean;
  /** Id of the device playback is being moved to. */
  transferring: string | null;
  error: string | null;
}

/* ----- first-run setup (#40) ----- */

export type SetupStep = 'welcome' | 'create-app' | 'client-id' | 'login' | 'player-check' | 'done';

export type SetupErrorCode =
  | 'client-id-format'
  | 'login-cancelled'
  | 'login-timeout'
  | 'login-refused'
  | 'login-failed'
  | 'not-premium'
  | 'player-auth'
  | 'player-failed';

export interface SetupError {
  code: SetupErrorCode;
  message: string;
  /** Things to check, most likely first. */
  hints: string[];
}

/** Everything the window needs to draw the current step. */
export interface SetupView {
  step: SetupStep;
  stepNumber: number;
  stepCount: number;
  redirectUri: string;
  clientId: string;
  clientIdValid: boolean;
  busy: boolean;
  error: SetupError | null;
  /** Shown while waiting for the browser: Spotify's own error pages never come back to Playlish. */
  waitingHints: string[];
}

export type SetupAction =
  | { type: 'next' }
  | { type: 'back' }
  | { type: 'open-dashboard' }
  | { type: 'copy-redirect-uri' }
  | { type: 'set-client-id'; value: string }
  | { type: 'login' }
  | { type: 'cancel-login' }
  | { type: 'retry' }
  | { type: 'finish' };

/** Everything the UI window needs to draw itself, pushed from main whenever something changes. */
export interface Snapshot {
  status: string;
  configError: string | null;
  loggedIn: boolean;
  deviceReady: boolean;
  /** What is playing here or on another device; null when nothing is known to be playing. */
  playback: NowPlaying | null;
  devices: DevicesView;
  metrics: MetricsSample | null;
  perfLogPath: string;
  /** Set after a crash the user has not been asked about yet. */
  crashNotice: { when: string; process: string; kind: string } | null;
  /** The first-run wizard, while setup is not finished; null otherwise. */
  setup: SetupView | null;
  /** The current login lacks permissions Playlish needs; the user should log in again. */
  needsRelogin: boolean;
  /** The page to open when the window opens. */
  lastPage: Page;
  /** The last four characters of the Client ID, for display, or null before setup. */
  clientIdHint: string | null;
  appVersion: string;
}

/** API exposed to the playback host page by its preload script. */
export interface HostApi {
  getToken(): Promise<string>;
  ready(deviceId: string): void;
  state(state: PlaybackState | null): void;
  error(kind: string, message: string): void;
  /** Diagnostic line for the app log (kept out of the error path so it is not mistaken for a failure). */
  log(message: string): void;
  /** Forwards an uncaught page error to the main process log. */
  reportError(message: string, stack?: string): void;
  onCommand(callback: (command: PlayerCommand) => void): void;
}

/** API exposed to the UI page by its preload script. */
export interface UiApi {
  login(): void;
  command(command: UiCommand): void;
  onSnapshot(callback: (snapshot: Snapshot) => void): void;
  requestSnapshot(): void;
  /** Remembers the page the user is on. */
  navigate(page: Page): void;
  /** Loads the Spotify Connect device list (on demand; it is never polled). */
  refreshDevices(): void;
  /** Moves playback to a device from the list. */
  transfer(deviceId: string): void;
  /** Sends an action to the first-run wizard. */
  setup(action: SetupAction): void;
  /** Signs out: deletes the stored session and stops the player. */
  signOut(): void;
  /** Saves a redacted diagnostics file chosen by the user. */
  exportDiagnostics(): void;
  /** Opens a pre-filled GitHub issue in the browser for the user to review. */
  reportIssue(): void;
  /** Answers the crash notice: report it in the browser, or dismiss it. */
  answerCrashNotice(action: 'report' | 'dismiss'): void;
  /** Forwards an uncaught page error to the main process log. */
  reportError(message: string, stack?: string): void;
}
