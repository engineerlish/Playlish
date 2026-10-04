// Runs Vitest, and runs it once more if (and only if) the run failed because a test worker crashed with the Windows
// fast-fail code 0xC0000409 while no test failed. That crash is a Node 24 / libuv bug on Windows
// (https://github.com/nodejs/node/issues/56645): the assertion "!(handle->flags & UV_HANDLE_CLOSING)" kills a worker
// now and then, and its file's results are lost. Test failures, or a crash that happens twice, still fail.
// Usage: node scripts/vitest-run.mjs [vitest arguments]
import { spawnSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

// CHANGE HERE: the exit code Vitest reports for the crashed worker (0xC0000409 as an unsigned number).
const WINDOWS_FAST_FAIL = '3221226505';

/** Runs Vitest once, echoing its output, and returns the exit status and output. */
function run() {
  const result = spawnSync('npx', ['vitest', 'run', ...process.argv.slice(2)], { encoding: 'utf8', shell: true, maxBuffer: 64 * 1024 * 1024 });
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
  return { status: result.status ?? 1, output: `${result.stdout ?? ''}\n${result.stderr ?? ''}` };
}

/** True when the only problem was the known worker crash: no test failed. */
function crashOnly({ status, output }) {
  return status !== 0 && output.includes(`Worker exited unexpectedly with exit code ${WINDOWS_FAST_FAIL}`) && !/Tests\s+\d+ failed/.test(output);
}

let first = run();
if (crashOnly(first)) {
  const notice = 'A test worker crashed with the known Windows libuv bug (0xC0000409) and no test failed; running the suite once more.';
  console.log(`\n${notice}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `> ${notice}\n\n`);
  first = run();
}
process.exit(first.status);
