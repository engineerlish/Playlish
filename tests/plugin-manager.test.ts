import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROMPT_TTL_MS, PluginManager, disabledReason, type HostLike } from '../src/main/plugins/manager';
import { DEFAULT_LIMITS } from '../src/main/plugins/limits';
import { PluginStore } from '../src/main/plugins/store';
import { ZIP_LIMITS } from '../src/main/plugins/zip';
import { makePackage } from './helpers/zip';

let dir: string;
let files: Map<string, Buffer>;
let host: { load: ReturnType<typeof vi.fn<HostLike['load']>>; unload: ReturnType<typeof vi.fn<HostLike['unload']>> };
let changes: number;
let logs: { level: string; message: string; context: Record<string, unknown> }[];
let now: number;
let tokens: number;

function manager(safeMode = false, store = new PluginStore(dir)) {
  return {
    store,
    m: new PluginManager({
      store,
      host,
      safeMode,
      readFile: (f) => {
        const b = files.get(f);
        if (!b) throw new Error('ENOENT: no such file');
        return b;
      },
      fileSize: (f) => files.get(f)?.length ?? 0,
      onChange: () => changes++,
      log: (level, message, context) => logs.push({ level, message, context }),
      newToken: () => `token-${++tokens}`,
      now: () => now,
    }),
  };
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playlish-manager-'));
  files = new Map([
    ['hello.playlish', makePackage({}, 'v1();')],
    ['hello-1.1.playlish', makePackage({ version: '1.1.0', permissions: ['playback.read', 'storage'] }, 'v2();')],
    ['hello-1.2.playlish', makePackage({ version: '1.2.0', permissions: [] }, 'v3();')],
    ['broken.playlish', Buffer.from('not a zip')],
  ]);
  host = { load: vi.fn<HostLike['load']>().mockResolvedValue(undefined), unload: vi.fn<HostLike['unload']>() };
  changes = 0;
  logs = [];
  now = 1_000_000;
  tokens = 0;
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('PluginManager: install', () => {
  it('opens a package into a prompt; approving installs it, turns it on and loads it', async () => {
    const { m, store } = manager();

    m.openPackage('hello.playlish');
    const prompt = m.pendingPrompt();
    expect(prompt).toMatchObject({ token: 'token-1', id: 'com.example.hello', version: '1.0.0', permissions: ['playback.read'], newPermissions: ['playback.read'], replaces: null });
    expect(prompt?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(store.list()).toEqual([]);

    await m.approve('token-1');

    expect(m.pendingPrompt()).toBeNull();
    expect(m.views()).toEqual([expect.objectContaining({ id: 'com.example.hello', enabled: true, permissions: ['playback.read'] })]);
    expect(host.load).toHaveBeenCalledWith('com.example.hello', 'v1();', DEFAULT_LIMITS);
    expect(logs.map((l) => l.message)).toContain('Plugin installed');
  });

  it('installs exactly the package that was shown, even if the file changed since', async () => {
    const { m, store } = manager();
    m.openPackage('hello.playlish');
    files.set('hello.playlish', makePackage({ permissions: ['playback.read', 'library.modify'] }, 'evil();'));

    await m.approve('token-1');

    expect(store.code('com.example.hello')).toBe('v1();');
    expect(store.get('com.example.hello')?.granted).toEqual(['playback.read']);
  });

  it('ignores a wrong or stale token, and cancel drops the prompt', async () => {
    const { m, store } = manager();
    m.openPackage('hello.playlish');
    await m.approve('token-999');
    expect(store.list()).toEqual([]);

    now += PROMPT_TTL_MS + 1;
    await m.approve('token-1');
    expect(store.list()).toEqual([]);
    expect(m.pendingPrompt()).toBeNull();

    m.openPackage('hello.playlish');
    m.cancel('token-2');
    expect(m.pendingPrompt()).toBeNull();
    await m.approve('token-2');
    expect(store.list()).toEqual([]);
  });

  it('explains a package it refuses, until dismissed', () => {
    const { m } = manager();

    m.openPackage('broken.playlish');
    expect(m.pendingPrompt()).toBeNull();
    expect(m.lastError()).toMatch(/not a valid plugin package/);

    m.dismissError();
    expect(m.lastError()).toBeNull();

    files.set('huge.playlish', Buffer.alloc(ZIP_LIMITS.maxArchiveBytes + 1));
    m.openPackage('huge.playlish');
    expect(m.lastError()).toMatch(/larger than a plugin package can be/);
    m.openPackage('missing.playlish');
    expect(m.lastError()).toMatch(/could not be read/);
  });
});

describe('PluginManager: updates', () => {
  it('an update that asks for more shows only the new permissions, and reloads the new code', async () => {
    const { m, store } = manager();
    m.openPackage('hello.playlish');
    await m.approve('token-1');

    m.openPackage('hello-1.1.playlish');
    expect(m.pendingPrompt()).toMatchObject({ replaces: '1.0.0', version: '1.1.0', permissions: ['playback.read', 'storage'], newPermissions: ['storage'] });
    // Nothing changes before it is approved.
    expect(store.get('com.example.hello')?.granted).toEqual(['playback.read']);

    await m.approve('token-2');

    expect(store.get('com.example.hello')).toMatchObject({ granted: ['playback.read', 'storage'], enabled: true });
    expect(host.load).toHaveBeenLastCalledWith('com.example.hello', 'v2();', DEFAULT_LIMITS);
    expect(logs.find((l) => l.message === 'Plugin updated')?.context).toMatchObject({ from: '1.0.0', version: '1.1.0' });
  });

  it('an update that asks for less needs nothing new, and the grant shrinks', async () => {
    const { m, store } = manager();
    m.openPackage('hello-1.1.playlish');
    await m.approve('token-1');

    m.openPackage('hello-1.2.playlish');
    expect(m.pendingPrompt()?.newPermissions).toEqual([]);
    await m.approve('token-2');

    expect(store.get('com.example.hello')?.granted).toEqual([]);
  });

  it('an update of a plugin that is off stays off and is not loaded', async () => {
    const { m } = manager();
    m.openPackage('hello.playlish');
    await m.approve('token-1');
    await m.setEnabled('com.example.hello', false);
    host.load.mockClear();

    m.openPackage('hello-1.1.playlish');
    await m.approve('token-2');

    expect(m.views()[0]?.enabled).toBe(false);
    expect(host.load).not.toHaveBeenCalled();
  });
});

describe('PluginManager: lifecycle', () => {
  it('turning off unloads, turning on loads again', async () => {
    const { m } = manager();
    m.openPackage('hello.playlish');
    await m.approve('token-1');

    await m.setEnabled('com.example.hello', false);
    expect(host.unload).toHaveBeenCalledWith('com.example.hello');
    expect(m.views()[0]?.enabled).toBe(false);

    await m.setEnabled('com.example.hello', true);
    expect(host.load).toHaveBeenCalledTimes(2);
  });

  it('uninstall unloads and removes it', async () => {
    const { m, store } = manager();
    m.openPackage('hello.playlish');
    await m.approve('token-1');

    m.uninstall('com.example.hello');

    expect(host.unload).toHaveBeenCalledWith('com.example.hello');
    expect(store.list()).toEqual([]);
  });

  it('start loads the plugins that are on, and none in safe mode', async () => {
    const first = manager();
    first.m.openPackage('hello.playlish');
    await first.m.approve('token-1');
    host.load.mockClear();

    await manager(false).m.start();
    expect(host.load).toHaveBeenCalledTimes(1);

    host.load.mockClear();
    const safe = manager(true);
    await safe.m.start();
    expect(host.load).not.toHaveBeenCalled();
    // Safe mode still lets you manage plugins; it just never runs one.
    await safe.m.setEnabled('com.example.hello', false);
    await safe.m.setEnabled('com.example.hello', true);
    safe.m.openPackage('hello-1.1.playlish');
    await safe.m.approve(safe.m.pendingPrompt()?.token ?? '');
    expect(host.load).not.toHaveBeenCalled();
    expect(safe.store.get('com.example.hello')?.manifest.version).toBe('1.1.0');
  });

  it('a plugin that fails to start is turned off with the reason', async () => {
    host.load.mockRejectedValue(new Error('SyntaxError: unexpected token'));
    const { m } = manager();
    m.openPackage('hello.playlish');

    await m.approve('token-1');

    expect(m.views()[0]).toMatchObject({ enabled: false, disabledReason: 'Turned off because it failed to start: SyntaxError: unexpected token' });
  });

  it('a plugin the host turned off is remembered as off, with the reason', async () => {
    const { m, store } = manager();
    m.openPackage('hello.playlish');
    await m.approve('token-1');

    m.onHostDisabled('com.example.hello', ['cpu', 'cpu', 'memory']);

    expect(store.get('com.example.hello')).toMatchObject({ enabled: false, disabledReason: 'Turned off because it kept going over its limits (time per event, memory).' });
    m.onHostDisabled('com.example.unknown', ['crash']);
  });
});

describe('disabledReason', () => {
  it('names crashes and the limits that were broken', () => {
    expect(disabledReason(['crash'])).toMatch(/crashed twice/);
    expect(disabledReason(['cpu-minute', 'error'])).toBe('Turned off because it kept going over its limits (time per minute, errors).');
  });
});
