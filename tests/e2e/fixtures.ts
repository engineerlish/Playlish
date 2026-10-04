import { test as base } from '@playwright/test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { FakeSpotify } from '../helpers/fake-spotify';
import { launch, shutdown, workingSpotify, type LaunchOptions, type Launched } from './harness';

/*
 * Test fixtures: a fake Spotify per test, and a `start` helper that launches Playlish and always cleans up. When a test
 * fails, a screenshot of the main window, the app log and a Playwright trace (screenshots of every step, DOM snapshots
 * and actions; open it with `npx playwright show-trace`) are attached to the report, and CI uploads them as artifacts.
 * (Playwright's video recording is not used: with it enabled, Electron windows are not reported to the test.)
 */

interface Fixtures {
  fake: FakeSpotify;
  start: (options?: Omit<LaunchOptions, 'fake'>) => Promise<Launched>;
}

export const test = base.extend<Fixtures>({
  // Playwright reads the fixture's dependencies from this destructuring, so it must be an (empty) object pattern.
  // eslint-disable-next-line no-empty-pattern
  fake: async ({}, use) => {
    const fake = await workingSpotify();
    await use(fake);
    await fake.stop();
  },
  start: async ({ fake }, use, testInfo) => {
    const runs: Launched[] = [];
    await use(async (options = {}) => {
      const launched = await launch({ fake, ...options });
      await launched.app.context().tracing.start({ screenshots: true, snapshots: true });
      runs.push(launched);
      return launched;
    });
    const failed = testInfo.status !== testInfo.expectedStatus;
    for (const [i, run] of runs.entries()) {
      // Runs closed by the test itself (restarts) have no trace left to save.
      const trace = testInfo.outputPath(`trace-${i}.zip`);
      await run.app
        .context()
        .tracing.stop(failed ? { path: trace } : {})
        .then(() => (failed && fs.existsSync(trace) ? testInfo.attach(`trace-${i}`, { path: trace, contentType: 'application/zip' }) : undefined))
        .catch(() => undefined);
      if (failed) {
        const page = run.app.windows().find((p) => p.url().endsWith('/ui.html'));
        if (page) await testInfo.attach(`screenshot-${i}`, { body: await page.screenshot().catch(() => Buffer.alloc(0)), contentType: 'image/png' });
        const log = path.join(run.userDataDir, 'logs', 'playlish.log');
        if (fs.existsSync(log)) await testInfo.attach(`playlish-${i}.log`, { path: log, contentType: 'text/plain' });
      }
      // Profiles shared between runs of one test (restarts) are removed once, after the last run.
      const sharedLater = runs.slice(i + 1).some((r) => r.userDataDir === run.userDataDir);
      await shutdown(run, sharedLater);
    }
  },
});

export { expect } from '@playwright/test';
