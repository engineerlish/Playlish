/*
 * Performance history (#10): the measurements of recent runs side by side, so a slow regression shows up. CI keeps
 * every run's results as artifacts (perf-results from CI on main, soak results from the nightly run), so nothing has to
 * be committed to the repository by a bot. Needs the GitHub CLI, logged in.
 *
 *   node tools/perf/history.ts                 the last 10 runs of each kind
 *   node tools/perf/history.ts --runs 30
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { Check } from './analysis.ts';

// CHANGE HERE: the workflows and artifacts to read, and the checks to show for each scenario.
const SOURCES = [
  { workflow: 'ci.yml', branch: 'main', artifact: 'perf-results' },
  { workflow: 'nightly.yml', branch: 'main', artifact: 'soak-results' },
  { workflow: 'nightly.yml', branch: 'main', artifact: 'soak-plugins-results' },
];

interface RunInfo {
  databaseId: number;
  createdAt: string;
  headSha: string;
}

interface ResultFile {
  scenario: string;
  plugins?: boolean;
  checks: Check[];
}

function gh(args: string[]): string {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
}

/** Recent successful-or-failed (not cancelled) runs of a workflow on a branch. */
function runs(workflow: string, branch: string, limit: number): RunInfo[] {
  const json = gh(['run', 'list', '--workflow', workflow, '--branch', branch, '--limit', String(limit * 2), '--json', 'databaseId,createdAt,headSha,conclusion']);
  return (JSON.parse(json) as (RunInfo & { conclusion: string })[]).filter((r) => r.conclusion === 'success' || r.conclusion === 'failure').slice(0, limit);
}

/** The perf-*.json files of one run's artifact (empty when it has none, for example an expired artifact). */
function results(runId: number, artifact: string, scratch: string): ResultFile[] {
  const dir = path.join(scratch, `${runId}-${artifact}`);
  try {
    gh(['run', 'download', String(runId), '--name', artifact, '--dir', dir]);
  } catch {
    return [];
  }
  return fs
    .readdirSync(dir)
    .filter((f) => /^perf-.*\.json$/.test(f))
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as ResultFile);
}

function main(argv: string[]): void {
  const i = argv.indexOf('--runs');
  const limit = i >= 0 ? Number(argv[i + 1] ?? 10) : 10;
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'playlish-perf-history-'));
  // Scenario name to rows of [date, commit, checks].
  const table = new Map<string, { date: string; commit: string; checks: Check[] }[]>();
  try {
    for (const source of SOURCES) {
      for (const run of runs(source.workflow, source.branch, limit)) {
        for (const result of results(run.databaseId, source.artifact, scratch)) {
          const key = result.plugins ? `${result.scenario} with plugins` : result.scenario;
          const rows = table.get(key) ?? [];
          rows.push({ date: run.createdAt.slice(0, 10), commit: run.headSha.slice(0, 7), checks: result.checks });
          table.set(key, rows);
        }
      }
    }
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }

  if (table.size === 0) {
    console.log('No performance results found (artifacts expire after 30 to 90 days).');
    return;
  }
  for (const [scenario, rows] of table) {
    rows.sort((a, b) => a.date.localeCompare(b.date));
    const names = [...new Set(rows.flatMap((r) => r.checks.map((c) => c.name)))];
    console.log(`\n### ${scenario}\n`);
    console.log(`| Date | Commit | ${names.join(' | ')} |`);
    console.log(`|---|---|${names.map(() => '---').join('|')}|`);
    for (const row of rows) {
      const cells = names.map((n) => {
        const c = row.checks.find((x) => x.name === n);
        return c ? `${c.value} ${c.unit}${c.pass ? '' : ' (over)'}`.trim() : '';
      });
      console.log(`| ${row.date} | ${row.commit} | ${cells.join(' | ')} |`);
    }
  }
}

main(process.argv.slice(2));
