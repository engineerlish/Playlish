import { QuotaPausedError, SpotifyApiError } from './errors';

/*
 * The shared request queue. Every Spotify Web API call goes through it (#41), so the app, and later plugins, cannot
 * burn through the user's quota or ignore Spotify's rate limits:
 * - priorities: what the user just did, then what is on screen, then background work; first come, first served within
 *   a priority
 * - a small concurrency cap
 * - identical in-flight requests (same key) share one call
 * - a rate limit (429) pauses every request until Retry-After, then retries the same request (a few times at most)
 * - a used-up quota (429 QUOTA_EXCEEDED) is never retried, and background work is refused for a while; user actions
 *   are still tried, so the user sees the real message
 */

export type Priority = 'user' | 'visible' | 'background';

const RANK: Record<Priority, number> = { user: 0, visible: 1, background: 2 };

// CHANGE HERE: queue tuning.
export const DEFAULT_CONCURRENCY = 2;
export const DEFAULT_RATE_LIMIT_RETRIES = 2;
/** Used when Spotify sends 429 without a usable Retry-After. */
export const DEFAULT_RETRY_AFTER_SEC = 5;
/** How long background requests are refused after a quota error. */
export const QUOTA_PAUSE_MS = 10 * 60_000;

export interface QueueJob<T> {
  priority: Priority;
  /** Label for statistics, for example "GET /me/player". */
  endpoint: string;
  /** Identical keys share one in-flight call. Only give a key to requests that are safe to share (GETs). */
  key?: string;
  run: () => Promise<T>;
}

export interface QueueDeps {
  concurrency?: number;
  maxRateLimitRetries?: number;
  quotaPauseMs?: number;
  now?: () => number;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

export interface EndpointStats {
  calls: number;
  failures: number;
  rateLimited: number;
  quota: number;
  coalesced: number;
}

interface Entry {
  job: QueueJob<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  retries: number;
  seq: number;
}

/** Runs Spotify requests in priority order within Spotify's limits. */
export class RequestQueue {
  private readonly waiting: Entry[] = [];
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly stats = new Map<string, EndpointStats>();
  private active = 0;
  private seq = 0;
  private pausedUntil = 0;
  private quotaPausedUntil = 0;
  private wakeTimer: unknown = null;
  private readonly concurrency: number;
  private readonly maxRetries: number;
  private readonly quotaPauseMs: number;
  private readonly now: () => number;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;

  constructor(deps: QueueDeps = {}) {
    this.concurrency = deps.concurrency ?? DEFAULT_CONCURRENCY;
    this.maxRetries = deps.maxRateLimitRetries ?? DEFAULT_RATE_LIMIT_RETRIES;
    this.quotaPauseMs = deps.quotaPauseMs ?? QUOTA_PAUSE_MS;
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimeout ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = deps.clearTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  }

  /** Queues a request and resolves with its result (or rejects with its error). */
  run<T>(job: QueueJob<T>): Promise<T> {
    if (job.key) {
      const shared = this.inflight.get(job.key);
      if (shared) {
        this.count(job.endpoint).coalesced++;
        return shared as Promise<T>;
      }
    }
    if (job.priority === 'background' && this.now() < this.quotaPausedUntil) {
      return Promise.reject(new QuotaPausedError(new Date(this.quotaPausedUntil)));
    }
    const promise = new Promise<T>((resolve, reject) => {
      this.waiting.push({ job: job, resolve: resolve as (value: unknown) => void, reject, retries: 0, seq: this.seq++ });
    });
    if (job.key) {
      const key = job.key;
      this.inflight.set(key, promise);
      const release = () => {
        if (this.inflight.get(key) === promise) this.inflight.delete(key);
      };
      promise.then(release, release);
    }
    this.pump();
    return promise;
  }

  /** Snapshot of the queue for diagnostics. */
  status(): { waiting: number; active: number; rateLimitedUntil: Date | null; quotaPausedUntil: Date | null; endpoints: Record<string, EndpointStats> } {
    const now = this.now();
    return {
      waiting: this.waiting.length,
      active: this.active,
      rateLimitedUntil: now < this.pausedUntil ? new Date(this.pausedUntil) : null,
      quotaPausedUntil: now < this.quotaPausedUntil ? new Date(this.quotaPausedUntil) : null,
      endpoints: Object.fromEntries([...this.stats].map(([k, v]) => [k, { ...v }])),
    };
  }

  /** Starts as many waiting requests as the limits allow. */
  private pump(): void {
    const now = this.now();
    if (now < this.pausedUntil) {
      this.wakeAt(this.pausedUntil);
      return;
    }
    // Background work queued before a quota error is refused rather than left waiting for minutes.
    if (now < this.quotaPausedUntil) {
      for (let i = this.waiting.length - 1; i >= 0; i--) {
        const entry = this.waiting[i];
        if (entry && entry.job.priority === 'background') {
          this.waiting.splice(i, 1);
          entry.reject(new QuotaPausedError(new Date(this.quotaPausedUntil)));
        }
      }
    }
    while (this.active < this.concurrency && this.waiting.length > 0) {
      let best = 0;
      for (let i = 1; i < this.waiting.length; i++) {
        const a = this.waiting[i];
        const b = this.waiting[best];
        if (a && b && (RANK[a.job.priority] < RANK[b.job.priority] || (RANK[a.job.priority] === RANK[b.job.priority] && a.seq < b.seq))) best = i;
      }
      const [entry] = this.waiting.splice(best, 1);
      if (entry) void this.execute(entry);
    }
  }

  /** Runs one request and applies the rate limit and quota rules to its outcome. */
  private async execute(entry: Entry): Promise<void> {
    this.active++;
    const stats = this.count(entry.job.endpoint);
    stats.calls++;
    try {
      entry.resolve(await entry.job.run());
    } catch (error) {
      if (error instanceof SpotifyApiError && error.isRateLimit) {
        stats.rateLimited++;
        this.pausedUntil = Math.max(this.pausedUntil, this.now() + (error.retryAfterSec ?? DEFAULT_RETRY_AFTER_SEC) * 1000);
        if (entry.retries < this.maxRetries) {
          entry.retries++;
          this.waiting.push(entry); // keeps its sequence number, so it goes first within its priority
        } else {
          stats.failures++;
          entry.reject(error);
        }
      } else {
        stats.failures++;
        if (error instanceof SpotifyApiError && error.isQuota) {
          stats.quota++;
          this.quotaPausedUntil = this.now() + this.quotaPauseMs;
        }
        entry.reject(error);
      }
    } finally {
      this.active--;
      this.pump();
    }
  }

  /** Schedules a single wake-up for when a rate-limit pause ends. */
  private wakeAt(time: number): void {
    if (this.wakeTimer !== null) return;
    this.wakeTimer = this.setTimer(() => {
      this.wakeTimer = null;
      this.pump();
    }, Math.max(0, time - this.now()));
  }

  /** The statistics record for an endpoint. */
  private count(endpoint: string): EndpointStats {
    let stats = this.stats.get(endpoint);
    if (!stats) {
      stats = { calls: 0, failures: 0, rateLimited: 0, quota: 0, coalesced: 0 };
      this.stats.set(endpoint, stats);
    }
    return stats;
  }
}
