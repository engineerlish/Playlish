import type { Panel, PluginPermission, PluginUiSlot } from '../../shared/plugins';
import type { NowPlaying, PlayerCommand } from '../../shared/types';
import type { PlayOptions } from '../spotify/client';
import type { Paging, SavedTrack, SearchResults, SearchType } from '../spotify/types';
import { PanelError, parsePanel } from './panel';
import { StorageError, type PluginStorage } from './storage';

/*
 * Plugin API v1 (#102, plan #82): what a plugin may ask Playlish to do (actions) and what it is told (events).
 *
 * Every action is checked here, in the main process, on every call:
 * 1. the plugin is installed and on, and was granted the permission the action needs (checked at the time of the call,
 *    so turning a plugin off or uninstalling it takes effect at once);
 * 2. its arguments are valid (types, ranges, Spotify URIs);
 * 3. it stays under the rate limit for actions that reach Spotify (60 a minute); a plugin that keeps flooding is
 *    turned off.
 * Spotify calls go through the shared request queue at background priority, so the user's own actions always come
 * first, and plugins never see a token: they get plain data back.
 */

// CHANGE HERE: calls to Spotify and panel updates a plugin may make per minute, and refused calls in a minute after which
// it is turned off.
export const PLUGIN_RATE_PER_MINUTE = 60;
export const PLUGIN_UI_RATE_PER_MINUTE = 120;
export const PLUGIN_FLOOD_LIMIT = 120;
const MINUTE_MS = 60_000;
const MAX_URIS = 50;
const MAX_QUERY = 100;
const MAX_SEARCH_RESULTS = 20;
const MAX_LIKED_PAGE = 50;

/** Events a plugin can listen to. The playback ones need "playback.read"; "ui.action" comes from the plugin's own panel. */
export const PLAYBACK_EVENTS = ['track.changed', 'playback.state', 'queue.changed', 'device.changed'] as const;
export const PLUGIN_EVENTS = [...PLAYBACK_EVENTS, 'ui.action'] as const;
export type PluginEvent = (typeof PLAYBACK_EVENTS)[number];
export const EVENT_PERMISSION: PluginPermission = 'playback.read';

export class PluginApiError extends Error {
  override name = 'PluginApiError';
}

/** The Spotify calls the API needs, at background priority (a SpotifyClient from withCommandPriority, or a fake). */
export interface PluginSpotify {
  play(options?: PlayOptions): Promise<void>;
  pause(deviceId?: string): Promise<void>;
  next(deviceId?: string): Promise<void>;
  previous(deviceId?: string): Promise<void>;
  volume(percent: number, deviceId?: string): Promise<void>;
  addToQueue(uri: string, deviceId?: string): Promise<void>;
  saveToLibrary(uris: string[]): Promise<void>;
  removeFromLibrary(uris: string[]): Promise<void>;
  savedTracks(offset: number, limit: number, priority: 'background'): Promise<Paging<SavedTrack>>;
  search(query: string, types: SearchType[], offset: number, limit: number, priority: 'background'): Promise<SearchResults>;
}

export interface PluginApiDeps {
  /** Permissions of an installed plugin that is on, or null for one that is not (uninstalled, off, or safe mode). */
  granted(pluginId: string): PluginPermission[] | null;
  /** Null before login. */
  spotify(): PluginSpotify | null;
  playback: {
    view(): NowPlaying | null;
    playingHere(): boolean;
    /** The device playing now, else this computer (null before the player is ready). */
    targetDeviceId(): string | null;
    /** Sends a command to this computer's player; false when there is none. */
    sendToHost(command: PlayerCommand): boolean;
  };
  /** Sets the equalizer preset (#91) and says how it went ("applied", "off", "not-installed", "needs-setup"). */
  setEqPreset(preset: string): Promise<string>;
  eqPresets: readonly string[];
  storage: PluginStorage;
  /** A plugin kept flooding the API: turn it off. */
  onFlood(pluginId: string): void;
  /** A queue change made by a plugin, so listeners hear about it (queue.changed). */
  onQueueChanged(): void;
  /** The UI slots in the plugin's manifest (#103). */
  uiSlots(pluginId: string): PluginUiSlot[];
  /** Shows (or with null, removes) a plugin's panel in a slot. */
  setPanel(pluginId: string, slot: PluginUiSlot, panel: Panel | null): void;
  now?: () => number;
}

interface ActionContext {
  pluginId: string;
  deps: PluginApiDeps;
}

interface ActionDef {
  /** The permission it needs, or null for none (searching the public catalog). */
  permission: PluginPermission | null;
  /** The rate limit it counts toward: Spotify calls, panel updates, or none (local and cheap). */
  limit: 'spotify' | 'ui' | null;
  /** Returns the result, or a promise of it. */
  run(args: Record<string, unknown>, ctx: ActionContext): unknown;
}

// ----- argument checks -----

const URI = /^spotify:(track|episode|album|playlist|artist|show):[A-Za-z0-9]{1,64}$/;

/** The args as an object (null and undefined become an empty object). */
function object(args: unknown): Record<string, unknown> {
  if (args === null || args === undefined) return {};
  if (typeof args !== 'object' || Array.isArray(args)) throw new PluginApiError('The arguments must be an object.');
  return args as Record<string, unknown>;
}

function uri(value: unknown, field: string, kinds: string[]): string {
  const match = typeof value === 'string' ? URI.exec(value) : null;
  if (!match || !kinds.includes(match[1] ?? '')) throw new PluginApiError(`"${field}" must be a Spotify ${kinds.join(' or ')} URI.`);
  return value as string;
}

function uriList(value: unknown, field: string, kinds: string[]): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_URIS) throw new PluginApiError(`"${field}" must be a list of 1 to ${MAX_URIS} URIs.`);
  return value.map((v, i) => uri(v, `${field}[${i}]`, kinds));
}

function integer(value: unknown, field: string, min: number, max: number, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new PluginApiError(`"${field}" must be a whole number from ${min} to ${max}.`);
  return value;
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) throw new PluginApiError(`"${field}" must be text of 1 to ${max} characters.`);
  return value;
}

function storageKey(value: unknown): string {
  if (typeof value !== 'string') throw new PluginApiError('"key" must be text.');
  return value;
}

// ----- what plugins get back -----

/** A track as plugins see it. */
interface PluginTrack {
  uri: string;
  name: string;
  artists: string[];
  album: string;
  durationMs: number;
}

/** What plays now, as plugins see it (no artwork URLs, no device ids). */
export function playbackForPlugins(view: NowPlaying | null): Record<string, unknown> | null {
  if (!view) return null;
  return {
    track: { uri: view.trackUri, name: view.track, artists: view.artists },
    paused: view.paused,
    positionMs: view.positionMs,
    durationMs: view.durationMs,
    device: view.source === 'here' ? 'this computer' : (view.deviceName ?? 'another device'),
    shuffle: view.shuffle,
    repeat: view.repeat,
    volume: view.volume,
  };
}

/** Runs a playback command on whichever device plays: this computer's player, or another device through the Web API. */
async function control(ctx: ActionContext, here: PlayerCommand | null, elsewhere: (s: PluginSpotify, deviceId: string | undefined) => Promise<void>): Promise<null> {
  const { playback } = ctx.deps;
  if (playback.playingHere() && here) {
    if (!playback.sendToHost(here)) throw new PluginApiError('The player on this computer is not running.');
    return null;
  }
  await elsewhere(spotifyOf(ctx), playback.targetDeviceId() ?? undefined);
  return null;
}

function spotifyOf(ctx: ActionContext): PluginSpotify {
  const spotify = ctx.deps.spotify();
  if (!spotify) throw new PluginApiError('Not logged in to Spotify.');
  return spotify;
}

// ----- the actions -----

const ACTIONS: Record<string, ActionDef> = {
  'playback.get': {
    permission: 'playback.read',
    limit: null,
    run: (_args, ctx) => playbackForPlugins(ctx.deps.playback.view()),
  },
  play: {
    permission: 'playback.control',
    limit: 'spotify',
    run: async (args, ctx) => {
      const options: PlayOptions = {};
      if (args['uris'] !== undefined) options.uris = uriList(args['uris'], 'uris', ['track', 'episode']);
      if (args['contextUri'] !== undefined) options.contextUri = uri(args['contextUri'], 'contextUri', ['album', 'playlist', 'artist', 'show']);
      if (options.uris && options.contextUri) throw new PluginApiError('Give "uris" or "contextUri", not both.');
      if (args['offset'] !== undefined) options.offset = { position: integer(args['offset'], 'offset', 0, 10_000, 0) };
      const deviceId = ctx.deps.playback.targetDeviceId();
      if (deviceId) options.deviceId = deviceId;
      await spotifyOf(ctx).play(options);
      return null;
    },
  },
  pause: {
    permission: 'playback.control',
    limit: 'spotify',
    run: (_args, ctx) => {
      const view = ctx.deps.playback.view();
      if (view?.paused) return null;
      return control(ctx, { type: 'toggle' }, (s, d) => s.pause(d));
    },
  },
  next: { permission: 'playback.control', limit: 'spotify', run: (_args, ctx) => control(ctx, { type: 'next' }, (s, d) => s.next(d)) },
  previous: { permission: 'playback.control', limit: 'spotify', run: (_args, ctx) => control(ctx, { type: 'previous' }, (s, d) => s.previous(d)) },
  'queue.add': {
    permission: 'playback.control',
    limit: 'spotify',
    run: async (args, ctx) => {
      const target = uri(args['uri'], 'uri', ['track', 'episode']);
      await spotifyOf(ctx).addToQueue(target, ctx.deps.playback.targetDeviceId() ?? undefined);
      ctx.deps.onQueueChanged();
      return null;
    },
  },
  'library.save': {
    permission: 'library.modify',
    limit: 'spotify',
    run: async (args, ctx) => {
      const uris = uriList(args['uris'], 'uris', ['track', 'album', 'episode', 'show']);
      if (args['remove'] !== undefined && typeof args['remove'] !== 'boolean') throw new PluginApiError('"remove" must be true or false.');
      if (args['remove'] === true) await spotifyOf(ctx).removeFromLibrary(uris);
      else await spotifyOf(ctx).saveToLibrary(uris);
      return null;
    },
  },
  'library.liked': {
    permission: 'library.read',
    limit: 'spotify',
    run: async (args, ctx) => {
      const offset = integer(args['offset'], 'offset', 0, 100_000, 0);
      const limit = integer(args['limit'], 'limit', 1, MAX_LIKED_PAGE, MAX_LIKED_PAGE);
      const page = await spotifyOf(ctx).savedTracks(offset, limit, 'background');
      return {
        total: page.total,
        offset: page.offset,
        items: page.items.map((i): PluginTrack & { addedAt: string } => ({
          uri: i.track.uri,
          name: i.track.name,
          artists: i.track.artists.map((a) => a.name),
          album: i.track.album.name,
          durationMs: i.track.duration_ms,
          addedAt: i.added_at,
        })),
      };
    },
  },
  search: {
    permission: null,
    limit: 'spotify',
    run: async (args, ctx) => {
      const query = text(args['query'], 'query', MAX_QUERY);
      const type = args['type'] ?? 'track';
      if (type !== 'track' && type !== 'album' && type !== 'artist' && type !== 'playlist') throw new PluginApiError('"type" must be "track", "album", "artist" or "playlist".');
      const limit = integer(args['limit'], 'limit', 1, MAX_SEARCH_RESULTS, 10);
      const results = await spotifyOf(ctx).search(query, [type], 0, limit, 'background');
      const items = (type === 'track' ? results.tracks : type === 'album' ? results.albums : type === 'artist' ? results.artists : results.playlists)?.items ?? [];
      return items
        .filter((i): i is NonNullable<typeof i> => i !== null)
        .map((i) => {
          const base = { uri: i.uri, name: i.name };
          if ('artists' in i && Array.isArray(i.artists)) return { ...base, artists: i.artists.map((a: { name: string }) => a.name) };
          return base;
        });
    },
  },
  'volume.set': {
    permission: 'audio.control',
    limit: 'spotify',
    run: (args, ctx) => {
      if (typeof args['value'] !== 'number' || !(args['value'] >= 0 && args['value'] <= 1)) throw new PluginApiError('"value" must be a number from 0 to 1.');
      const value = args['value'];
      return control(ctx, { type: 'volume', value }, (s, d) => s.volume(value * 100, d));
    },
  },
  'volume.fade': {
    permission: 'audio.control',
    limit: null,
    run: (_args, ctx) => {
      if (!ctx.deps.playback.playingHere()) throw new PluginApiError('Fading only works while this computer plays.');
      if (!ctx.deps.playback.sendToHost({ type: 'fadeToggle' })) throw new PluginApiError('The player on this computer is not running.');
      return null;
    },
  },
  'eq.preset': {
    permission: 'audio.control',
    limit: null,
    run: async (args, ctx) => {
      const preset = args['preset'];
      if (typeof preset !== 'string' || preset === 'custom' || !ctx.deps.eqPresets.includes(preset)) {
        throw new PluginApiError(`"preset" must be one of: ${ctx.deps.eqPresets.filter((p) => p !== 'custom').join(', ')}.`);
      }
      return { status: await ctx.deps.setEqPreset(preset) };
    },
  },
  'storage.get': { permission: 'storage', limit: null, run: (args, ctx) => ctx.deps.storage.get(ctx.pluginId, storageKey(args['key'])) },
  'storage.set': {
    permission: 'storage',
    limit: null,
    run: (args, ctx) => {
      ctx.deps.storage.set(ctx.pluginId, storageKey(args['key']), args['value']);
      return null;
    },
  },
  'storage.delete': {
    permission: 'storage',
    limit: null,
    run: (args, ctx) => {
      ctx.deps.storage.delete(ctx.pluginId, storageKey(args['key']));
      return null;
    },
  },
  'storage.keys': { permission: 'storage', limit: null, run: (_args, ctx) => ctx.deps.storage.keys(ctx.pluginId) },
  'ui.set': {
    permission: null,
    limit: 'ui',
    run: (args, ctx) => {
      const slot = args['slot'];
      if (typeof slot !== 'string' || !(ctx.deps.uiSlots(ctx.pluginId) as string[]).includes(slot)) {
        throw new PluginApiError(`"slot" must be one of the UI slots in the plugin's manifest (${ctx.deps.uiSlots(ctx.pluginId).join(', ') || 'none'}).`);
      }
      ctx.deps.setPanel(ctx.pluginId, slot as PluginUiSlot, args['panel'] === null || args['panel'] === undefined ? null : parsePanel(args['panel']));
      return null;
    },
  },
};

/** Every action name, for the SDK definitions and the docs. */
export const PLUGIN_ACTIONS = Object.keys(ACTIONS);

/** The permission an action needs (undefined for an unknown action, null for none). */
export function actionPermission(action: string): PluginPermission | null | undefined {
  return Object.hasOwn(ACTIONS, action) ? ACTIONS[action]?.permission : undefined;
}

export class PluginApi {
  /** Times of each plugin's calls (per limit) and refused calls in the last minute. */
  private readonly calls = new Map<string, number[]>();
  private readonly refused = new Map<string, number[]>();
  private readonly now: () => number;

  constructor(private readonly deps: PluginApiDeps) {
    this.now = deps.now ?? Date.now;
  }

  /** Runs one action for a plugin; throws a PluginApiError (the plugin sees its message) when it is not allowed. */
  async call(pluginId: string, action: string, args: unknown): Promise<unknown> {
    const def = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : undefined;
    if (!def) throw new PluginApiError(`Unknown action "${action.slice(0, 40)}".`);
    const granted = this.deps.granted(pluginId);
    if (!granted) throw new PluginApiError('This plugin is not running.');
    if (def.permission && !granted.includes(def.permission)) throw new PluginApiError(`"${action}" needs the "${def.permission}" permission, which this plugin was not given.`);
    const input = object(args);
    if (def.limit) this.countCall(pluginId, def.limit);
    try {
      return await def.run(input, { pluginId, deps: this.deps });
    } catch (err) {
      if (err instanceof PluginApiError) throw err;
      if (err instanceof StorageError || err instanceof PanelError) throw new PluginApiError(err.message);
      // Spotify and other failures: a short message, never a stack or anything from the request.
      throw new PluginApiError(`"${action}" failed: ${(err as Error).message.slice(0, 200)}`);
    }
  }

  /** Forgets a plugin's counters (turned off or uninstalled). */
  forget(pluginId: string): void {
    for (const map of [this.calls, this.refused]) for (const key of [...map.keys()]) if (key.startsWith(`${pluginId}:`)) map.delete(key);
  }

  /** Counts a call toward its rate limit, refusing it when the plugin is over, and reporting a flood. */
  private countCall(pluginId: string, limit: 'spotify' | 'ui'): void {
    // Plugin ids never contain ":", so the key is unambiguous.
    const key = `${pluginId}:${limit}`;
    const max = limit === 'spotify' ? PLUGIN_RATE_PER_MINUTE : PLUGIN_UI_RATE_PER_MINUTE;
    const now = this.now();
    const recent = (this.calls.get(key) ?? []).filter((t) => now - t < MINUTE_MS);
    if (recent.length >= max) {
      const refused = [...(this.refused.get(key) ?? []).filter((t) => now - t < MINUTE_MS), now];
      this.refused.set(key, refused);
      this.calls.set(key, recent);
      if (refused.length >= PLUGIN_FLOOD_LIMIT) {
        this.forget(pluginId);
        this.deps.onFlood(pluginId);
      }
      throw new PluginApiError(limit === 'spotify' ? `Rate limit: at most ${max} Spotify calls a minute.` : `Rate limit: at most ${max} panel updates a minute.`);
    }
    recent.push(now);
    this.calls.set(key, recent);
  }
}
