import { parseRegQuery } from './apo';

/*
 * Equalizer APO's config folder from the registry (#91), read without ever blocking the main process. The first
 * question starts a read in the background and answers "not installed" (null); when the answer comes, `onChange` runs
 * so the equalizer can be applied again. Later questions use the cached answer and refresh it in the background at most
 * once per `recheckMs`, so installing Equalizer APO is still noticed without a restart.
 */

// CHANGE HERE: how often the registry is checked again (in the background, when the EQ is used).
export const EQ_CONFIG_RECHECK_MS = 60_000;

/** Runs `reg query` and reports its output (or the error, for example when the key does not exist). */
export type RegQuery = (callback: (err: Error | null, stdout: string) => void) => void;

export class EqConfigLookup {
  private cached: { path: string | null; checkedAt: number } | null = null;
  private reading = false;

  constructor(
    private readonly query: RegQuery,
    /** Called when the answer changed (also the first time it arrives). */
    private readonly onChange: () => void,
    private readonly recheckMs = EQ_CONFIG_RECHECK_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** The config folder as last read, or null (not installed, or not known yet). Never waits. */
  path(): string | null {
    if (!this.cached || this.now() - this.cached.checkedAt > this.recheckMs) this.refresh();
    return this.cached?.path ?? null;
  }

  /** Starts a background read, unless one is running. */
  private refresh(): void {
    if (this.reading) return;
    this.reading = true;
    this.query((err, stdout) => {
      this.reading = false;
      const found = err ? null : parseRegQuery(stdout);
      const changed = this.cached === null || this.cached.path !== found;
      this.cached = { path: found, checkedAt: this.now() };
      if (changed) this.onChange();
    });
  }
}
