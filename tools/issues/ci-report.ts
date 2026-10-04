/*
 * Files or updates GitHub issues for test failures on main and in nightly runs (#14). Pull requests are not filed:
 * their failures are in the pull request's own summary comment.
 *
 *   node tools/issues/ci-report.ts --vitest test-results.json --playwright e2e-results/results.json [--dry-run]
 *
 * Reads Vitest's and Playwright's JSON results. Each failed test becomes a "[test-failure]" issue and each test that
 * only passed on the retry a "[flaky-test]" issue; the same failure again comments on its issue (and reopens it with
 * the regression label if it was closed). Uses the GitHub CLI with the workflow's built-in GITHUB_TOKEN. Everything is
 * redacted by the shared issue format before it is posted.
 */
import * as fs from 'node:fs';
import { buildIssue, type FailureReport } from './format.ts';
import { fileFailure } from './github.ts';

// CHANGE HERE: most issues one run may file or update, so a broken build does not flood the tracker.
export const MAX_ISSUES_PER_RUN = 10;

export interface RunContext {
  commit: string;
  branch: string;
  runLink?: string;
  environment: Record<string, string>;
  seenAt: string;
}

type Area = FailureReport['area'];

// CHANGE HERE: which area a test file belongs to (first match wins), for the area label.
const AREAS: [RegExp, Area][] = [
  [/auth|token|first-run|setup|session/i, 'auth'],
  [/library|search|queue/i, 'library'],
  [/spotify-client|request-queue|spotify-errors|fake-spotify/i, 'api-client'],
  [/plugin|safe-mode/i, 'plugins'],
  [/fade|volume|audio|media-session/i, 'audio'],
  [/now-playing|devices|controls|recovery|stall|player|error-burst/i, 'player'],
];

/** The area label for a test file. */
export function areaFor(file: string): Area {
  return AREAS.find(([pattern]) => pattern.test(file))?.[1] ?? 'ui';
}

/** The first line of an error message, without ANSI colour codes. */
function firstLine(text: string): string {
  // eslint-disable-next-line no-control-regex
  return (text.replace(/\u001b\[[0-9;]*m/g, '').split('\n').find((l) => l.trim() !== '') ?? 'Error').trim().slice(0, 300);
}

/** Path relative to the repository, with forward slashes. */
function relative(file: string): string {
  const normal = file.replace(/\\/g, '/');
  const at = normal.lastIndexOf('/tests/');
  return at >= 0 ? normal.slice(at + 1) : normal;
}

interface VitestJson {
  testResults?: { name: string; assertionResults?: { fullName: string; status: string; failureMessages?: string[] }[] }[];
}

/** Failed and flaky tests from Vitest's JSON reporter. */
export function vitestFailures(json: VitestJson, ctx: RunContext): FailureReport[] {
  const out: FailureReport[] = [];
  for (const file of json.testResults ?? []) {
    const where = relative(file.name);
    for (const test of file.assertionResults ?? []) {
      const messages = test.failureMessages ?? [];
      const failed = test.status === 'failed';
      const flaky = test.status === 'passed' && messages.length > 0;
      if (!failed && !flaky) continue;
      out.push({
        kind: 'test-failure',
        suite: 'unit',
        name: test.fullName,
        error: firstLine(messages[0] ?? 'failed'),
        details: messages.join('\n\n').slice(0, 4000),
        location: where,
        commit: ctx.commit,
        branch: ctx.branch,
        ...(ctx.runLink ? { runLink: ctx.runLink } : {}),
        environment: ctx.environment,
        area: areaFor(where),
        severity: flaky ? 'low' : 'high',
        seenAt: ctx.seenAt,
        flaky,
        steps: ['npm ci', `npx vitest run ${where}`],
      });
    }
  }
  return out;
}

interface PlaywrightSpec {
  title: string;
  file: string;
  line?: number;
  tests: { status: string; results: { status: string; error?: { message?: string; stack?: string } }[] }[];
}
interface PlaywrightSuite {
  title: string;
  specs?: PlaywrightSpec[];
  suites?: PlaywrightSuite[];
}

/** Failed and flaky tests from Playwright's JSON reporter. */
export function playwrightFailures(json: { suites?: PlaywrightSuite[] }, ctx: RunContext): FailureReport[] {
  const out: FailureReport[] = [];
  const walk = (suite: PlaywrightSuite, path: string[]) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        if (test.status !== 'unexpected' && test.status !== 'flaky') continue;
        const error = test.results.find((r) => r.error)?.error;
        const where = `tests/e2e/${spec.file.replace(/\\/g, '/').split('/').pop() ?? spec.file}`;
        out.push({
          kind: 'test-failure',
          suite: 'e2e',
          name: [...path, spec.title].join(' › '),
          error: firstLine(error?.message ?? 'failed'),
          details: (error?.stack ?? error?.message ?? '').slice(0, 4000),
          location: `${where}${spec.line ? `:${spec.line}` : ''}`,
          commit: ctx.commit,
          branch: ctx.branch,
          ...(ctx.runLink ? { runLink: ctx.runLink } : {}),
          environment: ctx.environment,
          area: areaFor(where),
          severity: test.status === 'flaky' ? 'low' : 'high',
          seenAt: ctx.seenAt,
          flaky: test.status === 'flaky',
          steps: ['npm ci', 'npm run build', `npx playwright test ${where}`, 'Screenshots, logs and traces are in the run artifacts (e2e-failures)'],
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child, child.title && !child.title.endsWith('.ts') ? [...path, child.title] : path);
  };
  for (const suite of json.suites ?? []) walk(suite, []);
  return out;
}

/** Reads a JSON file, or null when it is missing or broken (an earlier step may have failed). */
function readJson<T>(file: string | undefined): T | null {
  if (!file || !fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return null;
  }
}

/** The value after a command-line flag. */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Runs when started as a script (not when imported by tests). */
function main(): void {
  const env = process.env;
  const repo = env['GITHUB_REPOSITORY'];
  const dryRun = process.argv.includes('--dry-run');
  if (!repo && !dryRun) throw new Error('GITHUB_REPOSITORY is not set; use --dry-run outside GitHub Actions.');
  const ctx: RunContext = {
    commit: (env['GITHUB_SHA'] ?? 'local').slice(0, 7),
    branch: env['GITHUB_REF_NAME'] ?? 'local',
    ...(repo && env['GITHUB_RUN_ID'] ? { runLink: `${env['GITHUB_SERVER_URL'] ?? 'https://github.com'}/${repo}/actions/runs/${env['GITHUB_RUN_ID']}` } : {}),
    environment: { Runner: `${env['RUNNER_OS'] ?? process.platform} (${env['RUNNER_ARCH'] ?? process.arch})`, Node: process.version, Workflow: env['GITHUB_WORKFLOW'] ?? 'local' },
    seenAt: new Date().toISOString(),
  };
  const reports = [
    ...vitestFailures(readJson<VitestJson>(arg('vitest')) ?? {}, ctx),
    ...playwrightFailures(readJson<{ suites?: PlaywrightSuite[] }>(arg('playwright')) ?? {}, ctx),
  ];
  if (reports.length === 0) {
    console.log('No failed or flaky tests.');
    return;
  }
  if (reports.length > MAX_ISSUES_PER_RUN) console.log(`${reports.length} failures; filing the first ${MAX_ISSUES_PER_RUN}. See the run for the rest.`);
  for (const report of reports.slice(0, MAX_ISSUES_PER_RUN)) {
    const draft = buildIssue(report);
    if (dryRun) {
      console.log(`--- ${draft.title} [${draft.labels.join(', ')}]\n${draft.body}\n`);
      continue;
    }
    const filed = fileFailure(repo ?? '', report, draft);
    console.log(`${filed.action} #${filed.number}: ${draft.title}`);
  }
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('tools/issues/ci-report.ts')) main();
