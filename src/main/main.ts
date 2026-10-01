import { BrowserWindow, Menu, Tray, app, components, ipcMain, nativeImage, safeStorage, shell } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PlaybackState, PlayerCommand, Snapshot, UiCommand } from '../shared/types';
import { Auth, SessionExpiredError } from './auth';
import { loadConfig, redirectUriFor, type SpikeConfig } from './config';
import { MetricsLogger } from './metrics';
import { resultPage, startServer } from './server';
import { SpotifyApiError, describeApiError, startPlayback, transferPlayback } from './spotify';

/*
 * Playlish spike (concept B: castLabs Electron).
 *
 * Two windows, by design:
 *  - the playback host: a hidden window that only runs the Web Playback SDK. It lives as long as there is a session.
 *  - the UI window: created on demand and fully destroyed when closed, so a tray-only app carries no UI renderer.
 */

// CHANGE HERE: start with only the tray icon (no UI window) when launched with this flag; used to measure idle cost.
const TRAY_ONLY_FLAG = '--tray';

// Memory: a separate GPU process cost ~60 MB private RAM at idle. Software rendering with the GPU work done in the main
// process measured 138 MB -> 75 MB total (see docs/SPIKE-RESULTS.md). The UI is simple, so software rendering is fine.
// CHANGE HERE: remove these two lines to re-enable hardware acceleration if the UI ever needs it.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('in-process-gpu');

let config: SpikeConfig | null = null;
let serverPort = 0;
let configError: string | null = null;
let auth: Auth | null = null;
let metrics: MetricsLogger | null = null;
let tray: Tray | null = null;
let uiWindow: BrowserWindow | null = null;
let hostWindow: BrowserWindow | null = null;
let deviceId: string | null = null;
let playback: PlaybackState | null = null;
let status = 'Starting…';
let startedPlayback = false;
let recentPlaybackErrors: number[] = [];

// CHANGE HERE: stop the player after this many playback errors inside the window below, so a licence failure doesn't loop.
const MAX_PLAYBACK_ERRORS = 3;
const PLAYBACK_ERROR_WINDOW_MS = 10_000;

/** Path of the encrypted session file (spike only; the MVP stores tokens in Windows Credential Manager). */
function sessionFile(): string {
  return path.join(app.getPath('userData'), 'session.bin');
}

/** Saves the refresh token encrypted with Windows DPAPI (safeStorage); never written in plain text. */
function saveRefreshToken(token: string): void {
  try {
    if (safeStorage.isEncryptionAvailable()) fs.writeFileSync(sessionFile(), safeStorage.encryptString(token));
  } catch (err) {
    log(`[error] could not save session: ${(err as Error).message}`);
  }
}

/** Loads the saved refresh token, or null if there is none or it can't be decrypted. */
function loadRefreshToken(): string | null {
  try {
    if (!fs.existsSync(sessionFile()) || !safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(fs.readFileSync(sessionFile()));
  } catch {
    return null;
  }
}

/** Builds the snapshot the UI renders. */
function snapshot(): Snapshot {
  return {
    status,
    configError,
    loggedIn: auth?.isLoggedIn() ?? false,
    deviceReady: deviceId !== null,
    playback,
    metrics: metrics?.getLatest() ?? null,
    perfLogPath: metrics?.csvPath ?? '',
  };
}

/** Pushes the current snapshot to the UI window if one is open. */
function pushSnapshot(): void {
  if (uiWindow && !uiWindow.isDestroyed()) uiWindow.webContents.send('ui:snapshot', snapshot());
}

/** Appends a timestamped line to playlish.log in the user data folder (for diagnosing errors). */
function log(line: string): void {
  console.log(line);
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'playlish.log'), `${new Date().toISOString()} ${line}
`);
  } catch {
    // Logging must never crash the app.
  }
}

/** Updates the status line shown in the UI and logs it. */
function setStatus(text: string): void {
  status = text;
  log(`[status] ${text}`);
  pushSnapshot();
}

/** Opens the UI window, or focuses it if it already exists. */
function openUi(): void {
  if (uiWindow && !uiWindow.isDestroyed()) {
    if (uiWindow.isMinimized()) uiWindow.restore();
    uiWindow.focus();
    return;
  }
  uiWindow = new BrowserWindow({
    width: 480,
    height: 560,
    title: 'Playlish (spike)',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/ui-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  uiWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  uiWindow.on('closed', () => {
    uiWindow = null; // Destroyed: no renderer process remains while the app sits in the tray.
  });
  void uiWindow.loadURL(`http://127.0.0.1:${serverPort}/ui.html`);
}

/**
 * Logs what the playback host reports, to diagnose the SDK's opaque "Playback error": console warnings/errors from the
 * page, and failed requests to Spotify hosts (path only, query strings are dropped so tokens never reach the log).
 */
function attachHostDiagnostics(win: BrowserWindow): void {
  win.webContents.on('console-message', (event) => {
    if (event.level === 'warning' || event.level === 'error') {
      log(`[host console ${event.level}] ${event.message.slice(0, 300)}`);
    }
  });
  win.webContents.session.webRequest.onCompleted({ urls: ['https://*.spotify.com/*', 'https://*.scdn.co/*'] }, (details) => {
    if (details.statusCode >= 400) {
      const url = new URL(details.url);
      log(`[host http ${details.statusCode}] ${details.method} ${url.host}${url.pathname}`);
    }
  });
}

/** Creates the hidden playback host window that runs the Web Playback SDK. */
function createHostWindow(): void {
  if (hostWindow && !hostWindow.isDestroyed()) return;
  hostWindow = new BrowserWindow({
    show: false,
    width: 320,
    height: 240,
    webPreferences: {
      preload: path.join(__dirname, '../preload/host-preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      // Audio must keep playing and timers (fades) must keep running while the window is hidden.
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      // Experiment hook while we investigate an intermittent Widevine 403: PLAYLISH_PARTITION overrides the partition.
      // CHANGE HERE: default partition for the playback host (a "persist:" prefix keeps its storage on disk).
      partition: process.env['PLAYLISH_PARTITION'] ?? 'persist:playback',
    },
  });
  hostWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  attachHostDiagnostics(hostWindow);
  hostWindow.on('closed', () => {
    hostWindow = null;
    deviceId = null;
    playback = null;
    pushSnapshot();
  });
  void hostWindow.loadURL(`http://127.0.0.1:${serverPort}/host.html`);
}

/** Runs the browser login, then starts the playback host. Errors are shown in the status line. */
async function login(): Promise<void> {
  if (!auth) return;
  setStatus('Waiting for you to approve the login in your browser…');
  try {
    await auth.startLogin((url) => shell.openExternal(url));
    setStatus('Logged in. Starting player…');
    createHostWindow();
  } catch (err) {
    setStatus(`Login failed: ${(err as Error).message}`);
  }
}

/** Starts the configured track on the SDK device and reports errors in plain language. */
async function playConfiguredTrack(): Promise<void> {
  if (!auth || !config || !deviceId) return;
  try {
    setStatus('Connecting the player to your account…');
    await transferPlayback(await auth.getAccessToken(), deviceId);
    await startPlayback(await auth.getAccessToken(), deviceId, config.trackUri);
    setStatus('Playing.');
  } catch (err) {
    log(`[error] playback start failed: ${err instanceof SpotifyApiError ? `${err.status} ${err.reason ?? ''} ${err.message}` : String(err)}`);
    if (err instanceof SpotifyApiError) setStatus(describeApiError(err));
    else if (err instanceof SessionExpiredError) setStatus(err.message);
    else setStatus(`Could not start playback: ${(err as Error).message}`);
  }
}

/** Records a playback error and reports whether the burst limit has been reached. */
function tooManyPlaybackErrors(): boolean {
  const now = Date.now();
  recentPlaybackErrors = recentPlaybackErrors.filter((t) => now - t < PLAYBACK_ERROR_WINDOW_MS);
  recentPlaybackErrors.push(now);
  return recentPlaybackErrors.length >= MAX_PLAYBACK_ERRORS;
}

/** Wires the IPC channels between main, the UI window and the playback host. */
function registerIpc(): void {
  // Host -> main
  ipcMain.handle('host:get-token', async () => {
    if (!auth) throw new Error('Not configured');
    return auth.getAccessToken();
  });
  ipcMain.on('host:ready', (_event, id: string) => {
    deviceId = id;
    setStatus('Player ready.');
    if (!startedPlayback) {
      startedPlayback = true;
      void playConfiguredTrack();
    }
  });
  ipcMain.on('host:state', (_event, state: PlaybackState | null) => {
    playback = state;
    pushSnapshot();
  });
  ipcMain.on('host:error', (_event, kind: string, message: string) => {
    log(`[error] player ${kind}: ${message}`);
    if (kind === 'playback_error' && tooManyPlaybackErrors()) {
      log('[error] too many playback errors; stopping the playback host');
      hostWindow?.destroy();
      startedPlayback = false;
      setStatus(
        'Playback failed repeatedly (Spotify refused the Widevine licence). Log in again to retry; details are in playlish.log.',
      );
      return;
    }
    const friendly =
      kind === 'account_error'
        ? 'Spotify rejected this account for playback. Premium is required.'
        : kind === 'authentication_error'
          ? 'Spotify rejected the login token. Please log in again.'
          : `Player error (${kind}): ${message}`;
    setStatus(friendly);
  });

  // UI -> main
  ipcMain.on('ui:login', () => void login());
  ipcMain.on('ui:request-snapshot', () => pushSnapshot());
  ipcMain.on('ui:command', (_event, command: UiCommand) => {
    if (command.type === 'playTrack') {
      void playConfiguredTrack();
      return;
    }
    hostWindow?.webContents.send('host:command', command satisfies PlayerCommand);
  });
}

/** Creates the tray icon with Open/Quit entries. The tray is how the user gets the UI back after closing it. */
function createTray(): void {
  const icon = nativeImage.createFromPath(path.join(__dirname, '../assets/tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('Playlish (spike)');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open Playlish', click: openUi },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
  tray.on('click', openUi);
}

/** App start-up: single instance, wait for the Widevine CDM, start the local server, tray, metrics and (optionally) the UI. */
async function main(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', openUi);
  // Keep running in the tray when every window is closed.
  app.on('window-all-closed', () => undefined);
  Menu.setApplicationMenu(null);

  // castLabs Electron downloads/validates the Widevine CDM asynchronously; the SDK can't start before it is ready.
  const cdmReady = components.whenReady().then(
    () => console.log('[widevine] components ready:', JSON.stringify(components.status())),
    (err: unknown) => console.error('[widevine] components failed:', err),
  );
  await app.whenReady();

  const result = loadConfig(app.getAppPath());
  config = result.config;
  configError = result.error;

  metrics = new MetricsLogger(
    path.join(app.getPath('userData'), 'perf.csv'),
    () => ({
      playing: playback !== null && !playback.paused,
      uiOpen: uiWindow !== null && !uiWindow.isDestroyed(),
      hostOpen: hostWindow !== null && !hostWindow.isDestroyed(),
    }),
    () => pushSnapshot(),
    (message) => log(`[error] ${message}`),
  );

  registerIpc();
  createTray();

  serverPort = result.port;
  if (config) auth = new Auth(config.clientId, redirectUriFor(config.port), saveRefreshToken);
  try {
    // The server always starts so the UI window can load and explain configuration problems.
    await startServer({
      port: serverPort,
      webRoot: path.join(__dirname, '../web/renderer'),
      onCallback: async (params) => {
        if (!auth) throw new Error('Playlish is not configured with a Client ID.');
        await auth.handleCallback(params);
        return resultPage('Logged in', 'You can close this tab and return to Playlish.');
      },
    });
  } catch (err) {
    configError = `Could not start the local server on port ${serverPort} (is another copy running?): ${(err as Error).message}`;
    auth = null;
  }

  await cdmReady;
  metrics.start();
  const saved = auth ? loadRefreshToken() : null;
  if (auth && saved) {
    auth.restore(saved);
    setStatus('Restoring your session…');
    createHostWindow();
  } else {
    setStatus(configError ? 'Configuration needed.' : 'Not logged in.');
  }
  if (!process.argv.includes(TRAY_ONLY_FLAG)) openUi();
}

app.on('before-quit', () => metrics?.stop());
void main();
