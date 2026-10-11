import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PluginStorage, STORAGE_QUOTA_BYTES, StorageError } from '../src/main/plugins/storage';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playlish-storage-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('PluginStorage', () => {
  it('stores JSON values in the plugin folder and reads them back after a restart', () => {
    const s = new PluginStorage(dir);
    s.set('p', 'list', [1, 'two', { three: 3 }]);
    s.set('p', 'when', '2026-10-10');

    const again = new PluginStorage(dir);
    expect(again.get('p', 'list')).toEqual([1, 'two', { three: 3 }]);
    expect(again.keys('p')).toEqual(['list', 'when']);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'p', 'storage.json'), 'utf8'))).toEqual({ list: [1, 'two', { three: 3 }], when: '2026-10-10' });
    expect(fs.existsSync(path.join(dir, 'p', 'storage.json.tmp'))).toBe(false);
  });

  it('keeps to the quota: a write that would go over is refused and nothing changes', () => {
    const s = new PluginStorage(dir);
    s.set('p', 'a', 'x'.repeat(STORAGE_QUOTA_BYTES / 2));
    expect(() => s.set('p', 'b', 'y'.repeat(STORAGE_QUOTA_BYTES / 2))).toThrow(StorageError);
    expect(s.keys('p')).toEqual(['a']);
    expect(new PluginStorage(dir).keys('p')).toEqual(['a']);
    // Replacing a value frees its old size.
    s.set('p', 'a', 'small');
    s.set('p', 'b', 'y'.repeat(STORAGE_QUOTA_BYTES / 2));
  });

  it('treats "__proto__" and "constructor" as ordinary keys', () => {
    const s = new PluginStorage(dir);
    s.set('p', '__proto__', { polluted: true });
    s.set('p', 'constructor', 1);

    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(new PluginStorage(dir).get('p', '__proto__')).toEqual({ polluted: true });
    expect(new PluginStorage(dir).keys('p')).toEqual(['__proto__', 'constructor']);
  });

  it('refuses values that are not JSON, and starts empty after a damaged file', () => {
    const s = new PluginStorage(dir);
    const loop: Record<string, unknown> = {};
    loop['self'] = loop;
    expect(() => s.set('p', 'loop', loop)).toThrow(/JSON/);
    expect(() => s.set('p', 'big', 10n)).toThrow(/JSON/);

    fs.mkdirSync(path.join(dir, 'q'));
    fs.writeFileSync(path.join(dir, 'q', 'storage.json'), '{ damaged');
    expect(new PluginStorage(dir).keys('q')).toEqual([]);
  });
});
