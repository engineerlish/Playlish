// Builds the Markdown summary shown on pull requests and in the job summary.
// Reads test-results.json (Vitest JSON reporter) and coverage/coverage-summary.json (v8 coverage).
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

const results = readJson('test-results.json');
const coverage = readJson('coverage/coverage-summary.json');

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
} else {
  lines.push('Test results were not produced (an earlier step failed).', '');
}

if (coverage?.total) {
  const t = coverage.total;
  lines.push(
    '| Coverage | Statements | Branches | Functions | Lines |',
    '|---|---|---|---|---|',
    `| All of \`src\` | ${pct(t.statements?.pct)} | ${pct(t.branches?.pct)} | ${pct(t.functions?.pct)} | ${pct(t.lines?.pct)} |`,
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
