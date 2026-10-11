/*
 * Performance harness: launches the real app on a throwaway profile, measures it, and checks the budgets in
 * perf/budgets.json. Node 24 runs this TypeScript file directly.
 *
 *   node tools/perf/run.ts --scenario idle            tray only, nothing playing
 *   node tools/perf/run.ts --scenario ui              UI window open, nothing playing
 *   node tools/perf/run.ts --scenario soak --minutes 60 --warmup 0.5
 *
 * Options: --settle <s> (default 20), --measure <s> (default 60), --out <file.json>, --no-fail (report only),
 * --plugins (installs the example plugins first; memory budgets then include the plugin process), --advisory (the
 * result is reported but never fails CI),
 * --warmup <fraction> (soak only: the share of the run left out of the growth trend, default 0.2).
 * Windows only (the budgets are about the Windows process tree). Needs `npm run build` and the Electron binary.
 */
import { execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { pack } from '../plugins/pack.ts';
import {
  check,
  checksToMarkdown,
  findMilestone,
  memoryTrend,
  parsePerfCsv,
  samplesSince,
  summarize,
  type Budgets,
  type Check,
  type PerfSample,
  type Summary,
  type Trend,
} from './analysis.ts';

type Scenario = 'idle' | 'ui' | 'soak';

interface Options {
  scenario: Scenario;
  settleSec: number;
  measureSec: number;
  soakMinutes: number;
  /** Share of the soak's samples left out of the growth trend while native caches fill up. */
  warmupFraction: number;
  /** Run with the example plugins installed and on (#104). */
  plugins: boolean;
  /** Report only: compare.ts never fails CI on this result. */
  advisory: boolean;
  out: string | null;
  fail: boolean;
}

export interface PerfResult {
  scenario: Scenario;
  /** Run with the example plugins on (--plugins). */
  plugins: boolean;
  /** Reported, never enforced (--advisory). */
  advisory: boolean;
  date: string;
  commit: string;
  machine: { cpu: string; cores: number; memoryGb: number; os: string };
  electron: string;
  startup: { trayMs: number | null; uiMs: number | null; wallClockMs: number | null };
  summary: Summary | null;
  trend: Trend | null;
  /** Which samples the trend used. */
  trendScope: string | null;
  /** Raw samples of the measured window, kept so a failure can be investigated afterwards. */
  samples: PerfSample[];
  checks: Check[];
  pass: boolean;
}

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');
// CHANGE HERE: how long to wait for the app to report it has started.
const STARTUP_TIMEOUT_MS = 60_000;
// CHANGE HERE: the app samples every 5 seconds; wait a little longer than that so the last sample lands.
const SAMPLE_GRACE_MS = 6_000;

/** Waits for the given number of milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls a condition until it is true or the timeout passes. */
async function waitFor(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (condition()) return true;
    await sleep(250);
  }
  return condition();
}

/** Reads a text file, or returns an empty string if it does not exist yet. */
function readText(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** Parses the command line. */
function parseArgs(argv: string[]): Options {
  const value = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const scenario = (value('scenario') ?? 'idle') as Scenario;
  if (!['idle', 'ui', 'soak'].includes(scenario)) throw new Error(`Unknown scenario "${scenario}" (use idle, ui or soak)`);
  const warmup = Number(value('warmup') ?? 0.2);
  if (!(warmup >= 0 && warmup < 1)) throw new Error('--warmup must be a fraction from 0 up to (not including) 1');
  return {
    scenario,
    settleSec: Number(value('settle') ?? 20),
    measureSec: Number(value('measure') ?? 60),
    soakMinutes: Number(value('minutes') ?? 30),
    warmupFraction: warmup,
    plugins: argv.includes('--plugins'),
    advisory: argv.includes('--advisory'),
    out: value('out') ?? null,
    fail: !argv.includes('--no-fail'),
  };
}

/** The short commit hash, or "unknown" outside a git checkout. */
function gitCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim();
  } catch {
    return 'unknown';
  }
}

/** The installed Electron version. */
function electronVersion(): string {
  try {
    return (JSON.parse(readText(path.join(ROOT, 'node_modules', 'electron', 'package.json'))) as { version: string }).version;
  } catch {
    return 'unknown';
  }
}

/** Stops the app and every process it started. */
function stopApp(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    // Already gone.
  }
}

// CHANGE HERE: the plugins --plugins installs (folders in examples/).
const EXAMPLE_PLUGINS = ['listening-stats', 'smart-shuffle', 'eq-by-playlist'];

/** Installs the example plugins into a profile, through the built app's own package checks and store. */
function installExamplePlugins(profile: string): void {
  const require = createRequire(import.meta.url);
  const { PluginStore, inspectPackage } = require(path.join(ROOT, 'dist', 'main', 'plugins', 'store.js')) as {
    PluginStore: new (userData: string) => { install(pkg: unknown): unknown };
    inspectPackage: (buf: Buffer) => unknown;
  };
  const store = new PluginStore(profile);
  for (const name of EXAMPLE_PLUGINS) store.install(inspectPackage(pack(path.join(ROOT, 'examples', name))));
}

/** How many installed plugins are still on (Playlish turns off one that breaks its limits). */
function pluginsStillOn(profile: string): number {
  try {
    const index = JSON.parse(readText(path.join(profile, 'plugins', 'installed.json'))) as { plugins: { enabled: boolean }[] };
    return index.plugins.filter((p) => p.enabled).length;
  } catch {
    return 0;
  }
}

/** Runs one scenario and returns its result. */
async function run(options: Options, budgets: Budgets): Promise<PerfResult> {
  if (!fs.existsSync(EXE)) throw new Error('Electron binary missing: run npm ci (with install scripts) first.');
  if (!fs.existsSync(path.join(ROOT, 'dist', 'main', 'main.js'))) throw new Error('App not built: run npm run build first.');

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'playlish-perf-'));
  if (options.plugins) installExamplePlugins(profile);
  const logFile = path.join(profile, 'logs', 'playlish.log');
  const csvFile = path.join(profile, 'perf.csv');
  const args = ['.', `--user-data-dir=${profile}`, ...(options.scenario === 'ui' ? [] : ['--tray'])];
  const env: NodeJS.ProcessEnv = { ...process.env };
  delete env['PLAYLISH_DEBUG'];
  delete env['PLAYLISH_SOAK'];
  if (options.scenario === 'soak') env['PLAYLISH_SOAK'] = '1';

  const milestone = options.scenario === 'ui' ? 'STARTUP_UI' : 'STARTUP_TRAY';
  const spawnedAt = Date.now();
  const child = spawn(EXE, args, { cwd: ROOT, env, stdio: 'ignore' });
  try {
    const started = await waitFor(() => findMilestone(readText(logFile), milestone) !== null, STARTUP_TIMEOUT_MS);
    if (!started) throw new Error(`The app did not report ${milestone} within ${STARTUP_TIMEOUT_MS / 1000} seconds.`);
    const wallClockMs = Date.now() - spawnedAt;

    let measureFrom: number;
    if (options.scenario === 'soak') {
      measureFrom = Date.now();
      const end = measureFrom + options.soakMinutes * 60_000;
      while (Date.now() < end) {
        if (child.exitCode !== null) throw new Error('The app exited during the soak run.');
        await sleep(Math.min(30_000, end - Date.now()));
      }
    } else {
      await sleep(options.settleSec * 1000);
      measureFrom = Date.now();
      await sleep(options.measureSec * 1000);
    }
    await sleep(SAMPLE_GRACE_MS);

    const logText = readText(logFile);
    const samples = samplesSince(parsePerfCsv(readText(csvFile)), measureFrom);
    const summary = summarize(samples);
    // During a soak the UI window opens and closes every few seconds and holds ~35 MB while open. Mixing both states
    // makes the trend depend on where samples happen to land, so compare like with like: UI-closed (tray) samples.
    const trayOnly = samples.filter((s) => s.uiOpen === false);
    const trend = options.scenario === 'soak' ? memoryTrend(trayOnly.length >= 10 ? trayOnly : samples, options.warmupFraction) : null;
    const trendScope = options.scenario === 'soak' ? (trayOnly.length >= 10 ? 'UI-closed samples' : 'all samples') : null;
    const startup = { trayMs: findMilestone(logText, 'STARTUP_TRAY'), uiMs: findMilestone(logText, 'STARTUP_UI'), wallClockMs };

    const checks: Check[] = [];
    // With plugins, memory budgets include the plugin process.
    const extra = options.plugins ? budgets.pluginHostPrivateMb : 0;
    const withPlugins = options.plugins ? ' with plugins' : '';
    if (summary && options.scenario === 'idle') {
      checks.push(check(`Idle tray RAM${withPlugins} (private, avg)`, summary.privateMbAvg, budgets.idleTrayPrivateMb + extra, 'MB'));
      checks.push(check('Idle CPU (avg)', summary.cpuPercentAvg, budgets.idleCpuPercent, '%'));
      if (startup.trayMs !== null) checks.push(check('Cold start to tray', startup.trayMs, budgets.coldStartTrayMs, 'ms'));
    }
    if (summary && options.scenario === 'ui') {
      checks.push(check(`UI open RAM${withPlugins} (private, avg)`, summary.privateMbAvg, budgets.uiOpenPrivateMb + extra, 'MB'));
      checks.push(check('UI open idle CPU (avg)', summary.cpuPercentAvg, budgets.idleCpuPercent, '%'));
      if (startup.uiMs !== null) checks.push(check('Cold start to usable UI', startup.uiMs, budgets.coldStartUiMs, 'ms'));
    }
    if (trend) checks.push(check('Soak memory growth after warm-up', trend.growthPercent, budgets.soakMaxGrowthPercent, '%'));
    // The soak opens and closes the window all the time, so its window-closed samples are "the tray after use" (#34).
    if (options.scenario === 'soak' && trayOnly.length >= 10) {
      const avg = trayOnly.reduce((sum, s) => sum + s.privateMb, 0) / trayOnly.length;
      checks.push(check(`Tray RAM after the window was used${withPlugins} (private, avg)`, Math.round(avg * 10) / 10, budgets.trayAfterUiPrivateMb + extra, 'MB'));
    }
    if (options.plugins) {
      const on = pluginsStillOn(profile);
      checks.push({ name: 'Plugins still on at the end', value: on, limit: EXAMPLE_PLUGINS.length, unit: '', pass: on === EXAMPLE_PLUGINS.length });
    }
    if (!summary) checks.push({ name: 'Samples collected', value: 0, limit: 1, unit: '', pass: false });
    if (options.scenario === 'soak' && !trend) checks.push({ name: 'Enough soak samples for a trend', value: samples.length, limit: 10, unit: '', pass: false });

    const cpus = os.cpus();
    return {
      scenario: options.scenario,
      plugins: options.plugins,
      advisory: options.advisory,
      date: new Date().toISOString(),
      commit: gitCommit(),
      machine: { cpu: cpus[0]?.model.trim() ?? 'unknown', cores: cpus.length, memoryGb: Math.round(os.totalmem() / 2 ** 30), os: `${os.type()} ${os.release()}` },
      electron: electronVersion(),
      startup,
      summary,
      trend,
      trendScope,
      samples,
      checks,
      pass: checks.every((c) => c.pass),
    };
  } finally {
    stopApp(child.pid);
    await sleep(1500);
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
}

/** Formats a result for people. */
function toMarkdown(result: PerfResult): string {
  const s = result.summary;
  const lines = [
    checksToMarkdown(`Performance: ${result.scenario}${result.plugins ? ' with plugins' : ''} (commit ${result.commit})`, result.checks),
    s ? `Samples: ${s.samples} · private avg ${s.privateMbAvg} MB, max ${s.privateMbMax} MB · CPU avg ${s.cpuPercentAvg}%, max ${s.cpuPercentMax}% · up to ${s.processesMax} processes` : 'No samples.',
    `Startup: tray ${result.startup.trayMs ?? 'n/a'} ms, UI ${result.startup.uiMs ?? 'n/a'} ms (wall clock to milestone ${result.startup.wallClockMs ?? 'n/a'} ms)`,
    ...(result.trend
      ? [`Trend over ${result.trend.samplesUsed} ${result.trendScope ?? 'samples'}: ${result.trend.startMb} MB to ${result.trend.endMb} MB (${result.trend.growthPercent}%), slope ${result.trend.slopeMbPerHour} MB/h`]
      : []),
    `Machine: ${result.machine.cpu}, ${result.machine.cores} cores, ${result.machine.memoryGb} GB, ${result.machine.os}; Electron ${result.electron}`,
    '',
  ];
  return lines.join('\n');
}

const options = parseArgs(process.argv.slice(2));
const budgets = JSON.parse(readText(path.join(ROOT, 'perf', 'budgets.json'))) as Budgets;
const result = await run(options, budgets);
process.stdout.write(toMarkdown(result));
if (options.out) fs.writeFileSync(options.out, `${JSON.stringify(result, null, 2)}\n`);
if (!result.pass && options.fail && !options.advisory) process.exitCode = 1;
