/*
 * Playlish plugin API v1: type definitions for plugin authors (#102).
 *
 * A plugin is one script that runs in a sandbox (QuickJS): standard JavaScript plus the global `playlish` object below.
 * There is no `fetch`, `require`, `process`, DOM or timers. Values cross into Playlish as JSON.
 *
 * Use it from a JavaScript plugin with a reference comment at the top of the script:
 *
 *   /// <reference path="playlish.d.ts" />
 *
 * Every action needs the permission named next to it, listed in the plugin's manifest.json and approved by the user
 * at install. Actions that reach Spotify (marked "Spotify") count toward a limit of 60 a minute; a plugin that keeps
 * going far over it is turned off. A refused or failed action rejects its promise with an Error saying why.
 */

declare namespace Playlish {
  type Permission = 'playback.read' | 'playback.control' | 'library.read' | 'library.modify' | 'audio.control' | 'storage';

  /** What plays now. */
  interface Playback {
    track: { uri: string | null; name: string; artists: string };
    paused: boolean;
    positionMs: number;
    durationMs: number;
    /** "this computer", or the name of the Spotify device that plays. */
    device: string;
    shuffle: boolean;
    repeat: 'off' | 'context' | 'track';
    /** 0 to 1, or null when the device has no volume control. */
    volume: number | null;
  }

  interface Track {
    uri: string;
    name: string;
    artists: string[];
    album: string;
    durationMs: number;
  }

  /** Events, all of them need "playback.read". `queue.changed` carries no data. */
  interface Events {
    'track.changed': Playback | null;
    'playback.state': Playback | null;
    'device.changed': Playback | null;
    'queue.changed': null;
  }

  /** Every action, with its arguments and its result. */
  interface Actions {
    /** "playback.read": what plays now, or null. */
    'playback.get': { args?: null; result: Playback | null };
    /** "playback.control", Spotify: play tracks, a context (album, playlist, artist), or resume with no arguments. */
    play: { args?: { uris?: string[]; contextUri?: string; offset?: number } | null; result: null };
    /** "playback.control", Spotify. */
    pause: { args?: null; result: null };
    /** "playback.control", Spotify. */
    next: { args?: null; result: null };
    /** "playback.control", Spotify. */
    previous: { args?: null; result: null };
    /** "playback.control", Spotify: add a track or episode to the queue. */
    'queue.add': { args: { uri: string }; result: null };
    /** "library.modify", Spotify: save (or with remove: true, remove) up to 50 tracks, albums, episodes or shows. */
    'library.save': { args: { uris: string[]; remove?: boolean }; result: null };
    /** "library.read", Spotify: a page of liked songs, newest first (limit 1 to 50). */
    'library.liked': { args?: { offset?: number; limit?: number } | null; result: { total: number; offset: number; items: (Track & { addedAt: string })[] } };
    /** No permission, Spotify: search the catalog (limit 1 to 20, default 10). */
    search: { args: { query: string; type?: 'track' | 'album' | 'artist' | 'playlist'; limit?: number }; result: { uri: string; name: string; artists?: string[] }[] };
    /** "audio.control", Spotify when another device plays: 0 to 1. */
    'volume.set': { args: { value: number }; result: null };
    /** "audio.control": fade out and pause, or resume and fade in, on this computer. */
    'volume.fade': { args?: null; result: null };
    /** "audio.control": the equalizer preset. The user's on/off choice is kept: "off" means it was saved but the EQ is off. */
    'eq.preset': {
      args: { preset: 'flat' | 'bassBoost' | 'bassCut' | 'vocal' | 'trebleBoost' };
      result: { status: 'applied' | 'off' | 'not-installed' | 'needs-setup' };
    };
    /** "storage": a value saved earlier, or null. Keys are 1 to 100 of A-Z a-z 0-9 . _ : - */
    'storage.get': { args: { key: string }; result: unknown };
    /** "storage": save a JSON value; the whole store of a plugin is at most 1 MB. */
    'storage.set': { args: { key: string; value: unknown }; result: null };
    /** "storage". */
    'storage.delete': { args: { key: string }; result: null };
    /** "storage": every key, sorted. */
    'storage.keys': { args?: null; result: string[] };
  }

  type ActionName = keyof Actions;
  type ArgsOf<A extends ActionName> = Actions[A]['args'];
}

declare const playlish: {
  /** Listen to an event. Handlers may be async; errors in them are written to the plugin's log. */
  on<E extends keyof Playlish.Events>(event: E, handler: (payload: Playlish.Events[E]) => void | Promise<void>): void;
  /** Ask Playlish to do something. */
  call<A extends Playlish.ActionName>(
    action: A,
    ...args: undefined extends Playlish.ArgsOf<A> ? [args?: Playlish.ArgsOf<A>] : [args: Playlish.ArgsOf<A>]
  ): Promise<Playlish.Actions[A]['result']>;
  /** Write to the plugin's log (Playlish's plugins.log, tagged with the plugin's id and version). */
  log(...values: unknown[]): void;
  warn(...values: unknown[]): void;
  error(...values: unknown[]): void;
};
