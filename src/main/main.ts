import { BrowserWindow, Menu, Tray, app, components, dialog, ipcMain, nativeImage, safeStorage, shell } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { PlaybackState, PlayerCommand, Snapshot, UiCommand } from '../shared/types';
import { appInfo, initLogging } from './app-logging';
import { Auth, SessionExpiredError } from './auth';
import { loadConfig, redirectUriFor, type SpikeConfig } from './config';
import { ErrorBurstLimiter } from './error-burst';
import { installProcessHandlers, type CrashReport } from './logging/crash';
import { NEW_ISSUE_URL, buildDiagnosticsBundle, buildIssueUrl, crashId, crashIssue, lastLines, unseenCrash } from './logging/diagnostics';
import { MetricsLogger } from './metrics';
import { resultPage, startServer } from './server';
import { SettingsStore } from './settings';
import { TokenStore } from './token-store';
import { startSoakDriver } from './soak-driver';
import { SpotifyApiError, describeApiError, startPlayback } from './spotify';
import { RequestQueue } from './spotify/queue';

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

// Logging and crash capture come first, so even a failure during start-up is recorded.
const logging = initLogging();
const log = logging.log;
const authLog = log.child('auth');
const hostLog = log.child('host');
const playerLog = log.child('player');
const uiLog = log.child('ui');
installProcessHandlers(process, logging.crashes, () => app.exit(1));

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
let crashNotice: CrashReport | null = null;
let settings: SettingsStore | null = null;
let tokens: TokenStore | null = null;
// Every Web API call goes through this queue: priorities, Retry-After and the quota pause (#41).
const apiQueue = new RequestQueue();
let uiReadyLogged = false;
const playbackErrors = new ErrorBurstLimiter();
// CHANGE HERE: give up restarting a stalling player after this many restarts inside the window.
const stallRestarts = new ErrorBurstLimiter(3, 5 * 60_000);

/** File remembering which crash reports the user has already been asked about. */
function diagnosticsStateFile(): string {
  return path.join(logging.logsDir, 'diagnostics-state.json');
}

/** Crash ids the user has already been asked about. */
function seenCrashIds(): Set<string> {
  try {
    const parsed = JSON.parse(fs.readFileSync(diagnosticsStateFile(), 'utf8')) as { seenCrashIds?: unknown };
    return new Set(Array.isArray(parsed.seenCrashIds) ? parsed.seenCrashIds.filter((x): x is string => typeof x === 'string') : []);
  } catch {
    return new Set();
  }
}

/** Remembers that the user has been asked about a crash (keeps the list short). */
function markCrashSeen(report: CrashReport): void {
  const ids = [...seenCrashIds(), crashId(report)].slice(-50);
  try {
    fs.writeFileSync(diagnosticsStateFile(), JSON.stringify({ seenCrashIds: ids }));
  } catch (err) {
    log.warn('Could not save the crash notice state', { code: 'DIAGNOSTICS_STATE', error: err });
  }
}

/** Reads a text file, or returns an empty string. */
function readTextFile(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** The app log and its rotated copies, newest first. */
function appLogTexts(): string[] {
  return [logging.logFile, `${logging.logFile}.1`, `${logging.logFile}.2`].map(readTextFile).filter((t) => t !== '');
}

/** Opens a pre-filled issue in the browser, after checking the URL really points at the project. */
function openIssue(url: string): void {
  if (!url.startsWith(`${NEW_ISSUE_URL}?`)) return;
  void shell.openExternal(url);
}

/** Lets the user save a redacted diagnostics bundle and shows it in Explorer. */
async function exportDiagnostics(): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const parent = uiWindow && !uiWindow.isDestroyed() ? uiWindow : undefined;
  const options = {
    title: 'Export diagnostics',
    defaultPath: path.join(app.getPath('documents'), `playlish-diagnostics-${stamp}.txt`),
    filters: [{ name: 'Text', extensions: ['txt'] }],
  };
  const choice = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
  if (choice.canceled || !choice.filePath) return;
  const crashes = logging.crashes
    .list()
    .slice(0, 3)
    .map((f) => logging.crashes.read(f))
    .filter((r): r is CrashReport => r !== null);
  const bundle = buildDiagnosticsBundle({
    generatedAt: new Date(),
    app: appInfo(),
    state: {
      status,
      configured: configError === null,
      loggedIn: auth?.isLoggedIn() ?? false,
      playerReady: deviceId !== null,
      playing: playback !== null && !playback.paused,
    },
    appLogs: appLogTexts(),
    pluginLogs: [path.join(logging.logsDir, 'plugins.log')].map(readTextFile).filter((t) => t !== ''),
    crashes,
  });
  try {
    fs.writeFileSync(choice.filePath, bundle);
    log.info('Diagnostics exported', { code: 'DIAGNOSTICS_EXPORTED' });
    shell.showItemInFolder(choice.filePath);
    setStatus('Diagnostics saved. Please read the file before sharing it.');
  } catch (err) {
    log.error('Could not save diagnostics', { code: 'DIAGNOSTICS_EXPORT_FAILED', error: err });
    setStatus(`Could not save diagnostics: ${(err as Error).message}`);
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
    crashNotice: crashNotice ? { when: crashNotice.ts, process: crashNotice.process, kind: crashNotice.kind } : null,
  };
}

/** Pushes the current snapshot to the UI window if one is open. */
function pushSnapshot(): void {
  if (uiWindow && !uiWindow.isDestroyed()) uiWindow.webContents.send('ui:snapshot', snapshot());
}

/** Updates the status line shown in the UI and logs it. */
function setStatus(text: string): void {
  status = text;
  uiLog.info(`Status: ${text}`);
  pushSnapshot();
}

/** Closes the UI window (it is destroyed, not hidden). */
function closeUi(): void {
  if (uiWindow && !uiWindow.isDestroyed()) uiWindow.close();
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
  uiWindow.webContents.once('did-finish-load', () => {
    if (uiReadyLogged) return;
    uiReadyLogged = true;
    // Milestone read by the performance harness (tools/perf): time from process start to a usable UI.
    log.info('UI ready', { code: 'STARTUP_UI', context: { msSinceStart: Math.round(performance.now()) } });
  });
  void uiWindow.loadURL(`http://127.0.0.1:${serverPort}/ui.html`);
}

/**
 * Logs what the playback host reports, to diagnose the SDK's opaque "Playback error": console warnings/errors from the
 * page, and failed requests to Spotify hosts (path only, query strings are dropped so tokens never reach the log).
 */
function attachHostDiagnostics(win: BrowserWindow): void {
  // Opt-in firehose for investigations: PLAYLISH_DEBUG=1 logs every console message and every Spotify request status.
  const verbose = process.env['PLAYLISH_DEBUG'] === '1';
  win.webContents.on('console-message', (event) => {
    const message = event.message.slice(0, 300);
    if (event.level === 'error') hostLog.error(message, { code: 'HOST_CONSOLE' });
    else if (event.level === 'warning') hostLog.warn(message, { code: 'HOST_CONSOLE' });
    else if (verbose) hostLog.debug(message, { code: 'HOST_CONSOLE' });
  });
  // Spotify's own hosts always (failures only); every https host in verbose mode, because the audio itself comes from CDNs.
  const filter = { urls: verbose ? ['https://*/*'] : ['https://*.spotify.com/*', 'https://*.scdn.co/*'] };
  win.webContents.session.webRequest.onCompleted(filter, (details) => {
    const url = new URL(details.url);
    const context = { status: details.statusCode, method: details.method, url: `${url.host}${url.pathname}` };
    if (details.statusCode >= 400) hostLog.warn(`HTTP ${details.statusCode} ${details.method} ${context.url}`, { code: 'HTTP_ERROR', context });
    else if (verbose) hostLog.debug(`HTTP ${details.statusCode} ${details.method} ${context.url}`, { code: 'HTTP', context });
  });
  // Network-level failures (aborted, reset, DNS, TLS) never reach onCompleted.
  win.webContents.session.webRequest.onErrorOccurred(filter, (details) => {
    const url = new URL(details.url);
    const message = `${details.error} ${details.method} ${url.host}${url.pathname}`;
    // Aborted requests are normal (seeks, skips); they matter only when investigating, as in #17.
    if (details.error === 'net::ERR_ABORTED') hostLog.debug(message, { code: 'NET_ABORTED' });
    else hostLog.warn(message, { code: 'NET_ERROR' });
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
      // CHANGE HERE: partition for the playback host (a "persist:" prefix keeps its storage on disk). Tested during #17:
      // the partition's stored state is not the cause of silent playback.
      partition: 'persist:playback',
    },
  });
  hostWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  attachHostDiagnostics(hostWindow);
  const win = hostWindow;
  win.on('closed', () => {
    // A restart creates the new window before this fires for the old one; only clear state that still belongs to it.
    if (hostWindow !== win) return;
    hostWindow = null;
    deviceId = null;
    playback = null;
    pushSnapshot();
  });
  void hostWindow.loadURL(`http://127.0.0.1:${serverPort}/host.html`);
}

/** Rebuilds the playback host after a stall; gives up (with a clear message) if it keeps happening. */
function restartHost(): void {
  if (stallRestarts.record()) {
    playerLog.error('Playback keeps stalling; not restarting again', { code: 'PLAYBACK_STALL_GIVE_UP' });
    hostWindow?.destroy();
    startedPlayback = false;
    setStatus('Playback keeps stalling. Log in again or restart Playlish; details are in the log.');
    return;
  }
  playerLog.warn('Rebuilding the playback host', { code: 'PLAYBACK_HOST_RESTART' });
  hostWindow?.destroy();
  hostWindow = null;
  deviceId = null;
  playback = null;
  startedPlayback = false;
  setStatus('Playback stalled. Restarting the player…');
  createHostWindow();
}

/** Forgets the session everywhere: in memory, on disk, and in the playback host. */
function signOut(): void {
  auth?.clear();
  tokens?.clear();
  hostWindow?.destroy();
  hostWindow = null;
  deviceId = null;
  playback = null;
  startedPlayback = false;
  authLog.info('Signed out', { code: 'SIGNED_OUT' });
  setStatus('Signed out.');
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
    // One command only. The play call carries the device id, which also makes it the active device. A separate transfer
    // before it made the SDK start loading the account's remembered track and then abort that load when play arrived
    // (net::ERR_ABORTED on the first audio request), leaving some launches silent (#17). 404s while the new device is
    // still unknown to the Web API are retried inside startPlayback.
    setStatus('Connecting the player to your account…');
    const session = auth;
    const device = deviceId;
    const track = config.trackUri;
    await apiQueue.run({
      priority: 'user',
      endpoint: 'PUT /me/player/play',
      run: async () => startPlayback(await session.getAccessToken(), device, track),
    });
    setStatus('Playing.');
  } catch (err) {
    playerLog.error('Could not start playback', {
      code: 'PLAYBACK_START_FAILED',
      error: err,
      ...(err instanceof SpotifyApiError ? { context: { status: err.status, reason: err.reason } } : {}),
    });
    if (err instanceof SpotifyApiError) setStatus(describeApiError(err));
    else if (err instanceof SessionExpiredError) setStatus(err.message);
    else setStatus(`Could not start playback: ${(err as Error).message}`);
  }
}

/** Applies a playback state reported by the host (or simulated by the soak driver) and updates the UI. */
function onHostState(state: PlaybackState | null): void {
  playerLog.debug(state ? `State: paused=${String(state.paused)} position=${state.positionMs}ms` : 'State: none', {
    code: 'PLAYER_STATE',
  });
  playback = state;
  pushSnapshot();
}

/** Wires the IPC channels between main, the UI window and the playback host. */
function registerIpc(): void {
  // Host -> main
  ipcMain.handle('host:get-token', async () => {
    if (!auth) throw new Error('Not configured');
    return auth.getAccessToken();
  });
  ipcMain.on('host:log', (_event, message: string) => hostLog.info(message));
  ipcMain.on('renderer:error', (_event, source: string, message: string, stack?: string) => {
    log.child(`renderer:${source === 'host' ? 'host' : 'ui'}`).error(String(message).slice(0, 500), {
      code: 'RENDERER_ERROR',
      ...(stack ? { context: { stack: String(stack).slice(0, 4000) } } : {}),
    });
  });
  ipcMain.on('host:ready', (_event, id: string) => {
    deviceId = id;
    setStatus('Player ready.');
    if (!startedPlayback) {
      startedPlayback = true;
      void playConfiguredTrack();
    }
  });
  ipcMain.on('host:state', (_event, state: PlaybackState | null) => onHostState(state));
  ipcMain.on('host:error', (_event, kind: string, message: string) => {
    playerLog.error(`Player reported ${kind}: ${message}`, { code: `PLAYER_${kind.toUpperCase()}` });
    if (kind === 'stalled') {
      restartHost();
      return;
    }
    if (kind === 'playback_error' && playbackErrors.record()) {
      playerLog.error('Too many playback errors; stopping the playback host', { code: 'PLAYBACK_ERROR_BURST' });
      hostWindow?.destroy();
      startedPlayback = false;
      playbackErrors.reset();
      setStatus(
        'Playback failed repeatedly (Spotify refused the Widevine licence). Log in again to retry; details are in the log.',
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
  ipcMain.on('ui:export-diagnostics', () => void exportDiagnostics());
  ipcMain.on('ui:sign-out', () => signOut());
  ipcMain.on('ui:report-issue', () => {
    openIssue(
      buildIssueUrl({
        kind: 'bug',
        title: 'Problem report',
        summary: `Describe what happened here. (Status when reported: ${status})`,
        app: appInfo(),
        details: lastLines(appLogTexts(), 60),
      }),
    );
  });
  ipcMain.on('ui:crash-notice', (_event, action: 'report' | 'dismiss') => {
    if (!crashNotice) return;
    if (action === 'report') openIssue(buildIssueUrl(crashIssue(crashNotice, appInfo())));
    markCrashSeen(crashNotice);
    crashNotice = null;
    pushSnapshot();
  });
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
  app.on('render-process-gone', (_event, contents, details) => {
    const which = contents === hostWindow?.webContents ? 'host' : contents === uiWindow?.webContents ? 'ui' : 'renderer';
    logging.crashes.record('renderer-gone', which, { details: { reason: details.reason, exitCode: details.exitCode } });
    // A dead playback host means silence; rebuild it through the same capped path as a stall.
    if (which === 'host' && details.reason !== 'clean-exit') restartHost();
  });
  app.on('child-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    logging.crashes.record('child-process-gone', details.type, {
      details: { reason: details.reason, exitCode: details.exitCode, serviceName: details.serviceName ?? null },
    });
  });
  // Keep running in the tray when every window is closed.
  app.on('window-all-closed', () => undefined);
  Menu.setApplicationMenu(null);

  // castLabs Electron downloads/validates the Widevine CDM asynchronously; the SDK can't start before it is ready.
  const widevineLog = log.child('widevine');
  const cdmReady = components.whenReady().then(
    () => widevineLog.info('Widevine CDM ready', { context: { status: components.status() } }),
    (err: unknown) => widevineLog.error('Widevine CDM failed to load', { code: 'WIDEVINE_NOT_READY', error: err }),
  );
  await app.whenReady();
  // Only the refresh token is stored, encrypted with safeStorage (DPAPI); see token-store.ts and #51.
  tokens = new TokenStore(app.getPath('userData'), safeStorage, (message) => authLog.warn(message, { code: 'TOKEN_STORE' }));
  const settingsLog = log.child('settings');
  settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'), {
    report: (message) => settingsLog.warn(message, { code: 'SETTINGS' }),
  });
  log.info('Playlish starting', { context: { version: app.getVersion(), electron: process.versions.electron, level: log.level } });

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
    (message) => log.child('perf').warn(message, { code: 'PERF_LOG' }),
  );

  registerIpc();
  createTray();
  // Milestone read by the performance harness (tools/perf): time from process start to the tray icon.
  log.info('Tray ready', { code: 'STARTUP_TRAY', context: { msSinceStart: Math.round(performance.now()) } });

  serverPort = result.port;
  if (config) {
    const clientId = config.clientId;
    auth = new Auth(clientId, redirectUriFor(config.port), {
      onRefreshToken: (token) => tokens?.save(clientId, token),
      onSessionExpired: () => {
        tokens?.clear();
        authLog.warn('Spotify rejected the stored session; it was deleted', { code: 'SESSION_EXPIRED' });
      },
    });
  }
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
  // Offer to report the newest crash once, on the next start after it happened.
  const newestCrash = logging.crashes.list()[0];
  const report = newestCrash ? logging.crashes.read(newestCrash) : null;
  crashNotice = unseenCrash(report ? [report] : [], seenCrashIds());
  const saved = auth && config ? (tokens?.load(config.clientId) ?? null) : null;
  if (auth && saved) {
    auth.restore(saved);
    setStatus('Restoring your session…');
    createHostWindow();
  } else {
    setStatus(configError ? 'Configuration needed.' : 'Not logged in.');
  }
  if (!process.argv.includes(TRAY_ONLY_FLAG)) openUi();

  // Only the performance harness sets this; it repeatedly opens and closes the UI and feeds simulated playback state.
  if (process.env['PLAYLISH_SOAK'] === '1') {
    log.warn('Soak driver enabled (PLAYLISH_SOAK=1)', { code: 'SOAK_ENABLED' });
    const stopSoak = startSoakDriver({
      openUi,
      closeUi,
      simulateState: onHostState,
      progress: (cycles) => log.info(`Soak cycles completed: ${cycles}`, { code: 'SOAK_PROGRESS', context: { cycles } }),
    });
    app.on('before-quit', stopSoak);
  }
}

app.on('before-quit', () => {
  metrics?.stop();
  settings?.flush();
});
void main();
