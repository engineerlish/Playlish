// CHANGE HERE: default limit. This many errors inside the window counts as a burst (a failure loop, not a blip).
export const DEFAULT_MAX_ERRORS = 3;
export const DEFAULT_WINDOW_MS = 10_000;

/**
 * Detects bursts of errors. The Web Playback SDK retries a failed Widevine licence request in a tight loop, which
 * hammers Spotify's licence server; the caller stops the player when a burst is detected.
 */
export class ErrorBurstLimiter {
  private times: number[] = [];

  constructor(
    private readonly maxErrors: number = DEFAULT_MAX_ERRORS,
    private readonly windowMs: number = DEFAULT_WINDOW_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records one error and returns true when the burst limit has been reached. */
  record(): boolean {
    const now = this.now();
    this.times = this.times.filter((time) => now - time < this.windowMs);
    this.times.push(now);
    return this.times.length >= this.maxErrors;
  }

  /** Forgets all recorded errors (for example after a fresh login). */
  reset(): void {
    this.times = [];
  }
}
