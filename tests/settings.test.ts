import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  SAVE_DEBOUNCE_MS,
  SettingsStore,
  defaultSettings,
  migrate,
  validateSettings,
} from '../src/main/settings';

const ID = '0123456789abcdef0123456789abcdef';

describe('validateSettings', () => {
  it('fills every default for an empty object and reports nothing', () => {
    expect(validateSettings({})).toEqual({ settings: defaultSettings(), problems: [] });
  });

  it('accepts a complete valid file unchanged', () => {
    const valid = {
      version: 1,
      clientId: ID,
      closeToTray: false,
      minimizeToTray: true,
      startMinimized: true,
      checkForUpdates: false,
      lastUpdateCheck: 1_790_000_000_000,
      outputDevice: 'Headphones (USB Audio)',
      window: { width: 1280, height: 800, x: -1200, y: 40, maximized: true },
      lastPage: 'search',
      deviceVolumes: { 'speakers-1': 0.4, headphones: 1 },
    };

    expect(validateSettings(valid)).toEqual({ settings: valid, problems: [] });
  });

  it('reads a file from before "minimize to tray" existed without complaint, with it off', () => {
    const older = { version: 1, clientId: ID, closeToTray: true, startMinimized: false };

    const { settings, problems } = validateSettings(older);

    expect(problems).toEqual([]);
    expect(settings.minimizeToTray).toBe(false);
  });

  it.each([
    ['clientId', 'not-hex'],
    ['clientId', 123],
    ['closeToTray', 'yes'],
    ['minimizeToTray', 'no'],
    ['checkForUpdates', 'yes'],
    ['lastUpdateCheck', -5],
    ['lastUpdateCheck', 'yesterday'],
    ['outputDevice', ''],
    ['outputDevice', 42],
    ['outputDevice', 'x'.repeat(201)],
    ['startMinimized', 1],
    ['window', { width: 100, height: 800, x: null, y: null, maximized: false }],
    ['window', { width: 1280, height: 800, x: 1.5, y: null, maximized: false }],
    ['window', { width: 1280, height: 800 }],
    ['window', 'big'],
    ['lastPage', 'secret-page'],
    ['deviceVolumes', [0.5]],
  ])('falls back to the default for an invalid %s', (key, value) => {
    const { settings, problems } = validateSettings({ [key]: value });

    expect((settings as unknown as Record<string, unknown>)[key]).toEqual((DEFAULT_SETTINGS as unknown as Record<string, unknown>)[key]);
    expect(problems).toEqual([`invalid value for "${key}"; using the default`]);
  });

  it('allows clearing the Client ID with null', () => {
    expect(validateSettings({ clientId: null }).settings.clientId).toBeNull();
  });

  it('drops only the bad device volumes and caps how many are kept', () => {
    const many = Object.fromEntries(Array.from({ length: 120 }, (_, i) => [`dev-${i}`, 0.5]));

    const mixed = validateSettings({ deviceVolumes: { good: 0.3, loud: 1.5, '': 0.2, text: 'x' } });
    const capped = validateSettings({ deviceVolumes: many });

    expect(mixed.settings.deviceVolumes).toEqual({ good: 0.3 });
    expect(mixed.problems).toHaveLength(3);
    expect(Object.keys(capped.settings.deviceVolumes)).toHaveLength(100);
  });

  it('drops unknown keys and says so', () => {
    const { settings, problems } = validateSettings({ refreshToken: 'should-never-be-here', theme: 'dark' });

    expect(settings).toEqual(defaultSettings());
    expect(problems).toEqual(['unknown setting "refreshToken" dropped', 'unknown setting "theme" dropped']);
  });

  it('uses defaults for anything that is not a JSON object', () => {
    for (const value of [null, [], 'text', 42]) {
      expect(validateSettings(value)).toEqual({ settings: defaultSettings(), problems: ['settings are not a JSON object; using defaults'] });
    }
  });
});

describe('migrate', () => {
  it('treats a file without a version as the first format', () => {
    expect(migrate({ clientId: ID })).toEqual({ clientId: ID, version: 1 });
  });

  it('leaves current files alone', () => {
    expect(migrate({ version: 1, closeToTray: false })).toEqual({ version: 1, closeToTray: false });
  });
});

describe('SettingsStore', () => {
  let dir: string;
  let file: string;
  let reports: string[];

  /** A store on the temp folder with fake timers for the debounce. */
  const store = () => new SettingsStore(file, { report: (m) => reports.push(m), now: () => new Date('2026-10-03T12:00:00.000Z') });

  beforeEach(() => {
    vi.useFakeTimers();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playlish-settings-'));
    file = path.join(dir, 'settings.json');
    reports = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('starts from defaults when there is no file, without writing one', () => {
    const s = store();

    expect(s.get()).toEqual(defaultSettings());
    expect(fs.existsSync(file)).toBe(false);
  });

  it('loads and validates an existing file, reporting problems', () => {
    fs.writeFileSync(file, JSON.stringify({ clientId: ID, closeToTray: 'nope' }));

    const s = store();

    expect(s.get().clientId).toBe(ID);
    expect(s.get().closeToTray).toBe(true);
    expect(reports).toEqual(['invalid value for "closeToTray"; using the default']);
  });

  it('keeps a corrupt file aside and starts from defaults', () => {
    fs.writeFileSync(file, '{ "clientId": ');

    const s = store();

    expect(s.get()).toEqual(defaultSettings());
    expect(fs.existsSync(file)).toBe(false);
    expect(fs.readdirSync(dir)).toEqual(['settings.json.corrupt-2026-10-03T12-00-00-000Z']);
    expect(reports[0]).toMatch(/not valid JSON/);
  });

  it('debounces saves: many changes, one write after the delay', async () => {
    let writes = 0;
    const counting = { ...fs, writeFileSync: (f: string, d: string) => { writes++; fs.writeFileSync(f, d); } };
    const s = new SettingsStore(file, { fs: counting, report: (m) => reports.push(m) });

    s.update({ lastPage: 'search' });
    s.update({ closeToTray: false });
    s.update({ window: { width: 1300, height: 800, x: 10, y: 10, maximized: false } });
    expect(writes).toBe(0);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);

    expect(writes).toBe(1);
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toMatchObject({ lastPage: 'search', closeToTray: false, window: { width: 1300 } });
  });

  it('never writes the settings file in place: temporary file first, then a rename over it', () => {
    fs.writeFileSync(file, JSON.stringify({ lastPage: 'queue' }));
    const calls: string[] = [];
    const recording = {
      ...fs,
      writeFileSync: (f: string, d: string) => {
        calls.push(`write ${path.basename(f)}`);
        fs.writeFileSync(f, d);
      },
      renameSync: (a: string, b: string) => {
        calls.push(`rename ${path.basename(a)} -> ${path.basename(b)}`);
        fs.renameSync(a, b);
      },
    };
    const s = new SettingsStore(file, { fs: recording, report: (m) => reports.push(m) });

    s.update({ closeToTray: false });
    s.flush();

    expect(calls).toEqual(['write settings.json.tmp', 'rename settings.json.tmp -> settings.json']);
  });

  it('keeps the old file intact if writing the new one fails', () => {
    fs.writeFileSync(file, JSON.stringify({ lastPage: 'queue' }));
    const failing = {
      ...fs,
      writeFileSync: (f: string, d: string) => {
        fs.writeFileSync(f, d.slice(0, 5)); // a partial write, as in a crash or a full disk
        throw new Error('disk full');
      },
    };
    const s = new SettingsStore(file, { fs: failing, report: (m) => reports.push(m) });

    s.update({ closeToTray: false });
    s.flush();

    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ lastPage: 'queue' });
  });

  it('writes atomically and leaves no temporary file behind', async () => {
    const s = store();

    s.update({ startMinimized: true });
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS);

    expect(fs.readdirSync(dir)).toEqual(['settings.json']);
  });

  it('flush writes a pending change straight away and does nothing when nothing is pending', () => {
    const s = store();
    s.flush();
    expect(fs.existsSync(file)).toBe(false);

    s.update({ clientId: ID });
    s.flush();

    expect((JSON.parse(fs.readFileSync(file, 'utf8')) as { clientId: string }).clientId).toBe(ID);
  });

  it('rejects an invalid change, keeps the old value and reports it', () => {
    const s = store();
    s.update({ lastPage: 'queue' });

    s.update({ lastPage: 'nowhere' as never, closeToTray: false });

    expect(s.get().lastPage).toBe('queue');
    expect(s.get().closeToTray).toBe(false);
    expect(reports).toEqual(['settings update rejected: invalid value for "lastPage"; using the default']);
  });

  it('merges a partial window change with the current window', () => {
    const s = store();

    s.update({ window: { width: 1500 } as never });

    expect(s.get().window).toEqual({ ...DEFAULT_SETTINGS.window, width: 1500 });
  });

  it('tells listeners about every change until they unsubscribe', () => {
    const s = store();
    const seen: string[] = [];
    const off = s.onChange((settings) => seen.push(settings.lastPage));

    s.update({ lastPage: 'devices' });
    off();
    s.update({ lastPage: 'plugins' });

    expect(seen).toEqual(['devices']);
  });

  it('survives restarts: what was saved is what loads', () => {
    const first = store();
    first.update({ clientId: ID, lastPage: 'settings', deviceVolumes: { speakers: 0.25 } });
    first.flush();

    expect(store().get()).toMatchObject({ clientId: ID, lastPage: 'settings', deviceVolumes: { speakers: 0.25 } });
  });

  it('reports a failed write instead of throwing', () => {
    const s = new SettingsStore(path.join(dir, 'settings.json'), {
      report: (m) => reports.push(m),
      fs: { ...fs, writeFileSync: () => { throw new Error('disk full'); } },
    });

    s.update({ closeToTray: false });
    expect(() => s.flush()).not.toThrow();

    expect(reports).toEqual(['could not save settings: disk full']);
  });
});
