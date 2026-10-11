import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PLUGIN_ACTIONS, PLUGIN_EVENTS, PLUGIN_FLOOD_LIMIT, PLUGIN_RATE_PER_MINUTE, PluginApi, actionPermission, type PluginApiDeps, type PluginSpotify } from '../src/main/plugins/api';
import { PluginStorage } from '../src/main/plugins/storage';
import { PLUGIN_PERMISSIONS, type PluginPermission } from '../src/shared/plugins';
import type { NowPlaying, PlayerCommand } from '../src/shared/types';

const ALL = Object.keys(PLUGIN_PERMISSIONS) as PluginPermission[];
const TRACK = 'spotify:track:4uLU6hMCjMI75M1A2tKUQC';

let dir: string;
let granted: Record<string, PluginPermission[] | null>;
let spotify: { [K in keyof PluginSpotify]: ReturnType<typeof vi.fn> };
let view: NowPlaying | null;
let here: boolean;
let sent: PlayerCommand[];
let floods: string[];
let queueChanges: number;
let now: number;
let eqCalls: string[];

function playing(overrides: Partial<NowPlaying> = {}): NowPlaying {
  return {
    source: 'here', deviceName: null, paused: false, positionMs: 1000, durationMs: 200_000, sampledAt: 0, track: 'Song', artists: 'Artist',
    trackUri: TRACK, artUrl: 'https://i.scdn.co/image/x', shuffle: false, repeat: 'off', volume: 0.5, muted: false, ...overrides,
  };
}

function api(overrides: Partial<PluginApiDeps> = {}) {
  return new PluginApi({
    granted: (id) => granted[id] ?? null,
    spotify: () => spotify as unknown as PluginSpotify,
    playback: {
      view: () => view,
      playingHere: () => here,
      targetDeviceId: () => (here ? 'ours' : 'kitchen'),
      sendToHost: (c) => {
        sent.push(c);
        return true;
      },
    },
    setEqPreset: (p) => {
      eqCalls.push(p);
      return Promise.resolve('applied');
    },
    eqPresets: ['flat', 'bassBoost', 'bassCut', 'vocal', 'trebleBoost', 'custom'],
    storage: new PluginStorage(dir),
    onFlood: (id) => floods.push(id),
    onQueueChanged: () => queueChanges++,
    now: () => now,
    ...overrides,
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playlish-api-'));
  granted = { full: ALL, none: [], reader: ['playback.read'] };
  const ok = () => vi.fn().mockResolvedValue(undefined);
  spotify = {
    play: ok(), pause: ok(), next: ok(), previous: ok(), volume: ok(), addToQueue: ok(), saveToLibrary: ok(), removeFromLibrary: ok(),
    savedTracks: vi.fn().mockResolvedValue({ total: 1, offset: 0, limit: 50, next: null, items: [{ added_at: '2026-10-01T00:00:00Z', track: { uri: TRACK, name: 'Liked', artists: [{ name: 'A' }, { name: 'B' }], album: { name: 'Album' }, duration_ms: 1234 } }] }),
    search: vi.fn().mockResolvedValue({ tracks: { items: [{ uri: TRACK, name: 'Found', artists: [{ name: 'A' }] }] }, playlists: { items: [null, { uri: 'spotify:playlist:p1', name: 'List' }] } }),
  };
  view = playing();
  here = true;
  sent = [];
  floods = [];
  queueChanges = 0;
  now = 1_000_000;
  eqCalls = [];
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('permissions', () => {
  it('runs an action only with its permission, checked at the time of each call', async () => {
    const a = api();
    await expect(a.call('none', 'playback.get', null)).rejects.toThrow('"playback.get" needs the "playback.read" permission');
    await expect(a.call('reader', 'playback.get', null)).resolves.toMatchObject({ track: { name: 'Song' } });
    await expect(a.call('reader', 'next', null)).rejects.toThrow(/playback.control/);

    // Turned off (or uninstalled): refused at once.
    granted['reader'] = null;
    await expect(a.call('reader', 'playback.get', null)).rejects.toThrow('This plugin is not running.');
  });

  it('refuses unknown actions, including inherited object names', async () => {
    for (const action of ['nope', 'toString', '__proto__', 'constructor']) await expect(api().call('full', action, null), action).rejects.toThrow(/Unknown action/);
    expect(actionPermission('search')).toBeNull();
    expect(actionPermission('toString')).toBeUndefined();
  });

  it('knows a permission for every action except search', () => {
    for (const action of PLUGIN_ACTIONS) if (action !== 'search') expect(ALL, action).toContain(actionPermission(action));
  });

  it('never hands out artwork URLs or device ids in playback data', async () => {
    const result = await api().call('reader', 'playback.get', null);
    expect(JSON.stringify(result)).not.toMatch(/scdn|ours|kitchen/);
    view = playing({ source: 'elsewhere', deviceName: 'Kitchen speaker' });
    expect(await api().call('reader', 'playback.get', null)).toMatchObject({ device: 'Kitchen speaker' });
  });
});

describe('playback actions', () => {
  it('controls this computer through its player, and another device through Spotify', async () => {
    const a = api();
    await a.call('full', 'next', null);
    await a.call('full', 'volume.set', { value: 0.25 });
    expect(sent).toEqual([{ type: 'next' }, { type: 'volume', value: 0.25 }]);
    expect(spotify.next).not.toHaveBeenCalled();

    here = false;
    await a.call('full', 'previous', null);
    await a.call('full', 'volume.set', { value: 0.25 });
    expect(spotify.previous).toHaveBeenCalledWith('kitchen');
    expect(spotify.volume).toHaveBeenCalledWith(25, 'kitchen');
  });

  it('pause pauses only what plays', async () => {
    await api().call('full', 'pause', null);
    expect(sent).toEqual([{ type: 'toggle' }]);
    view = playing({ paused: true });
    await api().call('full', 'pause', null);
    expect(sent).toHaveLength(1);
  });

  it('play checks its URIs and plays on the device that plays', async () => {
    const a = api();
    await a.call('full', 'play', { uris: [TRACK] });
    await a.call('full', 'play', { contextUri: 'spotify:album:1DFixLWuPkv3KT3TnV35m3', offset: 2 });
    await a.call('full', 'play', null);
    expect(spotify.play.mock.calls).toEqual([
      [{ uris: [TRACK], deviceId: 'ours' }],
      [{ contextUri: 'spotify:album:1DFixLWuPkv3KT3TnV35m3', offset: { position: 2 }, deviceId: 'ours' }],
      [{ deviceId: 'ours' }],
    ]);

    for (const args of [
      { uris: ['https://open.spotify.com/track/x'] },
      { uris: [] },
      { uris: Array(51).fill(TRACK) },
      { uris: ['spotify:album:1DFixLWuPkv3KT3TnV35m3'] },
      { contextUri: TRACK },
      { uris: [TRACK], contextUri: 'spotify:album:1' },
      { offset: -1 },
      'not an object',
      [TRACK],
    ]) {
      await expect(a.call('full', 'play', args), JSON.stringify(args)).rejects.toThrow();
    }
  });

  it('queue.add adds a track and tells listeners', async () => {
    await api().call('full', 'queue.add', { uri: TRACK });
    expect(spotify.addToQueue).toHaveBeenCalledWith(TRACK, 'ours');
    expect(queueChanges).toBe(1);
    await expect(api().call('full', 'queue.add', { uri: 'spotify:artist:x' })).rejects.toThrow(/track or episode/);
  });

  it('volume.fade works on this computer only, and volume.set checks the range', async () => {
    await api().call('full', 'volume.fade', null);
    expect(sent).toEqual([{ type: 'fadeToggle' }]);
    here = false;
    await expect(api().call('full', 'volume.fade', null)).rejects.toThrow(/this computer/);
    for (const value of [-0.1, 1.1, '0.5', Number.NaN]) await expect(api().call('full', 'volume.set', { value })).rejects.toThrow(/from 0 to 1/);
  });

  it('a Spotify failure reaches the plugin as a short message, nothing more', async () => {
    spotify.next.mockRejectedValue(Object.assign(new Error('Player command failed: Restriction violated'), { stack: 'secret stack', token: 'abc' }));
    here = false;
    await expect(api().call('full', 'next', null)).rejects.toThrow('"next" failed: Player command failed: Restriction violated');
    await expect(api({ spotify: () => null }).call('full', 'next', null)).rejects.toThrow('Not logged in to Spotify.');
  });
});

describe('library, search and the equalizer', () => {
  it('saves and removes, and pages through liked songs at background priority', async () => {
    await api().call('full', 'library.save', { uris: [TRACK] });
    await api().call('full', 'library.save', { uris: [TRACK], remove: true });
    expect(spotify.saveToLibrary).toHaveBeenCalledWith([TRACK]);
    expect(spotify.removeFromLibrary).toHaveBeenCalledWith([TRACK]);
    await expect(api().call('full', 'library.save', { uris: [TRACK], remove: 'yes' })).rejects.toThrow(/true or false/);

    const liked = await api().call('full', 'library.liked', { offset: 50, limit: 10 });
    expect(spotify.savedTracks).toHaveBeenCalledWith(50, 10, 'background');
    expect(liked).toEqual({ total: 1, offset: 0, items: [{ uri: TRACK, name: 'Liked', artists: ['A', 'B'], album: 'Album', durationMs: 1234, addedAt: '2026-10-01T00:00:00Z' }] });
    await expect(api().call('full', 'library.liked', { limit: 51 })).rejects.toThrow(/from 1 to 50/);
  });

  it('search needs no permission, runs at background priority, and drops empty results', async () => {
    expect(await api().call('none', 'search', { query: 'rick' })).toEqual([{ uri: TRACK, name: 'Found', artists: ['A'] }]);
    expect(spotify.search).toHaveBeenCalledWith('rick', ['track'], 0, 10, 'background');
    expect(await api().call('none', 'search', { query: 'list', type: 'playlist', limit: 5 })).toEqual([{ uri: 'spotify:playlist:p1', name: 'List' }]);
    await expect(api().call('none', 'search', { query: '' })).rejects.toThrow(/1 to 100/);
    await expect(api().call('none', 'search', { query: 'x', type: 'show' })).rejects.toThrow(/"type"/);
  });

  it('eq.preset takes a named preset, never "custom"', async () => {
    expect(await api().call('full', 'eq.preset', { preset: 'bassBoost' })).toEqual({ status: 'applied' });
    expect(eqCalls).toEqual(['bassBoost']);
    await expect(api().call('full', 'eq.preset', { preset: 'custom' })).rejects.toThrow(/must be one of/);
    await expect(api().call('full', 'eq.preset', { preset: 'loud' })).rejects.toThrow(/must be one of/);
  });
});

describe('storage', () => {
  it('keeps JSON values per plugin, survives a restart, and refuses bad keys', async () => {
    granted['other'] = ['storage'];
    const a = api();
    await a.call('full', 'storage.set', { key: 'counts', value: { a: 1 } });
    await a.call('other', 'storage.set', { key: 'counts', value: 'theirs' });

    expect(await api().call('full', 'storage.get', { key: 'counts' })).toEqual({ a: 1 });
    expect(await api().call('full', 'storage.keys', null)).toEqual(['counts']);
    expect(await api().call('full', 'storage.get', { key: 'missing' })).toBeNull();
    await api().call('full', 'storage.delete', { key: 'counts' });
    expect(await api().call('full', 'storage.keys', null)).toEqual([]);
    expect(await api().call('other', 'storage.get', { key: 'counts' })).toBe('theirs');

    for (const key of ['', 'a b', 'x'.repeat(101), '../x', 42]) await expect(a.call('full', 'storage.get', { key }), String(key)).rejects.toThrow();
    await expect(a.call('full', 'storage.set', { key: 'k' })).rejects.toThrow(/storage.delete/);
    await expect(a.call('reader', 'storage.get', { key: 'k' })).rejects.toThrow(/"storage" permission/);
  });
});

describe('rate limit', () => {
  it('allows 60 Spotify calls a minute, then refuses until the minute has passed', async () => {
    const a = api();
    here = false;
    for (let i = 0; i < PLUGIN_RATE_PER_MINUTE; i++) await a.call('full', 'next', null);
    await expect(a.call('full', 'next', null)).rejects.toThrow(/Rate limit/);
    // Actions that never reach Spotify are not limited.
    await expect(a.call('full', 'playback.get', null)).resolves.not.toBeUndefined();
    await expect(a.call('full', 'storage.keys', null)).resolves.toEqual([]);
    // Another plugin has its own budget.
    granted['second'] = ALL;
    await expect(a.call('second', 'next', null)).resolves.toBeNull();

    now += 60_001;
    await expect(a.call('full', 'next', null)).resolves.toBeNull();
  });

  it('turns off a plugin that keeps flooding', async () => {
    const a = api();
    for (let i = 0; i < PLUGIN_RATE_PER_MINUTE + PLUGIN_FLOOD_LIMIT - 1; i++) await a.call('full', 'search', { query: 'x' }).catch(() => undefined);
    expect(floods).toEqual([]);
    await a.call('full', 'search', { query: 'x' }).catch(() => undefined);
    expect(floods).toEqual(['full']);
  });
});

describe('the SDK definitions (sdk/playlish.d.ts)', () => {
  // Line endings depend on the checkout (CRLF on Windows CI).
  const sdk = fs.readFileSync(path.join(__dirname, '..', 'sdk', 'playlish.d.ts'), 'utf8').replace(/\r\n/g, '\n');
  const block = (name: string) => sdk.slice(sdk.indexOf(`interface ${name} {`), sdk.indexOf('\n  }\n', sdk.indexOf(`interface ${name} {`)));

  it('describe exactly the actions and events the API has', () => {
    const actions = [...block('Actions').matchAll(/^\s{4}'?([a-z.]+)'?: \{/gm)].map((m) => m[1]);
    const events = [...block('Events').matchAll(/^\s{4}'([a-z.]+)':/gm)].map((m) => m[1]);
    expect([...actions].sort()).toEqual([...PLUGIN_ACTIONS].sort());
    expect([...events].sort()).toEqual([...PLUGIN_EVENTS].sort());
  });

  it('name the right permission for each action', () => {
    for (const action of PLUGIN_ACTIONS) {
      const line = sdk.split('\n').findIndex((l) => new RegExp(`^\\s{4}'?${action.replace('.', '\\.')}'?: \\{`).test(l));
      const comment = sdk.split('\n')[line - 1] ?? '';
      const permission = actionPermission(action);
      if (permission) expect(comment, action).toContain(`"${permission}"`);
      else expect(comment, action).toContain('No permission');
    }
  });
});
