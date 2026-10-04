import type { FakeSpotify } from '../helpers/fake-spotify';
import { expect, test } from './fixtures';
import { TEST_CLIENT_ID, inHost, waitForPlayerReady } from './harness';

/*
 * Queue (#49): loaded when the page opens and when the track changes, never on a timer.
 */

const item = (id: string, name: string) => ({
  type: 'track', id, name, uri: `spotify:track:${id}`, duration_ms: 200_000, explicit: false, is_playable: true,
  artists: [{ id: 'a', name: 'Queue Artist', uri: 'spotify:artist:a' }], album: { id: 'q', name: 'Queue Album', uri: 'spotify:album:q', images: [], artists: [] },
});

function scriptQueue(fake: FakeSpotify, current: string, next: string[]): void {
  fake.on('GET', '/v1/me/player/queue', { status: 200, body: { currently_playing: item('now', current), queue: next.map((n, i) => item(`n${i}`, n)) } });
}

const queueLoads = (fake: FakeSpotify) => fake.requestsFor('GET', '/v1/me/player/queue').length;

test.describe('queue', () => {
  test('shows what plays now and what comes next', async ({ start, fake }) => {
    scriptQueue(fake, 'Current Song', ['Next One', 'Next Two']);
    const { app, ui } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#login');
    await waitForPlayerReady(app);

    await ui.click('#nav-queue');

    await expect(ui.locator('#queue-now .row-title')).toHaveText('Current Song');
    await expect(ui.locator('#queue-next .row-title')).toHaveText(['Next One', 'Next Two']);
  });

  test('reloads when the track changes and on Refresh, but not on a timer', async ({ start, fake }) => {
    scriptQueue(fake, 'Current Song', ['Next One']);
    const { app, ui } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#login');
    await waitForPlayerReady(app);
    await inHost(app, 'window.__stub.startPlaying()');
    await ui.click('#nav-queue');
    await expect(ui.locator('#queue-next .row-title')).toHaveText(['Next One']);
    const loaded = queueLoads(fake);

    await new Promise((r) => setTimeout(r, 6000));
    expect(queueLoads(fake)).toBe(loaded);

    scriptQueue(fake, 'Next One', []);
    await ui.click('#next');
    await expect.poll(() => queueLoads(fake)).toBe(loaded + 1);
    await expect(ui.locator('#queue-now .row-title')).toHaveText('Next One');
    await expect(ui.locator('#queue-next')).toContainText('Nothing queued');

    await ui.click('#refreshQueue');
    await expect.poll(() => queueLoads(fake)).toBe(loaded + 2);
  });

  test('a failure is explained', async ({ start, fake }) => {
    fake.on('GET', '/v1/me/player/queue', { status: 500, body: { error: { status: 500, message: 'Server error' } } });
    const { app, ui } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#login');
    await waitForPlayerReady(app);

    await ui.click('#nav-queue');

    await expect(ui.locator('#page-queue .error-text')).toBeVisible({ timeout: 20_000 });
  });
});
