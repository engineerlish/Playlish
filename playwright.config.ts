import { defineConfig } from '@playwright/test';

// End-to-end tests (#9): the real Electron app against a fake Spotify. Run `npm run build` first (`npm run e2e` does).
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '**/*.spec.ts',
  // CHANGE HERE: per-test time limit. App start-up is well under a second; the rest is the flows themselves.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // One app at a time: each run owns tray icons and windows, and parallel Electron instances make timings noisy.
  workers: 1,
  fullyParallel: false,
  // One retry on CI; a test that only passes on retry is reported as flaky in the summary instead of hiding.
  retries: process.env['CI'] ? 1 : 0,
  forbidOnly: !!process.env['CI'],
  reporter: process.env['CI'] ? [['list'], ['html', { open: 'never', outputFolder: 'e2e-report' }], ['json', { outputFile: 'e2e-results/results.json' }]] : [['list']],
  outputDir: 'e2e-results/artifacts',
});
