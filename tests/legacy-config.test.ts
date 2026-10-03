import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LEGACY_CONFIG_FILE, importLegacyConfig, resolveClientId } from '../src/main/config';
import { SettingsStore } from '../src/main/settings';

const ID = '0123456789abcdef0123456789abcdef';
const OTHER = 'fedcba9876543210fedcba9876543210';

let root: string;
let settingsFile: string;
let reports: string[];

/** Writes the spike's config file into the temp project folder. */
const writeLegacy = (content: unknown) => fs.writeFileSync(path.join(root, LEGACY_CONFIG_FILE), typeof content === 'string' ? content : JSON.stringify(content));
const legacyExists = () => fs.existsSync(path.join(root, LEGACY_CONFIG_FILE));

/** Runs the import against a real SettingsStore on disk, as the app does. */
function runImport(overrides: Partial<Parameters<typeof importLegacyConfig>[0]> = {}) {
  const store = new SettingsStore(settingsFile);
  return importLegacyConfig({
    appRoot: root,
    currentClientId: () => store.get().clientId,
    saveClientId: (id) => {
      store.update({ clientId: id });
      store.flush();
    },
    readBackClientId: () => new SettingsStore(settingsFile).get().clientId,
    report: (m) => reports.push(m),
    ...overrides,
  });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'playlish-legacy-'));
  settingsFile = path.join(root, 'user-data', 'settings.json');
  reports = [];
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('importLegacyConfig', () => {
  it('does nothing when there is no spike.config.json', () => {
    expect(runImport()).toBe('no-file');
    expect(fs.existsSync(settingsFile)).toBe(false);
  });

  it('imports the Client ID, confirms it on disk, then removes the file', () => {
    writeLegacy({ clientId: ID.toUpperCase(), trackUri: 'spotify:track:4cOdK2wGLETKBW3PvgPWqT', port: 43821 });

    expect(runImport()).toBe('imported');

    expect(new SettingsStore(settingsFile).get().clientId).toBe(ID);
    expect(legacyExists()).toBe(false);
    expect(reports.at(-1)).toMatch(/imported the Client ID/);
  });

  it('never imports into a custom profile, so a test profile cannot take the file from the real one', () => {
    writeLegacy({ clientId: ID });

    expect(runImport({ customProfile: true })).toBe('skipped-custom-profile');
    expect(legacyExists()).toBe(true);
    expect(fs.existsSync(settingsFile)).toBe(false);
    expect(reports.at(-1)).toMatch(/custom profile/);
  });

  it('is safe to run twice', () => {
    writeLegacy({ clientId: ID });

    expect(runImport()).toBe('imported');
    expect(runImport()).toBe('no-file');
    expect(new SettingsStore(settingsFile).get().clientId).toBe(ID);
  });

  it('removes a leftover file whose Client ID is already in the settings', () => {
    const store = new SettingsStore(settingsFile);
    store.update({ clientId: ID });
    store.flush();
    writeLegacy({ clientId: ID });

    expect(runImport()).toBe('already-imported');
    expect(legacyExists()).toBe(false);
  });

  it('never overwrites a different Client ID already in the settings, and keeps the file', () => {
    const store = new SettingsStore(settingsFile);
    store.update({ clientId: OTHER });
    store.flush();
    writeLegacy({ clientId: ID });

    expect(runImport()).toBe('kept-existing');
    expect(new SettingsStore(settingsFile).get().clientId).toBe(OTHER);
    expect(legacyExists()).toBe(true);
  });

  it.each([
    ['broken JSON', '{ "clientId": '],
    ['the placeholder', { clientId: 'PASTE_YOUR_SPOTIFY_CLIENT_ID_HERE' }],
    ['a bad port', { clientId: ID, port: 0 }],
  ])('leaves an invalid file (%s) untouched and imports nothing', (_name, content) => {
    writeLegacy(content);

    expect(runImport()).toBe('invalid-file');
    expect(legacyExists()).toBe(true);
    expect(fs.existsSync(settingsFile)).toBe(false);
  });

  it('keeps the file when the Client ID cannot be confirmed on disk (for example the settings write failed)', () => {
    writeLegacy({ clientId: ID });
    const remove = vi.fn();

    expect(runImport({ saveClientId: () => undefined, readBackClientId: () => null, removeFile: remove })).toBe('not-verified');
    expect(remove).not.toHaveBeenCalled();
    expect(legacyExists()).toBe(true);
  });
});

describe('resolveClientId', () => {
  it('uses the settings value, normalized', () => {
    expect(resolveClientId(undefined, ID.toUpperCase())).toBe(ID);
  });

  it('lets a valid PLAYLISH_CLIENT_ID override the settings, and ignores an empty or invalid one', () => {
    expect(resolveClientId(` ${OTHER} `, ID)).toBe(OTHER);
    expect(resolveClientId('', ID)).toBe(ID);
    expect(resolveClientId('nonsense', ID)).toBe(ID);
  });

  it('returns null when setup is needed', () => {
    expect(resolveClientId(undefined, null)).toBeNull();
    expect(resolveClientId(undefined, 'bad')).toBeNull();
  });
});
