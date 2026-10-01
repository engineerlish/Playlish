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

/**
 * Loads and validates spike.config.json from the project root.
 * The PLAYLISH_CLIENT_ID environment variable overrides the file's clientId.
 * Returns an error string (never throws) so the UI can show a helpful message.
 */
export function loadConfig(appRoot: string): ConfigResult {
  const file = path.join(appRoot, 'spike.config.json');
  let raw: Partial<SpikeConfig> = {};

  if (fs.existsSync(file)) {
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<SpikeConfig>;
    } catch (err) {
      return { config: null, error: `spike.config.json is not valid JSON: ${(err as Error).message}`, port: DEFAULT_PORT };
    }
  }

  const port = raw.port ?? DEFAULT_PORT;
  const clientId = (process.env['PLAYLISH_CLIENT_ID'] ?? raw.clientId ?? '').trim();
  if (!/^[0-9a-f]{32}$/i.test(clientId)) {
    return {
      config: null,
      error:
        'No valid Client ID. Copy spike.config.example.json to spike.config.json and paste the 32-character Client ID from your Spotify Developer Dashboard app.',
      port,
    };
  }

  return {
    config: {
      clientId,
      trackUri: raw.trackUri ?? DEFAULT_TRACK_URI,
      port,
    },
    error: null,
    port,
  };
}

/** The exact Redirect URI the user must register in the Spotify dashboard. */
export function redirectUriFor(port: number): string {
  return `http://127.0.0.1:${port}/callback`;
}
