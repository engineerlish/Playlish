import type { PlaybackState, Snapshot, UiApi } from '../shared/types';

declare global {
  interface Window {
    ui: UiApi;
  }
}

// CHANGE HERE: how often the progress bar redraws while a track is playing (only runs while the UI window is open and playing).
const PROGRESS_TICK_MS = 500;

/** Looks up an element by id and fails loudly if the HTML and script disagree. */
function el<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing element #${id}`);
  return found as T;
}

const statusEl = el<HTMLDivElement>('status');
const configPanel = el<HTMLDivElement>('configPanel');
const loginBtn = el<HTMLButtonElement>('login');
const playBtn = el<HTMLButtonElement>('play');
const trackEl = el<HTMLDivElement>('track');
const artistsEl = el<HTMLDivElement>('artists');
const progressEl = el<HTMLProgressElement>('progress');
const prevBtn = el<HTMLButtonElement>('prev');
const toggleBtn = el<HTMLButtonElement>('toggle');
const fadeBtn = el<HTMLButtonElement>('fade');
const nextBtn = el<HTMLButtonElement>('next');
const volumeEl = el<HTMLInputElement>('volume');
const metricsEl = el<HTMLDivElement>('metrics');
const logPathEl = el<HTMLElement>('logPath');
const crashPanel = el<HTMLDivElement>('crashPanel');
const crashText = el<HTMLDivElement>('crashText');

let current: PlaybackState | null = null;
let tickTimer: number | null = null;

/** Draws the progress bar from the last sampled position, interpolating while playing. */
function drawProgress(): void {
  if (!current || current.durationMs === 0) {
    progressEl.value = 0;
    return;
  }
  const elapsed = current.paused ? 0 : Date.now() - current.sampledAt;
  progressEl.value = Math.min(1, (current.positionMs + elapsed) / current.durationMs);
}

/** Starts or stops the progress timer so nothing runs while paused. */
function syncTick(): void {
  const shouldRun = current !== null && !current.paused;
  if (shouldRun && tickTimer === null) tickTimer = window.setInterval(drawProgress, PROGRESS_TICK_MS);
  if (!shouldRun && tickTimer !== null) {
    window.clearInterval(tickTimer);
    tickTimer = null;
  }
}

/** Re-renders the whole window from a snapshot. */
function render(s: Snapshot): void {
  current = s.playback;
  statusEl.textContent = s.status;
  logPathEl.textContent = s.perfLogPath;

  configPanel.hidden = s.configError === null;
  configPanel.textContent = s.configError ?? '';
  loginBtn.disabled = s.configError !== null;
  loginBtn.textContent = s.loggedIn ? 'Log in again' : 'Log in with Spotify';
  el<HTMLButtonElement>('signOut').hidden = !s.loggedIn;

  for (const btn of [playBtn, prevBtn, toggleBtn, fadeBtn, nextBtn]) btn.disabled = !s.deviceReady;
  volumeEl.disabled = !s.deviceReady;

  trackEl.textContent = s.playback?.track ?? 'Nothing playing';
  artistsEl.textContent = s.playback?.artists ?? ' ';
  if (s.playback && document.activeElement !== volumeEl) volumeEl.value = String(Math.round(s.playback.volume * 100));

  const m = s.metrics;
  metricsEl.textContent = m
    ? `${m.processes} processes · working set ${m.workingSetMb} MB · private ${m.privateMb} MB · CPU ${m.cpuPercent}%`
    : 'Waiting for first sample…';

  crashPanel.hidden = s.crashNotice === null;
  crashText.textContent = s.crashNotice
    ? `Playlish recovered from a crash (${s.crashNotice.kind} in ${s.crashNotice.process}) at ${new Date(s.crashNotice.when).toLocaleString()}. Would you like to report it? You can review everything before it is sent.`
    : '';

  drawProgress();
  syncTick();
}

loginBtn.addEventListener('click', () => window.ui.login());
playBtn.addEventListener('click', () => window.ui.command({ type: 'playTrack' }));
prevBtn.addEventListener('click', () => window.ui.command({ type: 'previous' }));
toggleBtn.addEventListener('click', () => window.ui.command({ type: 'toggle' }));
fadeBtn.addEventListener('click', () => window.ui.command({ type: 'fadeToggle' }));
nextBtn.addEventListener('click', () => window.ui.command({ type: 'next' }));
el<HTMLButtonElement>('signOut').addEventListener('click', () => window.ui.signOut());
el<HTMLButtonElement>('reportIssue').addEventListener('click', () => window.ui.reportIssue());
el<HTMLButtonElement>('exportDiagnostics').addEventListener('click', () => window.ui.exportDiagnostics());
el<HTMLButtonElement>('crashReport').addEventListener('click', () => window.ui.answerCrashNotice('report'));
el<HTMLButtonElement>('crashDismiss').addEventListener('click', () => window.ui.answerCrashNotice('dismiss'));
volumeEl.addEventListener('input', () => window.ui.command({ type: 'volume', value: Number(volumeEl.value) / 100 }));

/** Sends uncaught errors and unhandled promise rejections in this page to the main process log. */
function forwardPageErrors(report: (message: string, stack?: string) => void): void {
  window.addEventListener('error', (event) => {
    const error = event.error as unknown;
    report(event.message || String(error), error instanceof Error ? error.stack : undefined);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason as unknown;
    report(`Unhandled promise rejection: ${reason instanceof Error ? reason.message : String(reason)}`, reason instanceof Error ? reason.stack : undefined);
  });
}

forwardPageErrors((message, stack) => window.ui.reportError(message, stack));
window.ui.onSnapshot(render);
window.ui.requestSnapshot();
