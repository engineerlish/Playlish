import type { Page } from '@playwright/test';
import axe from 'axe-core';
import { expect, test } from './fixtures';
import { TEST_CLIENT_ID, inHost, waitForPlayerReady } from './harness';

/*
 * Automated accessibility checks (axe-core, WCAG 2.1 A and AA rules) on every page and the setup wizard, in light and
 * dark mode. Automated rules catch a part of the problems only (missing names and labels, contrast, roles, ARIA
 * misuse); keyboard use is covered by the other end-to-end tests.
 */

/**
 * Violations as "rule: what, on which elements", for a readable failure message. axe-core is injected through
 * Playwright's evaluate (the @axe-core/playwright helper needs a new page, which Electron does not support).
 */
async function violations(page: Page): Promise<string[]> {
  await page.evaluate(axe.source);
  const results = await page.evaluate(() =>
    (window as unknown as { axe: typeof axe }).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }),
  );
  return results.violations.map((v) => `${v.id} (${v.impact ?? 'n/a'}): ${v.help} — ${v.nodes.map((n) => n.target.join(' ')).slice(0, 5).join(', ')}`);
}

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`accessibility (${scheme})`, () => {
    test('setup wizard', async ({ start }) => {
      const { ui } = await start();
      await ui.emulateMedia({ colorScheme: scheme });

      expect(await violations(ui)).toEqual([]);
      await ui.click('#setupNext');
      expect(await violations(ui)).toEqual([]);
    });

    test('every page, logged in and playing', async ({ start, fake }) => {
      fake.on('GET', '/v1/me', { status: 200, body: { id: 'me', display_name: 'Me', uri: 'spotify:user:me', images: [] } });
      fake.on('GET', '/v1/me/tracks', {
        status: 200,
        body: {
          items: [{ added_at: '', track: { type: 'track', id: 't', name: 'Song', uri: 'spotify:track:t', duration_ms: 1000, explicit: true, artists: [{ id: 'a', name: 'Artist', uri: '' }], album: { id: 'al', name: 'Album', uri: 'spotify:album:al', images: [], artists: [] } } }],
          total: 1, limit: 50, offset: 0, next: null, href: '',
        },
      });
      fake.on('GET', '/v1/me/player/queue', { status: 200, body: { currently_playing: null, queue: [] } });
      fake.on('GET', '/v1/me/player/devices', { status: 200, body: { devices: [] } });
      const { app, ui } = await start({ clientId: TEST_CLIENT_ID });
      await ui.emulateMedia({ colorScheme: scheme });
      await ui.click('#login');
      await waitForPlayerReady(app);
      await inHost(app, 'window.__stub.startPlaying()');

      const found: Record<string, string[]> = {};
      for (const page of ['library', 'search', 'queue', 'devices', 'settings', 'plugins']) {
        await ui.click(`#nav-${page}`);
        await ui.waitForTimeout(400);
        const v = await violations(ui);
        if (v.length > 0) found[page] = v;
      }
      expect(found).toEqual({});
    });
  });
}
