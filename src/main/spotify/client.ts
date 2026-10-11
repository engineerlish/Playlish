import { ResponseCache } from './cache';
import { SpotifyApiError, toApiError } from './errors';
import { RequestQueue, type Priority } from './queue';
import type {
  CurrentUser,
  Device,
  Paging,
  PlaybackState,
  PlaylistItem,
  Queue,
  RepeatMode,
  SavedAlbum,
  SavedTrack,
  SearchResults,
  SearchType,
  SimplifiedPlaylist,
  SimplifiedTrack,
} from './types';

/*
 * The typed Spotify Web API client: the only code that talks to api.spotify.com. Every call goes through the shared
 * request queue (priorities, Retry-After, quota pause) and, for reads, the response cache.
 */

export const API_BASE = 'https://api.spotify.com/v1';

// CHANGE HERE: device commands retry 404 while a freshly created Web Playback SDK device is not yet known.
export const DEVICE_RETRIES = 12;
export const DEVICE_RETRY_DELAY_MS = 1000;
// CHANGE HERE: API limits (verified October 2026).
export const MAX_PAGE = 50;
export const MAX_SEARCH = 10;
export const MAX_LIBRARY_URIS = 40;
// CHANGE HERE: how long reads stay cached.
const TTL = { me: 10 * 60_000, library: 60_000, search: 5 * 60_000 };

/** A response that does not have the shape the API documents. */
export class MalformedResponseError extends Error {
  constructor(readonly endpoint: string, detail: string) {
    super(`Spotify sent an unexpected response for ${endpoint}: ${detail}`);
    this.name = 'MalformedResponseError';
  }
}

export interface ClientDeps {
  /** Returns a valid access token (refreshing it if needed). */
  getAccessToken: () => Promise<string>;
  fetch?: typeof fetch;
  baseUrl?: string;
  queue?: RequestQueue;
  cache?: ResponseCache;
  delay?: (ms: number) => Promise<void>;
  /** Queue priority of playback commands and library changes: the user's own actions by default. */
  commandPriority?: Priority;
}

export interface PlayOptions {
  deviceId?: string;
  /** Tracks or episodes to play. */
  uris?: string[];
  /** An album, playlist or artist to play. */
  contextUri?: string;
  /** Where to start in the context. */
  offset?: { position: number } | { uri: string };
  positionMs?: number;
}

interface RequestOptions<T> {
  method: 'GET' | 'PUT' | 'POST' | 'DELETE';
  path: string;
  /** Statistics label, for example "GET /playlists/{id}/items". */
  endpoint: string;
  priority: Priority;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  cacheKey?: string;
  ttlMs?: number;
  retryNotFound?: boolean;
  validate?: (value: unknown) => T;
}

/** True for a plain object. */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Checks the paging envelope shared by every list endpoint. */
function paging<T>(endpoint: string): (value: unknown) => Paging<T> {
  return (value) => {
    if (!isObject(value) || !Array.isArray(value['items']) || typeof value['total'] !== 'number' || typeof value['offset'] !== 'number') {
      throw new MalformedResponseError(endpoint, 'not a page of items');
    }
    return value as unknown as Paging<T>;
  };
}

/** Splits a list into chunks of at most `size`. */
function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Keeps a page size within the API's limits. */
function clampLimit(limit: number, max: number): number {
  return Math.min(max, Math.max(1, Math.floor(limit)));
}

export class SpotifyClient {
  readonly queue: RequestQueue;
  readonly cache: ResponseCache;
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly wait: (ms: number) => Promise<void>;

  constructor(private readonly deps: ClientDeps) {
    this.queue = deps.queue ?? new RequestQueue();
    this.cache = deps.cache ?? new ResponseCache();
    this.fetchFn = deps.fetch ?? ((input, init) => fetch(input, init));
    this.baseUrl = deps.baseUrl ?? API_BASE;
    this.wait = deps.delay ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /**
   * The same client (one request queue, one cache) with playback commands and library changes at another priority. Used
   * for work the user did not start themselves, such as plugins (#102), which run at background priority.
   */
  withCommandPriority(priority: Priority): SpotifyClient {
    return new SpotifyClient({ ...this.deps, queue: this.queue, cache: this.cache, commandPriority: priority });
  }

  // ----- profile and player state -----

  /** The logged-in user (cached for a few minutes). */
  me(): Promise<CurrentUser> {
    return this.request<CurrentUser>({
      method: 'GET', path: '/me', endpoint: 'GET /me', priority: 'visible', cacheKey: 'me', ttlMs: TTL.me,
      validate: (v) => {
        if (!isObject(v) || typeof v['id'] !== 'string') throw new MalformedResponseError('GET /me', 'no user id');
        return v as unknown as CurrentUser;
      },
    });
  }

  /** What is playing on any device, or null when nothing is (Spotify answers 204). */
  playbackState(priority: Priority = 'visible'): Promise<PlaybackState | null> {
    return this.request<PlaybackState | null>({
      method: 'GET', path: '/me/player', endpoint: 'GET /me/player', priority, query: { additional_types: 'track,episode' },
      validate: (v) => {
        if (v === undefined) return null;
        if (!isObject(v) || typeof v['is_playing'] !== 'boolean' || !isObject(v['device'])) throw new MalformedResponseError('GET /me/player', 'no playback state');
        return v as unknown as PlaybackState;
      },
    });
  }

  /** Spotify Connect devices. */
  async devices(priority: Priority = 'visible'): Promise<Device[]> {
    return this.request<Device[]>({
      method: 'GET', path: '/me/player/devices', endpoint: 'GET /me/player/devices', priority,
      validate: (v) => {
        if (!isObject(v) || !Array.isArray(v['devices'])) throw new MalformedResponseError('GET /me/player/devices', 'no device list');
        return v['devices'] as Device[];
      },
    });
  }

  /** The queue, including what is playing now. */
  queueState(priority: Priority = 'visible'): Promise<Queue> {
    return this.request<Queue>({
      method: 'GET', path: '/me/player/queue', endpoint: 'GET /me/player/queue', priority,
      validate: (v) => {
        if (!isObject(v) || !Array.isArray(v['queue'])) throw new MalformedResponseError('GET /me/player/queue', 'no queue');
        return v as unknown as Queue;
      },
    });
  }

  // ----- playback commands (user priority, never cached) -----

  /** Moves playback to a device; `play` starts it there. */
  transfer(deviceId: string, play = false): Promise<void> {
    return this.command('PUT', '/me/player', 'PUT /me/player', undefined, { device_ids: [deviceId], play }, true);
  }

  /** Starts or resumes playback, optionally of specific items or a context, on a device. */
  play(options: PlayOptions = {}): Promise<void> {
    const body: Record<string, unknown> = {};
    if (options.uris) body['uris'] = options.uris;
    if (options.contextUri) body['context_uri'] = options.contextUri;
    if (options.offset) body['offset'] = options.offset;
    if (options.positionMs !== undefined) body['position_ms'] = Math.max(0, Math.floor(options.positionMs));
    return this.command('PUT', '/me/player/play', 'PUT /me/player/play', options.deviceId, Object.keys(body).length ? body : undefined, true);
  }

  pause(deviceId?: string): Promise<void> {
    return this.command('PUT', '/me/player/pause', 'PUT /me/player/pause', deviceId);
  }

  next(deviceId?: string): Promise<void> {
    return this.command('POST', '/me/player/next', 'POST /me/player/next', deviceId);
  }

  previous(deviceId?: string): Promise<void> {
    return this.command('POST', '/me/player/previous', 'POST /me/player/previous', deviceId);
  }

  seek(positionMs: number, deviceId?: string): Promise<void> {
    return this.command('PUT', '/me/player/seek', 'PUT /me/player/seek', deviceId, undefined, false, { position_ms: Math.max(0, Math.floor(positionMs)) });
  }

  shuffle(state: boolean, deviceId?: string): Promise<void> {
    return this.command('PUT', '/me/player/shuffle', 'PUT /me/player/shuffle', deviceId, undefined, false, { state });
  }

  repeat(mode: RepeatMode, deviceId?: string): Promise<void> {
    return this.command('PUT', '/me/player/repeat', 'PUT /me/player/repeat', deviceId, undefined, false, { state: mode });
  }

  /** Sets the volume of the active (or given) device, 0 to 100. */
  volume(percent: number, deviceId?: string): Promise<void> {
    return this.command('PUT', '/me/player/volume', 'PUT /me/player/volume', deviceId, undefined, false, {
      volume_percent: Math.min(100, Math.max(0, Math.round(percent))),
    });
  }

  addToQueue(uri: string, deviceId?: string): Promise<void> {
    return this.command('POST', '/me/player/queue', 'POST /me/player/queue', deviceId, undefined, false, { uri });
  }

  // ----- library and playlists (visible priority, cached) -----

  savedTracks(offset = 0, limit = MAX_PAGE, priority: Priority = 'visible'): Promise<Paging<SavedTrack>> {
    const l = clampLimit(limit, MAX_PAGE);
    return this.request({ method: 'GET', path: '/me/tracks', endpoint: 'GET /me/tracks', priority, query: { offset, limit: l }, cacheKey: `library:tracks:${offset}:${l}`, ttlMs: TTL.library, validate: paging<SavedTrack>('GET /me/tracks') });
  }

  savedAlbums(offset = 0, limit = MAX_PAGE, priority: Priority = 'visible'): Promise<Paging<SavedAlbum>> {
    const l = clampLimit(limit, MAX_PAGE);
    return this.request({ method: 'GET', path: '/me/albums', endpoint: 'GET /me/albums', priority, query: { offset, limit: l }, cacheKey: `library:albums:${offset}:${l}`, ttlMs: TTL.library, validate: paging<SavedAlbum>('GET /me/albums') });
  }

  playlists(offset = 0, limit = MAX_PAGE, priority: Priority = 'visible'): Promise<Paging<SimplifiedPlaylist>> {
    const l = clampLimit(limit, MAX_PAGE);
    return this.request({ method: 'GET', path: '/me/playlists', endpoint: 'GET /me/playlists', priority, query: { offset, limit: l }, cacheKey: `library:playlists:${offset}:${l}`, ttlMs: TTL.library, validate: paging<SimplifiedPlaylist>('GET /me/playlists') });
  }

  /** Tracks of an album, in album order. */
  albumTracks(albumId: string, offset = 0, limit = MAX_PAGE, priority: Priority = 'visible'): Promise<Paging<SimplifiedTrack>> {
    const l = clampLimit(limit, MAX_PAGE);
    return this.request({
      method: 'GET', path: `/albums/${encodeURIComponent(albumId)}/tracks`, endpoint: 'GET /albums/{id}/tracks', priority,
      query: { offset, limit: l },
      cacheKey: `album:${albumId}:${offset}:${l}`, ttlMs: TTL.library, validate: paging<SimplifiedTrack>('GET /albums/{id}/tracks'),
    });
  }

  /**
   * Entries of one of the user's own (or collaborative) playlists. Cached by snapshot_id with no expiry: a changed
   * playlist has a new snapshot. Spotify answers 403 for other people's playlists (February 2026 rule).
   */
  playlistItems(playlistId: string, snapshotId: string, offset = 0, limit = MAX_PAGE, priority: Priority = 'visible'): Promise<Paging<PlaylistItem>> {
    const l = clampLimit(limit, MAX_PAGE);
    return this.request({
      method: 'GET', path: `/playlists/${encodeURIComponent(playlistId)}/items`, endpoint: 'GET /playlists/{id}/items', priority,
      query: { offset, limit: l, additional_types: 'track,episode' },
      cacheKey: `playlist:${playlistId}:${snapshotId}:${offset}:${l}`, ttlMs: Infinity, validate: paging<PlaylistItem>('GET /playlists/{id}/items'),
    });
  }

  /** Searches; at most 10 results per type per page (the current API maximum). */
  search(query: string, types: SearchType[], offset = 0, limit = MAX_SEARCH, priority: Priority = 'user'): Promise<SearchResults> {
    const l = clampLimit(limit, MAX_SEARCH);
    const q = query.trim();
    return this.request({
      method: 'GET', path: '/search', endpoint: 'GET /search', priority, query: { q, type: types.join(','), offset, limit: l },
      cacheKey: `search:${types.join(',')}:${offset}:${l}:${q.toLowerCase()}`, ttlMs: TTL.search,
      validate: (v) => {
        if (!isObject(v)) throw new MalformedResponseError('GET /search', 'not an object');
        return v;
      },
    });
  }

  /** Saves tracks, albums, episodes, shows or playlists to the library (in chunks of 40). */
  async saveToLibrary(uris: string[]): Promise<void> {
    for (const part of chunks(uris, MAX_LIBRARY_URIS)) await this.command('PUT', '/me/library', 'PUT /me/library', undefined, undefined, false, { uris: part.join(',') });
    this.cache.invalidate('library:');
  }

  /** Removes items from the library (in chunks of 40). */
  async removeFromLibrary(uris: string[]): Promise<void> {
    for (const part of chunks(uris, MAX_LIBRARY_URIS)) await this.command('DELETE', '/me/library', 'DELETE /me/library', undefined, undefined, false, { uris: part.join(',') });
    this.cache.invalidate('library:');
  }

  /** Whether each item is in the library, in the same order as `uris`. */
  async libraryContains(uris: string[], priority: Priority = 'visible'): Promise<boolean[]> {
    const results: boolean[] = [];
    for (const part of chunks(uris, MAX_LIBRARY_URIS)) {
      const flags = await this.request<boolean[]>({
        method: 'GET', path: '/me/library/contains', endpoint: 'GET /me/library/contains', priority, query: { uris: part.join(',') },
        validate: (v) => {
          if (!Array.isArray(v) || v.length !== part.length || v.some((x) => typeof x !== 'boolean')) throw new MalformedResponseError('GET /me/library/contains', 'not one boolean per URI');
          return v as boolean[];
        },
      });
      results.push(...flags);
    }
    return results;
  }

  /** Forgets cached responses (sign out). */
  clearCache(): void {
    this.cache.clear();
  }

  // ----- plumbing -----

  /** A playback command or library change: user priority (unless set otherwise), never cached, optional device id. */
  private command(method: RequestOptions<void>['method'], path: string, endpoint: string, deviceId?: string, body?: unknown, retryNotFound = false, query: Record<string, string | number | boolean> = {}): Promise<void> {
    return this.request<void>({ method, path, endpoint, priority: this.deps.commandPriority ?? 'user', query: { ...query, device_id: deviceId }, body, retryNotFound });
  }

  /** Runs one request through the cache and the queue. */
  private async request<T>(options: RequestOptions<T>): Promise<T> {
    if (options.cacheKey) {
      const cached = this.cache.get<T>(options.cacheKey);
      if (cached !== undefined) return cached;
    }
    const url = new URL(`${this.baseUrl}${options.path}`);
    for (const [k, v] of Object.entries(options.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));
    const key = options.method === 'GET' ? `GET ${url.pathname}${url.search}` : undefined;
    const result = await this.queue.run<T>({
      priority: options.priority,
      endpoint: options.endpoint,
      ...(key ? { key } : {}),
      run: () => this.send(url, options),
    });
    if (options.cacheKey && options.ttlMs) this.cache.set(options.cacheKey, result, options.ttlMs);
    return result;
  }

  /** Sends the HTTP request (retrying 404 for device commands) and parses the response. */
  private async send<T>(url: URL, options: RequestOptions<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      const res = await this.fetchFn(url.toString(), {
        method: options.method,
        headers: {
          Authorization: `Bearer ${await this.deps.getAccessToken()}`,
          ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
      if (res.ok) {
        const text = res.status === 204 ? '' : await res.text();
        let parsed: unknown = undefined;
        if (text !== '') {
          try {
            parsed = JSON.parse(text);
          } catch {
            if (options.validate) throw new MalformedResponseError(options.endpoint, 'not JSON');
          }
        }
        return options.validate ? options.validate(parsed) : (undefined as T);
      }
      const err = await toApiError(res);
      if (err.status === 404 && options.retryNotFound && attempt < DEVICE_RETRIES) {
        await this.wait(DEVICE_RETRY_DELAY_MS);
        continue;
      }
      throw err;
    }
  }
}

/** True when Spotify refused because the login did not grant a needed permission (an older login). */
export function isInsufficientScope(error: unknown): boolean {
  return error instanceof SpotifyApiError && (error.status === 401 || error.status === 403) && /scope/i.test(error.message);
}
