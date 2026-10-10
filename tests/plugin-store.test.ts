import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PackageError, PluginStore, inspectPackage } from '../src/main/plugins/store';
import { makePackage, makeZip, manifest } from './helpers/zip';

let dir: string;
let reports: string[];
const store = () => new PluginStore(dir, (m) => reports.push(m), () => new Date('2026-10-10T12:00:00Z'));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playlish-plugins-'));
  reports = [];
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('inspectPackage', () => {
  it('returns the manifest, the files and the SHA-256 of the package', () => {
    const buf = makePackage({}, 'code();', [{ name: 'ui/panel.json', data: '{}' }]);
    const pkg = inspectPackage(buf);

    expect(pkg.manifest.id).toBe('com.example.hello');
    expect([...pkg.files.keys()].sort()).toEqual(['main.js', 'manifest.json', 'ui/panel.json']);
    expect(pkg.sha256).toBe(createHash('sha256').update(buf).digest('hex'));
  });

  it('explains what is wrong with a package', () => {
    expect(() => inspectPackage(Buffer.from('MZ not a zip'))).toThrow(/not a valid plugin package: Not a zip/);
    expect(() => inspectPackage(makeZip([{ name: 'main.js', data: 'x' }]))).toThrow(/manifest.json is missing/);
    expect(() => inspectPackage(makeZip([{ name: 'manifest.json', data: JSON.stringify(manifest()) }]))).toThrow(/"main.js" is missing/);
    expect(() => inspectPackage(makePackage({ permissions: ['everything'] }))).toThrow(PackageError);
    expect(() => inspectPackage(makePackage({ permissions: ['everything'] }))).toThrow(/manifest is not valid: Unknown permission/);
  });
});

describe('PluginStore', () => {
  it('installs a package: files unpacked, recorded with its hash and permissions, on', () => {
    const s = store();
    const pkg = inspectPackage(makePackage({}, 'hello();', [{ name: 'ui/panel.json', data: '{"a":1}' }]));

    const record = s.install(pkg);

    expect(record).toMatchObject({ sha256: pkg.sha256, enabled: true, granted: ['playback.read'], disabledReason: null, installedAt: '2026-10-10T12:00:00.000Z' });
    expect(s.code('com.example.hello')).toBe('hello();');
    expect(fs.readFileSync(path.join(dir, 'plugins', 'com.example.hello', 'ui', 'panel.json'), 'utf8')).toBe('{"a":1}');
    // Survives a restart.
    expect(store().get('com.example.hello')).toMatchObject({ sha256: pkg.sha256, enabled: true });
  });

  it('updates in place: new files and permissions, the old files gone, the on/off state kept', () => {
    const s = store();
    s.install(inspectPackage(makePackage({}, 'v1();', [{ name: 'old.txt', data: 'old' }])));
    s.setEnabled('com.example.hello', false, 'Turned off for a test.');

    const updated = s.install(inspectPackage(makePackage({ version: '1.1.0', permissions: ['playback.read', 'storage'] }, 'v2();')));

    expect(updated).toMatchObject({ enabled: false, disabledReason: 'Turned off for a test.', granted: ['playback.read', 'storage'], installedAt: '2026-10-10T12:00:00.000Z' });
    expect(updated.manifest.version).toBe('1.1.0');
    expect(s.code('com.example.hello')).toBe('v2();');
    expect(fs.existsSync(path.join(dir, 'plugins', 'com.example.hello', 'old.txt'))).toBe(false);
    expect(fs.readdirSync(path.join(dir, 'plugins')).sort()).toEqual(['com.example.hello', 'installed.json']);
  });

  it('turns plugins on and off, clearing the reason when turned on', () => {
    const s = store();
    s.install(inspectPackage(makePackage()));

    s.setEnabled('com.example.hello', false, 'Over its limits.');
    expect(store().get('com.example.hello')).toMatchObject({ enabled: false, disabledReason: 'Over its limits.' });
    s.setEnabled('com.example.hello', true);
    expect(store().get('com.example.hello')).toMatchObject({ enabled: true, disabledReason: null });
    expect(() => s.setEnabled('com.example.other', true)).toThrow(/not installed/);
  });

  it('uninstalls a plugin with its files and its storage, and leaves the others alone', () => {
    const s = store();
    s.install(inspectPackage(makePackage()));
    s.install(inspectPackage(makePackage({ id: 'com.example.other' })));
    fs.mkdirSync(path.join(dir, 'plugin-data', 'com.example.hello'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'plugin-data', 'com.example.hello', 'store.json'), '{}');

    s.uninstall('com.example.hello');

    expect(s.list().map((p) => p.manifest.id)).toEqual(['com.example.other']);
    expect(fs.existsSync(path.join(dir, 'plugins', 'com.example.hello'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'plugin-data', 'com.example.hello'))).toBe(false);
    expect(store().list().map((p) => p.manifest.id)).toEqual(['com.example.other']);
  });

  it('removes leftovers of an interrupted install at start', () => {
    fs.mkdirSync(path.join(dir, 'plugins', '.tmp-com.example.hello-1234', 'x'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'plugins', '.old-com.example.hello-5678'), { recursive: true });

    store();

    expect(fs.readdirSync(path.join(dir, 'plugins'))).toEqual([]);
  });

  it('keeps a damaged list aside and starts with no plugins', () => {
    fs.mkdirSync(path.join(dir, 'plugins'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'plugins', 'installed.json'), '{ not json');

    expect(store().list()).toEqual([]);
    expect(reports[0]).toMatch(/damaged and was kept aside/);
    expect(fs.readdirSync(path.join(dir, 'plugins')).some((f) => f.startsWith('installed.json.corrupt-'))).toBe(true);
  });

  it('distrusts an edited list: bad entries are skipped and grants never exceed the manifest', () => {
    const s = store();
    s.install(inspectPackage(makePackage()));
    const file = path.join(dir, 'plugins', 'installed.json');
    const index = JSON.parse(fs.readFileSync(file, 'utf8')) as { plugins: Record<string, unknown>[] };
    const good = index.plugins[0] ?? {};
    index.plugins = [
      { ...good, granted: ['playback.read', 'library.modify', 'storage'] },
      { ...good, manifest: { ...(good['manifest'] as object), id: '../../escape' } },
      { ...good, sha256: 'nope' },
      { ...good, manifest: { ...(good['manifest'] as object), id: 'com.example.gone' } },
    ];
    fs.writeFileSync(file, JSON.stringify(index));

    const reloaded = store();

    expect(reloaded.list().map((p) => p.manifest.id)).toEqual(['com.example.hello']);
    expect(reloaded.get('com.example.hello')?.granted).toEqual(['playback.read']);
    expect(reports).toHaveLength(3);
  });
});
