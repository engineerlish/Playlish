import * as fs from 'node:fs';
import * as path from 'node:path';

/*
 * The app's settings: one small JSON file in the user data folder.
 * - Every value is validated; a bad value falls back to its default and is reported, never crashes the app.
 * - Writes are atomic (temporary file, then rename) and debounced, so a burst of changes is one write.
 * - No secrets live here: the refresh token has its own encrypted file.
 */

export const SETTINGS_VERSION = 1;

import { PAGES, isPage, type Page } from '../shared/pages';

export { PAGES, type Page };

export interface WindowState {
  width: number;
  height: number;
  /** Position, or null to let Windows place the window. */
  x: number | null;
  y: number | null;
  maximized: boolean;
}

export interface Settings {
  version: number;
  /** The user's Spotify Client ID (32 hex characters), or null before setup. Not a secret under PKCE. */
  clientId: string | null;
  /** Closing the window keeps Playlish running in the tray. */
  closeToTray: boolean;
  /** Start with only the tray icon. */
  startMinimized: boolean;
  window: WindowState;
  lastPage: Page;
  /** Volume (0..1) remembered per audio output device id; used from 0.2.0. */
  deviceVolumes: Record<string, number>;
}

// CHANGE HERE: defaults for a new install.
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  version: SETTINGS_VERSION,
  clientId: null,
  closeToTray: true,
  startMinimized: false,
  window: Object.freeze({ width: 1100, height: 720, x: null, y: null, maximized: false }),
  lastPage: 'library',
  deviceVolumes: Object.freeze({}) as Record<string, number>,
});

// CHANGE HERE: limits used when validating.
const MIN_WINDOW = 360;
const MAX_WINDOW = 10_000;
const MAX_DEVICE_VOLUMES = 100;
// CHANGE HERE: how long to wait for more changes before writing.
export const SAVE_DEBOUNCE_MS = 500;

/** A fresh, mutable copy of the defaults. */
export function defaultSettings(): Settings {
  return { ...DEFAULT_SETTINGS, window: { ...DEFAULT_SETTINGS.window }, deviceVolumes: {} };
}

/** True for a plain object (not null, not an array). */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** True for a whole number in range. */
function isIntIn(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

/** Upgrades older settings files to the current shape. Version-less files are the first format. */
export function migrate(raw: Record<string, unknown>): Record<string, unknown> {
  const version = typeof raw['version'] === 'number' ? raw['version'] : 0;
  const out = { ...raw };
  if (version < 1) out['version'] = 1;
  return out;
}

/**
 * Validates parsed settings. Every key is checked on its own; anything missing or invalid takes its default and is
 * listed in `problems`. Unknown keys are dropped (and listed), so old or foreign data cannot accumulate.
 */
export function validateSettings(input: unknown): { settings: Settings; problems: string[] } {
  const problems: string[] = [];
  const settings = defaultSettings();
  if (!isObject(input)) {
    return { settings, problems: input === undefined ? [] : ['settings are not a JSON object; using defaults'] };
  }
  const raw = migrate(input);
  const known = new Set(Object.keys(settings));
  for (const key of Object.keys(raw)) if (!known.has(key)) problems.push(`unknown setting "${key}" dropped`);

  const bad = (key: string) => problems.push(`invalid value for "${key}"; using the default`);

  if (raw['clientId'] !== undefined) {
    if (raw['clientId'] === null || (typeof raw['clientId'] === 'string' && /^[0-9a-f]{32}$/i.test(raw['clientId']))) {
      settings.clientId = raw['clientId'];
    } else bad('clientId');
  }
  for (const key of ['closeToTray', 'startMinimized'] as const) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] === 'boolean') settings[key] = raw[key];
    else bad(key);
  }
  if (raw['window'] !== undefined) {
    const w = raw['window'];
    if (
      isObject(w) &&
      isIntIn(w['width'], MIN_WINDOW, MAX_WINDOW) &&
      isIntIn(w['height'], MIN_WINDOW, MAX_WINDOW) &&
      (w['x'] === null || isIntIn(w['x'], -MAX_WINDOW, MAX_WINDOW)) &&
      (w['y'] === null || isIntIn(w['y'], -MAX_WINDOW, MAX_WINDOW)) &&
      typeof w['maximized'] === 'boolean'
    ) {
      settings.window = { width: w['width'], height: w['height'], x: w['x'], y: w['y'], maximized: w['maximized'] };
    } else bad('window');
  }
  if (raw['lastPage'] !== undefined) {
    if (isPage(raw['lastPage'])) settings.lastPage = raw['lastPage'];
    else bad('lastPage');
  }
  if (raw['deviceVolumes'] !== undefined) {
    const v = raw['deviceVolumes'];
    if (isObject(v)) {
      let kept = 0;
      for (const [id, volume] of Object.entries(v)) {
        if (kept >= MAX_DEVICE_VOLUMES) {
          problems.push(`more than ${MAX_DEVICE_VOLUMES} device volumes; extra entries dropped`);
          break;
        }
        if (id.length > 0 && id.length <= 512 && typeof volume === 'number' && volume >= 0 && volume <= 1) {
          settings.deviceVolumes[id] = volume;
          kept++;
        } else problems.push('invalid device volume entry dropped');
      }
    } else bad('deviceVolumes');
  }
  return { settings, problems };
}

/** The file system calls the store uses; replaced in tests. */
export interface SettingsFs {
  readFileSync(file: string, encoding: 'utf8'): string;
  writeFileSync(file: string, data: string): void;
  renameSync(from: string, to: string): void;
  existsSync(file: string): boolean;
  mkdirSync(dir: string, options: { recursive: true }): unknown;
}

export interface SettingsDeps {
  fs?: SettingsFs;
  /** Called with each validation or I/O problem (the app logs them). */
  report?: (message: string) => void;
  setTimeout?: (callback: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  now?: () => Date;
}

/** Loads, validates, updates and saves the settings file. */
export class SettingsStore {
  private current: Settings;
  private pending: unknown = null;
  private readonly listeners = new Set<(settings: Readonly<Settings>) => void>();
  private readonly fs: SettingsFs;
  private readonly report: (message: string) => void;
  private readonly setTimer: (callback: () => void, ms: number) => unknown;
  private readonly clearTimer: (handle: unknown) => void;
  private readonly now: () => Date;

  constructor(
    readonly file: string,
    deps: SettingsDeps = {},
  ) {
    this.fs = deps.fs ?? fs;
    this.report = deps.report ?? (() => undefined);
    this.setTimer = deps.setTimeout ?? ((callback, ms) => setTimeout(callback, ms));
    this.clearTimer = deps.clearTimeout ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
    this.now = deps.now ?? (() => new Date());
    this.current = this.load();
  }

  /** The current settings (read-only; change them with update()). */
  get(): Readonly<Settings> {
    return this.current;
  }

  /**
   * Applies a partial change. The merged result is validated like a file on disk, so an invalid value is rejected
   * (the old value stays) and reported. Saves after a short delay. Returns the new settings.
   */
  update(patch: Partial<Omit<Settings, 'version'>>): Readonly<Settings> {
    const merged = { ...this.current, ...patch, window: { ...this.current.window, ...patch.window } };
    const { settings, problems } = validateSettings(merged);
    for (const problem of problems) this.report(`settings update rejected: ${problem}`);
    // Keep the previous value of every key the patch got wrong.
    const next: Settings = { ...settings };
    for (const key of Object.keys(patch) as (keyof Settings)[]) {
      if (problems.some((p) => p.includes(`"${key}"`))) (next as unknown as Record<string, unknown>)[key] = this.current[key];
    }
    this.current = next;
    this.scheduleSave();
    for (const listener of this.listeners) listener(this.current);
    return this.current;
  }

  /** Calls the listener after every change. Returns a function that removes it. */
  onChange(listener: (settings: Readonly<Settings>) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Writes now if a save is pending (call before quitting). */
  flush(): void {
    if (this.pending === null) return;
    this.clearTimer(this.pending);
    this.pending = null;
    this.save();
  }

  /** Reads the file; a missing file gives defaults, a corrupt one is kept aside and replaced with defaults. */
  private load(): Settings {
    if (!this.fs.existsSync(this.file)) return defaultSettings();
    let parsed: unknown;
    try {
      parsed = JSON.parse(this.fs.readFileSync(this.file, 'utf8'));
    } catch (err) {
      const aside = `${this.file}.corrupt-${this.now().toISOString().replace(/[:.]/g, '-')}`;
      try {
        this.fs.renameSync(this.file, aside);
        this.report(`settings file was not valid JSON (${(err as Error).message}); kept as ${path.basename(aside)}, using defaults`);
      } catch {
        this.report('settings file was not valid JSON and could not be moved aside; using defaults');
      }
      return defaultSettings();
    }
    const { settings, problems } = validateSettings(parsed);
    for (const problem of problems) this.report(problem);
    return settings;
  }

  /** Schedules a debounced save. */
  private scheduleSave(): void {
    if (this.pending !== null) this.clearTimer(this.pending);
    this.pending = this.setTimer(() => {
      this.pending = null;
      this.save();
    }, SAVE_DEBOUNCE_MS);
  }

  /** Writes atomically: a temporary file next to the real one, then a rename over it. */
  private save(): void {
    const tmp = `${this.file}.tmp`;
    try {
      this.fs.mkdirSync(path.dirname(this.file), { recursive: true });
      this.fs.writeFileSync(tmp, `${JSON.stringify(this.current, null, 2)}\n`);
      this.fs.renameSync(tmp, this.file);
    } catch (err) {
      this.report(`could not save settings: ${(err as Error).message}`);
    }
  }
}
