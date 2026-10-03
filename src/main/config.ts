import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * The spike's spike.config.json. Only read once now, to import its Client ID into the settings (#40); the first-run
 * wizard replaced it.
 */
export interface SpikeConfig {
  clientId: string;
  trackUri: string;
  port: number;
}

export interface ConfigResult {
  config: SpikeConfig | null;
  error: string | null;
  /** Port the local server uses; set even when the config is invalid so the UI can still load and explain the problem. */
  port: number;
}

// CHANGE HERE: default track played by the spike (Rick Astley - Never Gonna Give You Up).
export const DEFAULT_TRACK_URI = 'spotify:track:4cOdK2wGLETKBW3PvgPWqT';
// CHANGE HERE: loopback port for the redirect URI and the local page server. Must match the Redirect URI registered in the Spotify dashboard.
export const DEFAULT_PORT = 43821;

// CHANGE HERE: name of the spike's config file in the project folder.
export const LEGACY_CONFIG_FILE = 'spike.config.json';

const CLIENT_ID_PATTERN = /^[0-9a-f]{32}$/i;
const TRACK_URI_PATTERN = /^spotify:track:[A-Za-z0-9]{22}$/;

/** True for a whole number that is a usable TCP port. */
function isValidPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65_535;
}

/** Builds the failure result: no config, an explanation for the UI, and a port the UI can still be served on. */
function fail(error: string, port: number): ConfigResult {
  return { config: null, error, port };
}

/**
 * Loads and validates spike.config.json from the project root.
 * The PLAYLISH_CLIENT_ID environment variable (when not empty) overrides the file's clientId.
 * Always returns an error string instead of throwing, so the UI can show a helpful message.
 */
export function loadConfig(appRoot: string): ConfigResult {
  const file = path.join(appRoot, LEGACY_CONFIG_FILE);
  let raw: Record<string, unknown> = {};

  if (fs.existsSync(file)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      return fail(`spike.config.json is not valid JSON: ${(err as Error).message}`, DEFAULT_PORT);
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return fail('spike.config.json must contain a JSON object, like the one in spike.config.example.json.', DEFAULT_PORT);
    }
    raw = parsed as Record<string, unknown>;
  }

  if (raw['port'] !== undefined && !isValidPort(raw['port'])) {
    return fail('spike.config.json: "port" must be a whole number between 1 and 65535.', DEFAULT_PORT);
  }
  const port = isValidPort(raw['port']) ? raw['port'] : DEFAULT_PORT;

  const fromEnv = (process.env['PLAYLISH_CLIENT_ID'] ?? '').trim();
  const fromFile = typeof raw['clientId'] === 'string' ? raw['clientId'].trim() : '';
  const clientId = fromEnv !== '' ? fromEnv : fromFile;
  if (!CLIENT_ID_PATTERN.test(clientId)) {
    return fail(
      'No valid Client ID. Copy spike.config.example.json to spike.config.json and paste the 32-character Client ID from your Spotify Developer Dashboard app (as a quoted string).',
      port,
    );
  }

  const trackUri = raw['trackUri'] === undefined ? DEFAULT_TRACK_URI : raw['trackUri'];
  if (typeof trackUri !== 'string' || !TRACK_URI_PATTERN.test(trackUri)) {
    return fail('spike.config.json: "trackUri" must look like spotify:track:4cOdK2wGLETKBW3PvgPWqT.', port);
  }

  return { config: { clientId, trackUri, port }, error: null, port };
}

/** The exact Redirect URI the user must register in the Spotify dashboard. */
export function redirectUriFor(port: number): string {
  return `http://127.0.0.1:${port}/callback`;
}

/**
 * The Client ID to use. PLAYLISH_CLIENT_ID (when set to a valid id) is a developer override; otherwise the one saved in
 * the settings by the setup wizard. Returns null when setup is needed.
 */
export function resolveClientId(envValue: string | undefined, settingsValue: string | null): string | null {
  const fromEnv = (envValue ?? '').trim().toLowerCase();
  if (CLIENT_ID_PATTERN.test(fromEnv)) return fromEnv;
  return settingsValue && CLIENT_ID_PATTERN.test(settingsValue) ? settingsValue.toLowerCase() : null;
}

export type LegacyImportResult = 'no-file' | 'imported' | 'already-imported' | 'kept-existing' | 'invalid-file' | 'not-verified';

export interface LegacyImportDeps {
  appRoot: string;
  /** The Client ID currently in the settings. */
  currentClientId: () => string | null;
  /** Saves the Client ID and writes the settings file now. */
  saveClientId: (clientId: string) => void;
  /** Reads the Client ID back from the settings file on disk (not from memory). */
  readBackClientId: () => string | null;
  removeFile?: (file: string) => void;
  report?: (message: string) => void;
}

/**
 * One-time import of the spike's spike.config.json into the settings. The file is deleted only after the Client ID has
 * been written and read back from disk. Safe to run any number of times. A different Client ID already in the settings
 * is never overwritten, and an invalid file is left untouched for the user to look at.
 */
export function importLegacyConfig(deps: LegacyImportDeps): LegacyImportResult {
  const file = path.join(deps.appRoot, LEGACY_CONFIG_FILE);
  const report = deps.report ?? (() => undefined);
  const remove = deps.removeFile ?? ((f: string) => fs.rmSync(f, { force: true }));
  if (!fs.existsSync(file)) return 'no-file';

  const legacy = loadConfig(deps.appRoot);
  if (!legacy.config) {
    report(`${LEGACY_CONFIG_FILE} was not imported because it is not valid (${legacy.error ?? 'unknown problem'}); it was left in place`);
    return 'invalid-file';
  }
  const clientId = legacy.config.clientId.toLowerCase();
  const current = deps.currentClientId()?.toLowerCase() ?? null;
  if (current && current !== clientId) {
    report(`${LEGACY_CONFIG_FILE} has a different Client ID than the settings; the settings were kept and the file was left in place`);
    return 'kept-existing';
  }
  if (!current) deps.saveClientId(clientId);
  if (deps.readBackClientId()?.toLowerCase() !== clientId) {
    report(`the Client ID from ${LEGACY_CONFIG_FILE} could not be confirmed in the settings; the file was left in place`);
    return 'not-verified';
  }
  remove(file);
  report(`imported the Client ID from ${LEGACY_CONFIG_FILE} into the settings and removed the file`);
  return current ? 'already-imported' : 'imported';
}
