/*
 * Builds the performance report for CI: every scenario's budget checks, and when a baseline from main is available,
 * the change against it. Node 24 runs this TypeScript file directly.
 *
 *   node tools/perf/compare.ts --current <dir> [--baseline <dir>] [--enforce]
 *
 * Reads perf-*.json files written by run.ts. --enforce exits non-zero when any budget check fails, except in results
 * marked advisory (run.ts --advisory), which are reported only.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Check } from './analysis.ts';

const MARKER = '<!-- playlish-perf-summary -->';

interface ResultFile {
  scenario: string;
  /** Run with the example plugins on (older results have no such field). */
  plugins?: boolean;
  /** Reported, never enforced. */
  advisory?: boolean;
  commit: string;
  checks: Check[];
  pass: boolean;
}

/** The name a result is shown and compared under: the scenario, and whether plugins were on. */
function keyOf(result: ResultFile): string {
  return result.plugins ? `${result.scenario} with plugins` : result.scenario;
}

/** Reads every perf-*.json in a folder, keyed by scenario (and plugins). Missing folders give an empty map. */
function readResults(dir: string | null): Map<string, ResultFile> {
  const results = new Map<string, ResultFile>();
  if (!dir || !fs.existsSync(dir)) return results;
  for (const name of fs.readdirSync(dir)) {
    if (!/^perf-.*\.json$/.test(name)) continue;
    try {
      const result = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as ResultFile;
      results.set(keyOf(result), result);
    } catch {
      // Ignore unreadable files.
    }
  }
  return results;
}

/** Formats the change against the baseline, for example "+2.1 (+3%)". */
function delta(current: number, baseline: number | undefined): string {
  if (baseline === undefined) return 'n/a';
  const diff = Math.round((current - baseline) * 10) / 10;
  const pct = baseline === 0 ? '' : ` (${diff >= 0 ? '+' : ''}${Math.round((diff / baseline) * 100)}%)`;
  return `${diff >= 0 ? '+' : ''}${diff}${pct}`;
}

const argv = process.argv.slice(2);
const arg = (name: string): string | null => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? null) : null;
};
const current = readResults(arg('current') ?? '.');
const baseline = readResults(arg('baseline'));

const lines = [MARKER, '### Playlish performance', ''];
if (current.size === 0) {
  lines.push('No performance results were produced.');
} else {
  if (baseline.size === 0) lines.push('_No baseline from main yet; showing budgets only._', '');
  for (const [scenario, result] of current) {
    const base = baseline.get(scenario);
    lines.push(`**${scenario}**${result.advisory ? ' (report only)' : ''} (commit ${result.commit}${base ? `, compared with main ${base.commit}` : ''})`, '');
    lines.push('| Check | Measured | Budget | Main | Change | Result |', '|---|---|---|---|---|---|');
    for (const c of result.checks) {
      const b = base?.checks.find((x) => x.name === c.name);
      lines.push(`| ${c.name} | ${c.value} ${c.unit} | ${c.limit} ${c.unit} | ${b ? `${b.value} ${b.unit}` : 'n/a'} | ${delta(c.value, b?.value)} | ${c.pass ? 'pass' : '**over budget**'} |`);
    }
    lines.push('');
  }
  lines.push('_Measured on a GitHub-hosted Windows runner; numbers differ from desktop machines. Budgets are report-only in CI until a baseline is established._');
}
process.stdout.write(`${lines.join('\n')}\n`);

if (argv.includes('--enforce') && [...current.values()].some((r) => !r.pass && !r.advisory)) process.exitCode = 1;
