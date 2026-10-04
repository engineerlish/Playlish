/*
 * Local smoke test: real login, real Widevine playback and real audio output, which CI can never check.
 * Run it on your own machine (not in CI, never with stored credentials):
 *
 *   npm run smoke                          uses your real Playlish profile
 *   npm run smoke -- --profile <folder>    uses another profile folder
 *   npm run smoke -- --non-interactive     never waits for you and never files issues (for automation)
 *
 * It launches the app with a DevTools port on 127.0.0.1 so it can press the app's buttons, measures the Windows
 * audio meter to tell sound from silence, writes a report to smoke-results/, and can file issues for failures after
 * showing you exactly what it would file. Node 24 runs this TypeScript file directly.
 */
import { execFileSync, execSync, spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import * as os from 'node:os';
import * as path from 'node:path';
import * as readline from 'node:readline/promises';
import { buildIssue, type FailureReport } from '../issues/format.ts';
import { fileFailure } from '../issues/github.ts';
import { click, setRange } from './cdp.ts';

type Status = 'pass' | 'fail' | 'skipped' | 'not-available';

interface StepResult {
  id: string;
  name: string;
  status: Status;
  details: string;
  area: FailureReport['area'];
  severity: FailureReport['severity'];
}

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
const REPO = 'engineerlish/Playlish';
// CHANGE HERE: local DevTools port used only while the smoke test runs.
const DEVTOOLS_PORT = 9339;
// CHANGE HERE: audio meter thresholds (peak level 0..1). Music sits far above SOUND; silence far below SILENCE.
const SOUND = 0.01;
const SILENCE = 0.003;

const argv = process.argv.slice(2);
const argValue = (name: string): string | null => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
};
const interactive = !argv.includes('--non-interactive');
const profile = argValue('profile') ?? path.join(process.env['APPDATA'] ?? os.homedir(), 'Playlish');
const logFile = path.join(profile, 'logs', 'playlish.log');
const steps: StepResult[] = [];
let app: ChildProcess | null = null;

/** Waits for the given number of milliseconds. */
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Records a step and prints it as it happens. */
function record(step: StepResult): StepResult {
  steps.push(step);
  const mark = { pass: 'PASS', fail: 'FAIL', skipped: 'SKIP', 'not-available': ' N/A' }[step.status];
  console.log(`[${mark}] ${step.name}${step.details ? ` - ${step.details}` : ''}`);
  return step;
}

/** Asks a yes/no question; in non-interactive mode the answer is always no. */
async function ask(question: string): Promise<boolean> {
  if (!interactive) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

/** Waits for the user to press Enter (interactive only). */
async function pause(message: string): Promise<void> {
  if (!interactive) return;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await rl.question(`${message} Press Enter to continue. `);
  rl.close();
}

/** Process ids of every running Electron process started from this project's binary. */
function appPids(): number[] {
  try {
    const out = execFileSync('powershell', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.ExecutablePath -eq '${EXE.replace(/'/g, "''")}' } | ForEach-Object { $_.ProcessId }`,
    ], { encoding: 'utf8' });
    return out.split(/\s+/).filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

/** Peak audio level of the app's audio sessions over a short window. */
function meter(ms = 2000): number {
  const pids = appPids();
  if (pids.length === 0) return 0;
  const out = execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(ROOT, 'tools', 'smoke', 'audio-meter.ps1'), '-ProcessIds', pids.join(','), '-Milliseconds', String(ms)], { encoding: 'utf8' });
  return (JSON.parse(out) as { peak: number }).peak;
}

/** Log lines written since the given byte offset. */
function logSince(offset: number): string[] {
  try {
    const buf = fs.readFileSync(logFile);
    return buf.subarray(Math.min(offset, buf.length)).toString('utf8').split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

/** Waits until a log line written after `offset` matches, returning it (or null on timeout). */
async function waitForLog(offset: number, pattern: RegExp, timeoutMs: number): Promise<string | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const hit = logSince(offset).find((l) => pattern.test(l));
    if (hit) return hit;
    await sleep(500);
  }
  return null;
}

/** Measures a few times and returns the highest peak (music has quiet moments). */
function bestOf(times: number, ms: number): number {
  let best = 0;
  for (let i = 0; i < times; i++) best = Math.max(best, meter(ms));
  return best;
}

/** Runs the checks that need no running app. Returns false if the rest cannot run. */
function preconditions(): boolean {
  if (!fs.existsSync(EXE)) {
    record({ id: 'binary', name: 'Electron binary present', status: 'fail', details: 'Run npm install first.', area: 'player', severity: 'high' });
    return false;
  }
  record({ id: 'binary', name: 'Electron binary present', status: 'pass', details: '', area: 'player', severity: 'high' });

  let vmp: StepResult = { id: 'vmp', name: 'Widevine VMP signature valid', status: 'skipped', details: 'castlabs-evs is not installed for Python 3.9', area: 'player', severity: 'high' };
  try {
    const out = execFileSync('py', ['-3.9', '-m', 'castlabs_evs.vmp', 'verify-pkg', path.join(ROOT, 'node_modules', 'electron', 'dist')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    vmp = out.includes('Signature is valid')
      ? { ...vmp, status: 'pass', details: (out.trim().split(/\r?\n/).pop() ?? '').replace(/^\s*-\s*/, '') }
      : { ...vmp, status: 'fail', details: out.trim() };
  } catch (err) {
    const e = err as { stderr?: Buffer | string; message?: string };
    const text = typeof e.stderr === 'string' ? e.stderr : e.stderr ? e.stderr.toString('utf8') : (e.message ?? '');
    if (/development only/i.test(text)) vmp = { ...vmp, status: 'fail', details: 'Development-only signature: sign with castlabs_evs.vmp sign-pkg (see README-SPIKE.md).' };
  }
  record(vmp);

  try {
    execSync('npm run build', { cwd: ROOT, stdio: 'ignore' });
    record({ id: 'build', name: 'App builds', status: 'pass', details: '', area: 'ui', severity: 'high' });
  } catch {
    record({ id: 'build', name: 'App builds', status: 'fail', details: 'npm run build failed', area: 'ui', severity: 'high' });
    return false;
  }

  const require = createRequire(import.meta.url);
  const { resolveClientId } = require(path.join(ROOT, 'dist', 'main', 'config.js')) as { resolveClientId: (env: string | undefined, saved: string | null) => string | null };
  let saved: string | null = null;
  try {
    saved = (JSON.parse(fs.readFileSync(path.join(profile, 'settings.json'), 'utf8')) as { clientId?: string | null }).clientId ?? null;
  } catch {
    // No settings yet.
  }
  const legacy = fs.existsSync(path.join(ROOT, 'spike.config.json'));
  const configured = resolveClientId(process.env['PLAYLISH_CLIENT_ID'], saved) !== null || legacy;
  record({
    id: 'config',
    name: 'Client ID configured',
    status: configured ? 'pass' : 'fail',
    details: configured ? (legacy ? 'spike.config.json found; the app imports it on start' : '') : 'Run Playlish once and finish the setup wizard first',
    area: 'auth',
    severity: 'high',
  });
  return configured;
}

/** Starts the app with the DevTools port and checks login, playback and audio. */
async function playbackChecks(): Promise<void> {
  while (appPids().length > 0) {
    if (!interactive) {
      record({ id: 'launch', name: 'Launch Playlish', status: 'skipped', details: 'Playlish is already running', area: 'ui', severity: 'medium' });
      return;
    }
    await pause('Playlish is already running. Quit it from the tray icon (right-click, Quit).');
  }

  const offset = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
  app = spawn(EXE, ['.', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEVTOOLS_PORT}`], { cwd: ROOT, stdio: 'ignore', env: SMOKE_ENV });

  const first = await waitForLog(offset, /Status: (Restoring your session|Not logged in|Configuration needed)/, 30_000);
  if (!first || /Configuration needed/.test(first)) {
    record({ id: 'launch', name: 'Launch Playlish', status: 'fail', details: first ? 'Configuration needed' : 'No status within 30 s', area: 'ui', severity: 'high' });
    return;
  }
  record({ id: 'launch', name: 'Launch Playlish', status: 'pass', details: '', area: 'ui', severity: 'high' });

  if (/Not logged in/.test(first)) {
    if (!interactive) {
      record({ id: 'login', name: 'Log in with Spotify', status: 'skipped', details: 'No saved session and not interactive', area: 'auth', severity: 'high' });
      return;
    }
    console.log('Click "Log in with Spotify" in the Playlish window and finish in your browser (3 minutes).');
  }
  const ready = await waitForLog(offset, /Status: Player ready\./, /Not logged in/.test(first) ? 180_000 : 60_000);
  record({ id: 'login', name: 'Logged in and player ready', status: ready ? 'pass' : 'fail', details: ready ? '' : 'The player did not become ready', area: 'auth', severity: 'high' });
  if (!ready) return;

  const playing = await waitForLog(offset, /Status: Playing\./, 60_000);
  await sleep(3000);
  const licence403 = logSince(offset).filter((l) => /widevine-license/.test(l) && /"status":403/.test(l)).length;
  record({
    id: 'playing',
    name: 'Playback starts',
    status: playing && licence403 === 0 ? 'pass' : 'fail',
    details: licence403 > 0 ? `Spotify refused the Widevine licence (${licence403} x HTTP 403)` : playing ? '' : 'No "Playing" status within 60 s',
    area: 'player',
    severity: 'high',
  });
  if (!playing) return;

  const peak = bestOf(3, 2000);
  const sound = record({ id: 'audio', name: 'Real audio is playing', status: peak > SOUND ? 'pass' : 'fail', details: `audio meter peak ${peak}`, area: 'audio', severity: 'high' });
  if (sound.status === 'fail') return;

  await click(DEVTOOLS_PORT, 'toggle');
  await sleep(1500);
  const paused = meter(1500);
  record({ id: 'pause', name: 'Pause gives silence', status: paused < SILENCE ? 'pass' : 'fail', details: `peak ${paused}`, area: 'player', severity: 'medium' });
  await click(DEVTOOLS_PORT, 'toggle');
  await sleep(2500);
  const resumed = bestOf(2, 2000);
  record({ id: 'resume', name: 'Resume brings audio back', status: resumed > SOUND ? 'pass' : 'fail', details: `peak ${resumed}`, area: 'player', severity: 'high' });

  await setRange(DEVTOOLS_PORT, 'volume', 15);
  await sleep(1500);
  const low = bestOf(2, 2000);
  await setRange(DEVTOOLS_PORT, 'volume', 100);
  await sleep(1500);
  const high = bestOf(2, 2000);
  await setRange(DEVTOOLS_PORT, 'volume', 50);
  record({ id: 'volume', name: 'Lower volume gives a lower level', status: high > SOUND && low < high * 0.6 ? 'pass' : 'fail', details: `peak at 15%: ${low}, at 100%: ${high}`, area: 'audio', severity: 'medium' });

  await click(DEVTOOLS_PORT, 'fade');
  await sleep(2000);
  const faded = meter(1500);
  await click(DEVTOOLS_PORT, 'fade');
  await sleep(2500);
  const back = bestOf(2, 2000);
  record({ id: 'fade', name: 'Fade pause and fade resume', status: faded < SILENCE && back > SOUND ? 'pass' : 'fail', details: `after fade-out ${faded}, after fade-in ${back}`, area: 'audio', severity: 'medium' });

  // The login must survive a restart (a bug once deleted the stored session on every start).
  stopApp();
  await sleep(2000);
  const restartOffset = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
  app = spawn(EXE, ['.', `--user-data-dir=${profile}`, `--remote-debugging-port=${DEVTOOLS_PORT}`], { cwd: ROOT, stdio: 'ignore', env: SMOKE_ENV });
  const afterRestart = await waitForLog(restartOffset, /Status: (Restoring your session|Not logged in|Welcome to Playlish)/, 30_000);
  record({
    id: 'restart',
    name: 'Login survives a restart',
    status: afterRestart && /Restoring your session/.test(afterRestart) ? 'pass' : 'fail',
    details: afterRestart ? (/Restoring/.test(afterRestart) ? '' : 'Playlish asked to log in again after a restart') : 'No status within 30 s after the restart',
    area: 'auth',
    severity: 'high',
  });
}

/** Steps for features that do not exist yet; they become real checks as the MVP lands. */
function notYetAvailable(): void {
  for (const [id, name, area] of [
    ['transfer', 'Transfer playback to and from another device', 'player'],
    ['media-keys', 'Media keys and Windows media overlay', 'player'],
    ['output-device', 'Output device switching', 'audio'],
    ['eq', 'Equalizer APO preset switching', 'audio'],
  ] as const) {
    record({ id, name, status: 'not-available', details: 'feature not built yet', area, severity: 'low' });
  }
}

// Playlish plays nothing on its own since #43; the smoke test needs sound without anyone picking music, so it asks for
// the built-in test track to start when the player is ready.
const SMOKE_ENV = { ...process.env, PLAYLISH_SMOKE_AUTOPLAY: '1' };

/** Stops the app this script started (and every process it spawned). */
function stopApp(): void {
  if (!app?.pid) return;
  try {
    execFileSync('taskkill', ['/pid', String(app.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    // Already gone.
  }
}

/** The short commit hash. */
function commit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/** Writes the JSON and Markdown report and returns the Markdown path. */
function writeReport(started: Date): string {
  const dir = path.join(ROOT, 'smoke-results');
  fs.mkdirSync(dir, { recursive: true });
  const stamp = started.toISOString().replace(/[:.]/g, '-');
  const summary = { date: started.toISOString(), commit: commit(), interactive, profile: profile.replace(os.homedir(), '~'), steps };
  fs.writeFileSync(path.join(dir, `smoke-${stamp}.json`), `${JSON.stringify(summary, null, 2)}\n`);
  const md = [
    `# Smoke test ${started.toISOString()} (commit ${summary.commit})`,
    '',
    '| Step | Result | Details |',
    '|---|---|---|',
    ...steps.map((s) => `| ${s.name} | ${s.status} | ${s.details.replace(/\|/g, '/')} |`),
    '',
  ].join('\n');
  const mdPath = path.join(dir, `smoke-${stamp}.md`);
  fs.writeFileSync(mdPath, md);
  return mdPath;
}

/** Offers to file issues for failed steps, showing each one first. */
async function offerIssues(started: Date): Promise<void> {
  const failed = steps.filter((s) => s.status === 'fail');
  if (failed.length === 0) return;
  const logTail = logSince(0).slice(-30);
  const reports: FailureReport[] = failed.map((s) => ({
    kind: 'smoke-failure',
    suite: 'smoke',
    name: s.name,
    error: s.details || 'failed',
    location: `step:${s.id}`,
    commit: commit(),
    branch: (() => {
      try {
        return execFileSync('git', ['branch', '--show-current'], { cwd: ROOT, encoding: 'utf8' }).trim();
      } catch {
        return 'unknown';
      }
    })(),
    environment: { OS: `${os.type()} ${os.release()}`, Node: process.version, Machine: os.cpus()[0]?.model.trim() ?? 'unknown' },
    steps: ['npm run smoke', `Step: ${s.name}`],
    logLines: logTail,
    area: s.area,
    severity: s.severity,
    seenAt: started.toISOString(),
  }));
  console.log(`\n${reports.length} step(s) failed. These issues would be filed on ${REPO} (or added to existing ones):`);
  for (const r of reports) {
    const draft = buildIssue(r);
    console.log(`\n  ${draft.title}\n  labels: ${draft.labels.join(', ')}\n  fingerprint: ${draft.fingerprint}`);
  }
  if (!(await ask(`\nFile them with your GitHub CLI login?`))) {
    console.log('Not filed.');
    return;
  }
  for (const r of reports) {
    const result = fileFailure(REPO, r, buildIssue(r));
    console.log(`  #${result.number}: ${result.action}`);
  }
}

const started = new Date();
console.log(`Playlish smoke test (${interactive ? 'interactive' : 'non-interactive'}), profile ${profile.replace(os.homedir(), '~')}\n`);
try {
  if (preconditions()) await playbackChecks();
} catch (err) {
  record({ id: 'harness', name: 'Smoke test ran to the end', status: 'fail', details: (err as Error).message, area: 'ui', severity: 'medium' });
} finally {
  notYetAvailable();
  if (!(await ask('\nLeave Playlish running?'))) stopApp();
}
const report = writeReport(started);
const failures = steps.filter((s) => s.status === 'fail').length;
console.log(`\n${steps.filter((s) => s.status === 'pass').length} passed, ${failures} failed, ${steps.filter((s) => s.status === 'skipped').length} skipped. Report: ${path.relative(ROOT, report)}`);
await offerIssues(started);
if (failures > 0) process.exitCode = 1;
