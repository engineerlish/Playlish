/**
 * Types shared by the main process, the preload scripts and the renderer pages.
 * This file must contain types only (no runtime code) so every build target can import it with `import type`.
 */

/** Commands the playback host (hidden SDK window) can execute directly. */
export type PlayerCommand =
  | { type: 'toggle' }
  | { type: 'fadeToggle' }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'volume'; value: number };

/** Commands the UI window may send; `playTrack` is handled by the main process through the Web API. */
export type UiCommand = PlayerCommand | { type: 'playTrack' };

/** Playback state as reported by the Web Playback SDK, reduced to what the UI needs. */
export interface PlaybackState {
  paused: boolean;
  positionMs: number;
  durationMs: number;
  track: string;
  artists: string;
  /** Volume 0..1 the user asked for (not the transient value during a fade). */
  volume: number;
  /** Epoch ms when the position was sampled, so the UI can interpolate without polling. */
  sampledAt: number;
}

/** One resource sample covering every process of the app (main, GPU, renderers, utility). */
export interface MetricsSample {
  time: string;
  processes: number;
  workingSetMb: number;
  privateMb: number;
  cpuPercent: number;
}

/** Everything the UI window needs to draw itself, pushed from main whenever something changes. */
export interface Snapshot {
  status: string;
  configError: string | null;
  loggedIn: boolean;
  deviceReady: boolean;
  playback: PlaybackState | null;
  metrics: MetricsSample | null;
  perfLogPath: string;
  /** Set after a crash the user has not been asked about yet. */
  crashNotice: { when: string; process: string; kind: string } | null;
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
  /** Saves a redacted diagnostics file chosen by the user. */
  exportDiagnostics(): void;
  /** Opens a pre-filled GitHub issue in the browser for the user to review. */
  reportIssue(): void;
  /** Answers the crash notice: report it in the browser, or dismiss it. */
  answerCrashNotice(action: 'report' | 'dismiss'): void;
  /** Forwards an uncaught page error to the main process log. */
  reportError(message: string, stack?: string): void;
}
