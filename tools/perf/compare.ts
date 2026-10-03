/*
 * Builds the performance report for CI: every scenario's budget checks, and when a baseline from main is available,
 * the change against it. Node 24 runs this TypeScript file directly.
 *
 *   node tools/perf/compare.ts --current <dir> [--baseline <dir>] [--enforce]
 *
 * Reads perf-*.json files written by run.ts. --enforce exits non-zero when any budget check fails.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Check } from './analysis.ts';

const MARKER = '<!-- playlish-perf-summary -->';

interface ResultFile {
  scenario: string;
  commit: string;
  checks: Check[];
  pass: boolean;
}

/** Reads every perf-*.json in a folder, keyed by scenario. Missing folders give an empty map. */
function readResults(dir: string | null): Map<string, ResultFile> {
  const results = new Map<string, ResultFile>();
  if (!dir || !fs.existsSync(dir)) return results;
  for (const name of fs.readdirSync(dir)) {
    if (!/^perf-.*\.json$/.test(name)) continue;
    try {
      const result = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as ResultFile;
      results.set(result.scenario, result);
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
    lines.push(`**${scenario}** (commit ${result.commit}${base ? `, compared with main ${base.commit}` : ''})`, '');
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

if (argv.includes('--enforce') && [...current.values()].some((r) => !r.pass)) process.exitCode = 1;
