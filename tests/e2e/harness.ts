import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { SCOPES } from '../../src/main/auth';
import { FakeSpotify } from '../helpers/fake-spotify';

/*
 * Starts the real, built Playlish in end-to-end test mode (src/main/e2e.ts): a fresh profile in a temp folder, a fake
 * Spotify server on 127.0.0.1, and the SDK stub instead of the real Web Playback SDK. Nothing talks to Spotify, and no
 * real account, token or Widevine licence is used.
 */

const ROOT = path.resolve(__dirname, '../..');
const ELECTRON_EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
export const SDK_STUB = path.join(__dirname, 'fixtures', 'spotify-player.js');
// CHANGE HERE: a made-up Client ID in the right format. It is never sent anywhere but the fake server.
export const TEST_CLIENT_ID = '0123456789abcdef0123456789abcdef';
export const REFRESH_TOKEN = 'e2e-refresh-token';

/** A free TCP port on 127.0.0.1 for the app's loopback server. */
export async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

/**
 * Scripts the fake Spotify for a working account: login (the authorize page redirects straight back with a code),
 * token exchange and refresh with every scope Playlish asks for, and play requests.
 */
export function scriptWorkingAccount(fake: FakeSpotify): void {
  fake.on('GET', '/authorize', (request) => {
    const redirect = new URL(request.query.get('redirect_uri') ?? 'http://127.0.0.1:1/missing');
    redirect.searchParams.set('code', 'e2e-code');
    redirect.searchParams.set('state', request.query.get('state') ?? '');
    return { status: 302, headers: { Location: redirect.toString() } };
  });
  fake.on('POST', '/api/token', {
    status: 200,
    body: { access_token: 'e2e-access-token', token_type: 'Bearer', expires_in: 3600, refresh_token: REFRESH_TOKEN, scope: SCOPES.join(' ') },
  });
  fake.on('PUT', '/v1/me/player/play', { status: 204 });
  // Nothing plays on other devices unless a test says so.
  fake.on('GET', '/v1/me/player', { status: 204 });
  for (const path of ['/v1/me/player/pause', '/v1/me/player/seek', '/v1/me/player/shuffle', '/v1/me/player/repeat', '/v1/me/player/volume']) fake.on('PUT', path, { status: 204 });
  for (const path of ['/v1/me/player/next', '/v1/me/player/previous']) fake.on('POST', path, { status: 204 });
}

export interface Launched {
  app: ElectronApplication;
  /** The main window. */
  ui: Page;
  userDataDir: string;
}

export interface LaunchOptions {
  fake: FakeSpotify;
  /** Reuse a profile (to test a restart); a new temp folder otherwise. */
  userDataDir?: string;
  /** Set PLAYLISH_CLIENT_ID, skipping the wizard. */
  clientId?: string;
  /** Start with only the tray icon. */
  trayOnly?: boolean;
  /** Start with all plugins off (--safe-mode). */
  safeMode?: boolean;
  /** Set false when the app is expected to start without a window (for example "start in the tray"). */
  expectWindow?: boolean;
}

/** Launches Playlish and waits for its main window (unless tray-only). */
export async function launch(options: LaunchOptions): Promise<Launched> {
  const userDataDir = options.userDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'playlish-e2e-'));
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    // Never pass on a real Client ID or debug settings from the developer's shell.
    if (value !== undefined && !key.startsWith('PLAYLISH_')) env[key] = value;
  }
  Object.assign(env, {
    PLAYLISH_E2E: '1',
    PLAYLISH_E2E_ACCOUNTS: options.fake.baseUrl,
    PLAYLISH_E2E_API: options.fake.baseUrl,
    PLAYLISH_E2E_PORT: String(await freePort()),
    PLAYLISH_E2E_SDK_STUB: SDK_STUB,
    ...(options.clientId ? { PLAYLISH_CLIENT_ID: options.clientId } : {}),
  });
  const app = await electron.launch({
    executablePath: ELECTRON_EXE,
    args: ['.', `--user-data-dir=${userDataDir}`, ...(options.trayOnly ? ['--tray'] : []), ...(options.safeMode ? ['--safe-mode'] : [])],
    cwd: ROOT,
    env,
  });
  try {
    const ui = options.trayOnly || options.expectWindow === false ? (undefined as unknown as Page) : await uiWindow(app);
    return { app, ui, userDataDir };
  } catch (err) {
    // The test never gets this app, so nothing else would close it: a leaked instance once kept running for hours
    // and made later tests fail at launch.
    await app.close().catch(() => undefined);
    if (!options.userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    throw err;
  }
}

/** The main window: an open one, or the next one to open. The hidden playback host is never returned. */
export async function uiWindow(app: ElectronApplication): Promise<Page> {
  // Polled: Playwright reports a new window before it has navigated, while its URL is still about:blank.
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const page = app.windows().find((p) => p.url().endsWith('/ui.html'));
    if (page) {
      await page.waitForSelector('#app > *');
      return page;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The main window did not open');
}

/** Runs JavaScript in the hidden playback host (where the SDK stub lives) and returns the result. */
export async function inHost<T>(app: ElectronApplication, script: string): Promise<T> {
  return app.evaluate(async ({ BrowserWindow }, js) => {
    const host = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && !w.webContents.isDestroyed() && w.webContents.getURL().endsWith('/host.html'));
    if (!host) throw new Error('The playback host is not running');
    return (await host.webContents.executeJavaScript(js)) as unknown;
  }, script) as Promise<T>;
}

/** Waits until the playback host exists and the stub has reported the device as ready. */
export async function waitForPlayerReady(app: ElectronApplication, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const calls = await inHost<{ method: string }[]>(app, 'window.__stub ? window.__stub.calls : []');
      if (calls.some((c) => c.method === 'token')) {
        // The stub reports "ready" 50 ms after the token; give main a moment to handle it.
        await new Promise((resolve) => setTimeout(resolve, 200));
        return;
      }
    } catch {
      // Host not there yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('The player did not become ready');
}

/** Player methods the stub has seen, in order (constructor, connect and token excluded). */
export async function stubCommands(app: ElectronApplication): Promise<{ method: string; args: unknown[] }[]> {
  const calls = await inHost<{ method: string; args: unknown[] }[]>(app, 'window.__stub.calls');
  return calls.filter((c) => !['constructor', 'connect', 'token'].includes(c.method));
}

/** Number of BrowserWindows that are still open, and how many of them are the playback host. */
export async function windowCounts(app: ElectronApplication): Promise<{ all: number; hosts: number }> {
  return app.evaluate(({ BrowserWindow }) => {
    // A window that is closing is already destroyed; it no longer counts.
    const all = BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed() && !w.webContents.isDestroyed());
    return { all: all.length, hosts: all.filter((w) => w.webContents.getURL().endsWith('/host.html')).length };
  });
}

/** Lines from the app log that carry the given code. */
export function logEntries(userDataDir: string, code: string): Record<string, unknown>[] {
  const file = path.join(userDataDir, 'logs', 'playlish.log');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.includes(`"code":"${code}"`))
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** Closes the app if it is still running, and removes the profile unless asked to keep it. */
export async function shutdown(launched: Launched | undefined, keepProfile = false): Promise<void> {
  if (!launched) return;
  await launched.app.close().catch(() => undefined);
  if (!keepProfile) fs.rmSync(launched.userDataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

/** Starts a fake Spotify scripted for a working account. */
export async function workingSpotify(): Promise<FakeSpotify> {
  const fake = await FakeSpotify.start();
  scriptWorkingAccount(fake);
  return fake;
}
