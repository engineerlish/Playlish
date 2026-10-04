// Turns Playwright's JSON results into a Markdown summary for the CI job page (prints to stdout).
// Flaky tests (passed only on the retry) and failures are listed by name so they do not disappear into a green run.
import { existsSync, readFileSync } from 'node:fs';

// CHANGE HERE: where playwright.config.ts writes the JSON report on CI.
const RESULTS = 'e2e-results/results.json';

if (!existsSync(RESULTS)) {
  console.log('### End-to-end tests\n\nNo results (the run did not start).');
  process.exit(0);
}

const results = JSON.parse(readFileSync(RESULTS, 'utf8'));
const s = results.stats;
const lines = [
  '### End-to-end tests',
  '',
  '| Passed | Failed | Flaky | Skipped | Time |',
  '|---|---|---|---|---|',
  `| ${s.expected} | ${s.unexpected} | ${s.flaky} | ${s.skipped} | ${Math.round(s.duration / 1000)} s |`,
];

/** Collects flaky and failed tests from a suite and its children. */
function walk(suite, out) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests) {
      if (test.status === 'flaky') out.push(`- Flaky: ${spec.file}: ${spec.title}`);
      if (test.status === 'unexpected') out.push(`- Failed: ${spec.file}: ${spec.title}`);
    }
  }
  for (const child of suite.suites ?? []) walk(child, out);
  return out;
}

const listed = results.suites.reduce((out, suite) => walk(suite, out), []);
if (listed.length > 0) lines.push('', ...listed);
console.log(lines.join('\n'));
