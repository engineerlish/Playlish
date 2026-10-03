import type { PlaybackState } from '../shared/types';

/*
 * Soak driver: exercises the parts of the app most likely to leak, over and over, so a long run shows whether memory
 * keeps growing. Only started when PLAYLISH_SOAK=1 (the performance harness sets it); never active for users.
 *
 * One cycle: open the UI window, feed simulated playback state events at 2 per second (the same path the playback
 * host uses), close the UI window, then report a pause.
 */

// CHANGE HERE: time between cycle starts, and the timing inside a cycle.
export const SOAK_CYCLE_MS = 10_000;
export const SOAK_STATE_EVENTS = 6;
export const SOAK_STATE_INTERVAL_MS = 500;
export const SOAK_CLOSE_UI_AFTER_MS = 5_000;
export const SOAK_PAUSE_AFTER_MS = 7_000;
// CHANGE HERE: write a progress line to the log every this many cycles.
export const SOAK_LOG_EVERY = 30;

/** What the driver needs from the app. */
export interface SoakHooks {
  openUi(): void;
  closeUi(): void;
  /** Feeds a playback state through the same code path as the playback host. */
  simulateState(state: PlaybackState | null): void;
  /** Progress reporting. */
  progress(cycles: number): void;
}

/** The timer functions used; replaced by fakes in tests. */
export interface SoakTimers {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

const realTimers: SoakTimers = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

/** A simulated state of the soak test track. */
function soakState(paused: boolean, positionMs: number, now: number): PlaybackState {
  return { paused, positionMs, durationMs: 213_000, track: 'Soak test track', artists: 'Playlish', volume: 0.5, sampledAt: now };
}

/** Starts cycling immediately and returns a function that stops the driver and any pending steps. */
export function startSoakDriver(hooks: SoakHooks, timers: SoakTimers = realTimers): () => void {
  let cycles = 0;
  const pending = new Set<unknown>();

  /** Schedules one step of the current cycle and remembers it so stop() can cancel it. */
  const later = (ms: number, step: () => void): void => {
    const handle = timers.setTimeout(() => {
      pending.delete(handle);
      step();
    }, ms);
    pending.add(handle);
  };

  /** Runs one full open, play, close, pause cycle. */
  const cycle = (): void => {
    cycles++;
    hooks.openUi();
    for (let i = 1; i <= SOAK_STATE_EVENTS; i++) {
      later(i * SOAK_STATE_INTERVAL_MS, () => hooks.simulateState(soakState(false, i * SOAK_STATE_INTERVAL_MS, timers.now())));
    }
    later(SOAK_CLOSE_UI_AFTER_MS, () => hooks.closeUi());
    later(SOAK_PAUSE_AFTER_MS, () => hooks.simulateState(soakState(true, SOAK_STATE_EVENTS * SOAK_STATE_INTERVAL_MS, timers.now())));
    if (cycles % SOAK_LOG_EVERY === 0) hooks.progress(cycles);
  };

  cycle();
  const interval = timers.setInterval(cycle, SOAK_CYCLE_MS);
  return () => {
    timers.clearInterval(interval);
    for (const handle of pending) timers.clearTimeout(handle);
    pending.clear();
  };
}
