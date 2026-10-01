/*
 * Volume ramps and fades for the playback host.
 *
 * The Web Playback SDK exposes no fade or crossfade, so fades are done by stepping the player volume. This file has no
 * DOM or Node dependencies and takes its timers as parameters, so it can be unit tested with fake timers.
 */

// CHANGE HERE: time between volume steps. 25 ms gives a smooth ramp without flooding the SDK with calls.
export const RAMP_STEP_MS = 25;
// CHANGE HERE: default duration of a fade-out or fade-in.
export const FADE_MS = 800;

/** The timer functions used for stepping; defaults to the global ones. */
export interface Timers {
  setInterval(callback: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
}

/** Anything that can have its volume set (the SDK player). Failures are reported, never thrown into the timer. */
export interface VolumeSink {
  setVolume(volume: number): Promise<void> | void;
}

const globalTimers: Timers = {
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
};

/** Keeps a volume within the valid 0..1 range. */
export function clampVolume(volume: number): number {
  return Math.min(1, Math.max(0, volume));
}

/** Linearly ramps volume between two values. Only one ramp runs at a time; starting or cancelling one stops the other. */
export class VolumeRamper {
  private active: { timer: unknown; finish: (completed: boolean) => void } | null = null;

  constructor(
    private readonly sink: VolumeSink,
    private readonly timers: Timers = globalTimers,
    private readonly stepMs: number = RAMP_STEP_MS,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {}

  /** True while a ramp is running. */
  get isRamping(): boolean {
    return this.active !== null;
  }

  /** Stops the running ramp (if any) at its current volume. Its promise resolves with `false`. */
  cancel(): void {
    const active = this.active;
    if (!active) return;
    this.timers.clearInterval(active.timer);
    this.active = null;
    active.finish(false);
  }

  /**
   * Ramps from `from` to `to` over `durationMs`. Resolves `true` when it reaches the end value, or `false` if a newer
   * ramp or a cancel interrupted it. The final step sets exactly `to` (no floating point drift).
   */
  ramp(from: number, to: number, durationMs: number): Promise<boolean> {
    this.cancel();
    const steps = Math.max(1, Math.round(durationMs / this.stepMs));

    return new Promise<boolean>((resolve) => {
      let step = 0;
      const timer = this.timers.setInterval(() => {
        step++;
        const done = step >= steps;
        this.apply(done ? to : from + (to - from) * (step / steps));
        if (done) {
          this.timers.clearInterval(timer);
          this.active = null;
          resolve(true);
        }
      }, this.stepMs);
      this.active = { timer, finish: resolve };
    });
  }

  /** Sets the volume without letting an async failure escape into the timer callback. */
  private apply(volume: number): void {
    try {
      void Promise.resolve(this.sink.setVolume(clampVolume(volume))).catch(this.onError);
    } catch (error) {
      this.onError(error);
    }
  }
}

/** The part of the SDK player needed for fading. */
export interface FadePlayer extends VolumeSink {
  getCurrentState(): Promise<{ paused: boolean } | null>;
  pause(): Promise<void>;
  resume(): Promise<void>;
}

/** Pauses with a fade-out and resumes with a fade-in. */
export class FadeController {
  constructor(
    private readonly player: FadePlayer,
    private readonly ramper: VolumeRamper,
    /** The volume the user chose; fades return to this value, not to whatever the fade left behind. */
    private readonly getBaseVolume: () => number,
    private readonly fadeMs: number = FADE_MS,
  ) {}

  /**
   * If playing: fade to silence, pause, then restore the user's volume. If paused: start silent, resume, fade up.
   * If something else changes the volume mid-fade (the user moves the slider), the fade stops and the user wins:
   * a fade-out that was interrupted does not pause.
   */
  async toggle(): Promise<void> {
    const state = await this.player.getCurrentState();
    if (!state) return;
    const base = this.getBaseVolume();

    if (!state.paused) {
      const completed = await this.ramper.ramp(base, 0, this.fadeMs);
      if (!completed) return;
      await this.player.pause();
      await this.player.setVolume(this.getBaseVolume());
    } else {
      await this.player.setVolume(0);
      await this.player.resume();
      await this.ramper.ramp(0, base, this.fadeMs);
    }
  }
}
