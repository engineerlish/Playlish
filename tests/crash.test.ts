import { EventEmitter } from 'node:events';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CrashRecorder, installProcessHandlers, type AppInfo } from '../src/main/logging/crash';
import { Logger, type LogEntry } from '../src/main/logging/logger';
import { PluginErrorLog } from '../src/main/logging/plugin-log';

const APP: AppInfo = { appVersion: '0.0.1', electron: '44.1.0', chrome: '140', platform: 'win32', arch: 'x64', osRelease: '10.0.26200' };
const CLIENT_ID = '0123456789abcdef0123456789abcdef';

let dir: string;
let entries: LogEntry[];
let logger: Logger;
let clock: Date;

/** A recorder on a temp folder with a controllable clock. */
function recorder(keep = 10): CrashRecorder {
  return new CrashRecorder(dir, APP, logger, () => clock, keep);
}

beforeEach(() => {
  dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'playlish-crash-')), 'crashes');
  entries = [];
  logger = Logger.create([{ write: (_l, e) => entries.push(e) }]);
  clock = new Date('2026-10-03T12:00:00.000Z');
});

afterEach(() => {
  fs.rmSync(path.dirname(dir), { recursive: true, force: true });
});

describe('CrashRecorder', () => {
  it('writes a readable report with the error, process, kind and app info', () => {
    const crashes = recorder();

    const file = crashes.record('uncaughtException', 'main', { error: new Error('boom') });

    expect(path.basename(file ?? '')).toBe('crash-2026-10-03T12-00-00-000Z-main.json');
    const report = crashes.read(file ?? '');
    expect(report).toMatchObject({
      ts: '2026-10-03T12:00:00.000Z',
      kind: 'uncaughtException',
      process: 'main',
      error: { name: 'Error', message: 'boom' },
      app: APP,
    });
  });

  it('redacts secrets in the report', () => {
    const crashes = recorder();

    const file = crashes.record('renderer-gone', 'host', {
      error: new Error(`refresh failed for ${CLIENT_ID} with Bearer abc.def`),
      details: { reason: 'crashed', accessToken: 'secret-value' },
    });

    const text = fs.readFileSync(file ?? '', 'utf8');
    expect(text).not.toMatch(new RegExp(`${CLIENT_ID}|abc\\.def|secret-value`));
    expect(text).toContain('[CLIENT_ID]');
  });

  it('also logs the crash with the CRASH code', () => {
    recorder().record('child-process-gone', 'gpu', { details: { reason: 'oom', exitCode: -1 } });

    expect(entries[0]).toMatchObject({ level: 'error', code: 'CRASH', msg: 'Crash: child-process-gone in gpu' });
  });

  it('lists reports newest first and keeps only the newest N', () => {
    const crashes = recorder(3);

    for (let i = 0; i < 5; i++) {
      clock = new Date(Date.UTC(2026, 9, 3, 12, 0, i));
      crashes.record('unhandledRejection', 'main', { error: `reason ${i}` });
    }

    const names = crashes.list().map((f) => path.basename(f));
    expect(names).toEqual([
      'crash-2026-10-03T12-00-04-000Z-main.json',
      'crash-2026-10-03T12-00-03-000Z-main.json',
      'crash-2026-10-03T12-00-02-000Z-main.json',
    ]);
  });

  it('makes the process name safe for a file name', () => {
    const file = recorder().record('renderer-gone', 'ui/../x y', {});

    expect(path.basename(file ?? '')).toBe('crash-2026-10-03T12-00-00-000Z-ui____x_y.json');
    expect(path.dirname(file ?? '')).toBe(dir);
  });

  it('returns null and logs instead of throwing when the folder cannot be written', () => {
    fs.mkdirSync(path.dirname(dir), { recursive: true });
    fs.writeFileSync(dir, 'a file where the folder should be');

    const file = recorder().record('uncaughtException', 'main', { error: new Error('x') });

    expect(file).toBeNull();
    expect(entries.some((e) => e.code === 'CRASH_REPORT_FAILED')).toBe(true);
  });

  it('lists nothing and reads null when there are no reports', () => {
    const crashes = recorder();

    expect(crashes.list()).toEqual([]);
    expect(crashes.read(path.join(dir, 'missing.json'))).toBeNull();
  });
});

describe('installProcessHandlers', () => {
  it('records an uncaught exception and then calls onFatal', () => {
    const proc = new EventEmitter();
    const crashes = recorder();
    const fatal: Error[] = [];
    installProcessHandlers(proc, crashes, (e) => fatal.push(e));
    const error = new Error('unexpected');

    proc.emit('uncaughtException', error);

    expect(crashes.list()).toHaveLength(1);
    expect(crashes.read(crashes.list()[0] ?? '')?.kind).toBe('uncaughtException');
    expect(fatal).toEqual([error]);
  });

  it('records an unhandled rejection without treating it as fatal', () => {
    const proc = new EventEmitter();
    const crashes = recorder();
    const fatal: Error[] = [];
    installProcessHandlers(proc, crashes, (e) => fatal.push(e));

    proc.emit('unhandledRejection', new Error('forgotten promise'));

    expect(crashes.read(crashes.list()[0] ?? '')).toMatchObject({ kind: 'unhandledRejection', error: { message: 'forgotten promise' } });
    expect(fatal).toEqual([]);
  });
});

describe('PluginErrorLog', () => {
  it('tags every entry with the plugin id and version and uses a plugin module name', () => {
    const plugins = new PluginErrorLog(logger);

    plugins.forPlugin('stats', '1.2.0').error('render failed', { code: 'PLUGIN_RENDER', context: { slot: 'sidebar' } });

    expect(entries[0]).toMatchObject({
      module: 'plugin:stats@1.2.0',
      code: 'PLUGIN_RENDER',
      context: { slot: 'sidebar', pluginId: 'stats', pluginVersion: '1.2.0' },
    });
  });

  it('counts errors per plugin, not warnings or info', () => {
    const plugins = new PluginErrorLog(logger);
    const stats = plugins.forPlugin('stats', '1.0.0');
    const shuffle = plugins.forPlugin('shuffle', '0.1.0');

    stats.error('a');
    stats.error('b');
    stats.warn('c');
    shuffle.info('d');

    expect(plugins.errorCount('stats')).toBe(2);
    expect(plugins.errorCount('shuffle')).toBe(0);
    expect(plugins.errorCount('unknown')).toBe(0);
  });

  it('does not let a plugin overwrite its own tags', () => {
    const plugins = new PluginErrorLog(logger);

    plugins.forPlugin('stats', '1.0.0').warn('spoof', { context: { pluginId: 'other', pluginVersion: '9.9.9' } });

    expect(entries[0]?.context).toMatchObject({ pluginId: 'stats', pluginVersion: '1.0.0' });
  });
});
