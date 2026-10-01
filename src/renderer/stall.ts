/*
 * Detects playback that claims to be playing but is not advancing (issue #17), and decides how to recover.
 * Pure logic with an explicit clock, so it can be unit tested; the playback host wires it to the SDK.
 */

// CHANGE HERE: how long the position may stand still while "playing" before it counts as a stall.
export const STALL_THRESHOLD_MS = 5000;
// CHANGE HERE: a second stall within this time after a nudge means the nudge did not help, so escalate to a restart.
export const ESCALATE_WINDOW_MS = 30_000;

/** The part of the player state the detector needs. */
export interface StallSample {
  paused: boolean;
  positionMs: number;
}

/** Reports a stall when the position has not changed for the threshold while playing. */
export class StallDetector {
  private lastPosition: number | null = null;
  private changedAt = 0;

  constructor(private readonly thresholdMs: number = STALL_THRESHOLD_MS) {}

  /** Feeds one sample (null means no player state). Returns true while playback is stalled. */
  observe(sample: StallSample | null, nowMs: number): boolean {
    if (!sample || sample.paused) {
      this.reset();
      return false;
    }
    if (this.lastPosition === null || sample.positionMs !== this.lastPosition) {
      this.lastPosition = sample.positionMs;
      this.changedAt = nowMs;
      return false;
    }
    return nowMs - this.changedAt >= this.thresholdMs;
  }

  /** Forgets the current position (after a recovery attempt or a pause). */
  reset(): void {
    this.lastPosition = null;
    this.changedAt = 0;
  }
}

/** What to do about a stall. */
export type RecoveryAction = 'none' | 'nudge' | 'restart';

/** Chooses between doing nothing, a light nudge (pause and resume) and a full restart of the playback host. */
export class StallRecovery {
  private lastNudgeAt: number | null = null;

  constructor(private readonly escalateWindowMs: number = ESCALATE_WINDOW_MS) {}

  /** Call with the detector's verdict on every check. A nudge is tried first; a repeat stall soon after restarts. */
  next(stalled: boolean, nowMs: number): RecoveryAction {
    if (!stalled) return 'none';
    if (this.lastNudgeAt !== null && nowMs - this.lastNudgeAt < this.escalateWindowMs) {
      this.lastNudgeAt = null;
      return 'restart';
    }
    this.lastNudgeAt = nowMs;
    return 'nudge';
  }
}
