/*
 * A small in-memory cache for Spotify responses, so moving between pages does not cost quota. Entries expire after
 * their time to live; the oldest unused entries are dropped beyond a size cap, so memory stays bounded however much
 * the user browses. Playlists are cached by snapshot_id (a new snapshot means new content), with no expiry.
 */

// CHANGE HERE: how many responses to keep.
export const DEFAULT_MAX_ENTRIES = 200;

interface Item {
  value: unknown;
  expires: number;
}

export class ResponseCache {
  private readonly items = new Map<string, Item>();

  constructor(
    private readonly maxEntries: number = DEFAULT_MAX_ENTRIES,
    private readonly now: () => number = Date.now,
  ) {}

  /** The cached value, or undefined when missing or expired. Reading marks the entry as recently used. */
  get<T>(key: string): T | undefined {
    const item = this.items.get(key);
    if (!item) return undefined;
    if (this.now() >= item.expires) {
      this.items.delete(key);
      return undefined;
    }
    this.items.delete(key);
    this.items.set(key, item);
    return item.value as T;
  }

  /** Stores a value for `ttlMs` milliseconds (Infinity: until evicted). */
  set(key: string, value: unknown, ttlMs: number): void {
    this.items.delete(key);
    this.items.set(key, { value, expires: this.now() + ttlMs });
    while (this.items.size > this.maxEntries) {
      const oldest = this.items.keys().next().value;
      if (oldest === undefined) break;
      this.items.delete(oldest);
    }
  }

  /** Removes every entry whose key starts with the prefix (for example after saving to the library). */
  invalidate(prefix: string): void {
    for (const key of [...this.items.keys()]) if (key.startsWith(prefix)) this.items.delete(key);
  }

  /** Removes everything (sign out). */
  clear(): void {
    this.items.clear();
  }

  /** Number of entries, including expired ones not yet looked at. */
  get size(): number {
    return this.items.size;
  }
}
