import * as fs from 'node:fs';

/*
 * End-to-end test mode (#9). The Playwright suite runs the real app against a local fake Spotify server and a stub of the
 * Web Playback SDK, so it needs to point the app at them. This module is the only place that reads those settings.
 *
 * Safety: test mode only exists in unpackaged builds (a release can never be switched into it), it must be asked for
 * explicitly with PLAYLISH_E2E=1, and every address must be on the loopback interface, so tokens can only ever go to a
 * server on this machine.
 */

export interface E2eConfig {
  /** Replaces https://accounts.spotify.com. */
  accountsBase: string;
  /** Replaces https://api.spotify.com (without /v1). */
  apiBase: string;
  /** Port for the loopback server, so tests do not clash with a running Playlish on the default port. */
  port: number;
  /** JavaScript file served in place of https://sdk.scdn.co/spotify-player.js. */
  sdkStubFile: string;
  /** A fake Equalizer APO config folder (PLAYLISH_E2E_EQ_DIR), or null for "not installed" (#91). */
  eqConfigDir: string | null;
}

/** True for an http URL on 127.0.0.1 with an explicit port and no path, query or credentials. */
export function isLoopbackBase(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      url.port !== '' &&
      url.username === '' &&
      url.password === '' &&
      (url.pathname === '/' || url.pathname === '') &&
      url.search === '' &&
      url.hash === '' &&
      !value.endsWith('/')
    );
  } catch {
    return false;
  }
}

/**
 * Reads test mode from the environment. Returns null when test mode is off, and throws when it was asked for but is
 * set up wrongly, so a broken test setup fails loudly instead of quietly talking to the real Spotify.
 */
export function readE2eConfig(env: Record<string, string | undefined>, isPackaged: boolean, fileExists: (file: string) => boolean = fs.existsSync): E2eConfig | null {
  if (env['PLAYLISH_E2E'] !== '1') return null;
  if (isPackaged) throw new Error('PLAYLISH_E2E is not available in packaged builds.');
  const accountsBase = env['PLAYLISH_E2E_ACCOUNTS'] ?? '';
  const apiBase = env['PLAYLISH_E2E_API'] ?? '';
  const portText = env['PLAYLISH_E2E_PORT'] ?? '';
  const sdkStubFile = env['PLAYLISH_E2E_SDK_STUB'] ?? '';
  if (!isLoopbackBase(accountsBase)) throw new Error('PLAYLISH_E2E_ACCOUNTS must look like http://127.0.0.1:<port>.');
  if (!isLoopbackBase(apiBase)) throw new Error('PLAYLISH_E2E_API must look like http://127.0.0.1:<port>.');
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || port < 1024 || port > 65535) throw new Error('PLAYLISH_E2E_PORT must be a port number from 1024 to 65535.');
  if (!sdkStubFile.endsWith('.js') || !fileExists(sdkStubFile)) throw new Error('PLAYLISH_E2E_SDK_STUB must name an existing .js file.');
  const eqDir = env['PLAYLISH_E2E_EQ_DIR'];
  return { accountsBase, apiBase, port, sdkStubFile, eqConfigDir: eqDir && fileExists(eqDir) ? eqDir : null };
}

/** The address the stub replaces. */
export const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
