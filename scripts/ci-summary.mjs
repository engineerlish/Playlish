// Builds the Markdown summary shown on pull requests and in the job summary.
// Reads test-results.json (Vitest JSON reporter), coverage/coverage-summary.json (v8 coverage) and, on pull requests,
// coverage-baseline/coverage/coverage-summary.json (main's latest coverage) for the change.
// Usage: node scripts/ci-summary.mjs [output-file]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const MARKER = '<!-- playlish-ci-summary -->';

/** Reads a JSON file, or returns null when it does not exist or cannot be parsed. */
function readJson(file) {
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Formats a coverage percentage with one decimal. */
function pct(value) {
  return typeof value === 'number' ? `${value.toFixed(1)}%` : 'n/a';
}

/** A coverage percentage with its change against main, such as "68.4% (+0.3)". */
function withDelta(value, base) {
  if (typeof value !== 'number') return 'n/a';
  if (typeof base !== 'number') return pct(value);
  const d = value - base;
  return `${pct(value)} (${d >= 0 ? '+' : ''}${d.toFixed(1)})`;
}

const results = readJson('test-results.json');
const coverage = readJson('coverage/coverage-summary.json');
const baseline = readJson('coverage-baseline/coverage/coverage-summary.json');

const lines = [MARKER, '### Playlish CI', ''];

if (results) {
  const total = results.numTotalTests ?? 0;
  const passed = results.numPassedTests ?? 0;
  const failed = results.numFailedTests ?? 0;
  const skipped = (results.numPendingTests ?? 0) + (results.numTodoTests ?? 0);
  lines.push('| Tests | Passed | Failed | Skipped |', '|---|---|---|---|', `| ${total} | ${passed} | ${failed} | ${skipped} |`, '');
  if (failed > 0) {
    lines.push('**Failing tests**', '');
    for (const file of results.testResults ?? []) {
      for (const test of file.assertionResults ?? []) {
        if (test.status === 'failed') lines.push(`- \`${test.fullName}\``);
      }
    }
    lines.push('');
  }
  // With retries on CI, a test that failed and then passed is flaky: it passed but kept its first failure message.
  const flaky = [];
  for (const file of results.testResults ?? []) {
    for (const test of file.assertionResults ?? []) {
      if (test.status === 'passed' && (test.failureMessages ?? []).length > 0) flaky.push(test.fullName);
    }
  }
  if (flaky.length > 0) {
    lines.push('**Flaky tests** (failed, then passed on the retry)', '');
    for (const name of flaky) lines.push(`- \`${name}\``);
    lines.push('');
  }
} else {
  lines.push('Test results were not produced (an earlier step failed).', '');
}

if (coverage?.total) {
  const t = coverage.total;
  const b = baseline?.total;
  lines.push(
    `| Coverage${b ? ' (change against main)' : ''} | Statements | Branches | Functions | Lines |`,
    '|---|---|---|---|---|',
    `| All of \`src\` | ${withDelta(t.statements?.pct, b?.statements?.pct)} | ${withDelta(t.branches?.pct, b?.branches?.pct)} | ${withDelta(t.functions?.pct, b?.functions?.pct)} | ${withDelta(t.lines?.pct, b?.lines?.pct)} |`,
    '',
  );
} else {
  lines.push('Coverage was not produced.', '');
}

lines.push(`Commit \`${(process.env.GITHUB_SHA ?? 'local').slice(0, 7)}\``);

const text = `${lines.join('\n')}\n`;
const out = process.argv[2];
if (out) writeFileSync(out, text);
else process.stdout.write(text);
