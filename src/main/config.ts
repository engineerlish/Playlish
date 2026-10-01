import * as fs from 'node:fs';
import * as path from 'node:path';

/** Settings the spike reads from spike.config.json (the real app will use the first-run wizard instead). */
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
const DEFAULT_TRACK_URI = 'spotify:track:4cOdK2wGLETKBW3PvgPWqT';
// CHANGE HERE: loopback port for the redirect URI and the local page server. Must match the Redirect URI registered in the Spotify dashboard.
const DEFAULT_PORT = 43821;

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
  const file = path.join(appRoot, 'spike.config.json');
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
