import type { ElectronApplication, Page } from '@playwright/test';
import type { FakeSpotify } from '../helpers/fake-spotify';
import { expect, test } from './fixtures';
import { TEST_CLIENT_ID, waitForPlayerReady, type Launched, type LaunchOptions } from './harness';

/*
 * Library pages (#47) against a fake Spotify that generates a library of any size.
 */

const track = (i: number, extra: Record<string, unknown> = {}) => ({
  type: 'track',
  id: `t${i}`,
  name: `Liked Song ${i + 1}`,
  uri: `spotify:track:t${i}`,
  duration_ms: 180_000 + i,
  explicit: i % 7 === 0,
  is_playable: true,
  artists: [{ id: 'a', name: 'Library Artist', uri: 'spotify:artist:a' }],
  album: { id: `al${i}`, name: `Album ${i}`, uri: `spotify:album:al${i}`, images: [], artists: [] },
  ...extra,
});

/** Pages of a list of `total` generated entries, answering any offset and limit. */
function paged(total: number, make: (i: number) => unknown) {
  return (request: { query: URLSearchParams }) => {
    const offset = Number(request.query.get('offset') ?? 0);
    const limit = Number(request.query.get('limit') ?? 50);
    const items = [];
    for (let i = offset; i < Math.min(total, offset + limit); i++) items.push(make(i));
    return { status: 200, body: { items, total, limit, offset, next: null, href: '' } };
  };
}

function scriptLibrary(fake: FakeSpotify, likedCount = 120): void {
  fake.on('GET', '/v1/me', { status: 200, body: { id: 'me', display_name: 'Me', uri: 'spotify:user:me', images: [] } });
  fake.on('GET', '/v1/me/tracks', paged(likedCount, (i) => ({ added_at: '2026-10-01T00:00:00Z', track: track(i) })));
  fake.on('GET', '/v1/me/albums', paged(1, () => ({ added_at: '', album: { id: 'alb1', name: 'Saved Album', uri: 'spotify:album:alb1', images: [], artists: [{ id: 'a', name: 'Album Artist', uri: '' }], total_tracks: 2 } })));
  fake.on('GET', '/v1/albums/alb1/tracks', paged(2, (i) => {
    const { album: _album, ...t } = track(100 + i, i === 1 ? { is_playable: false, name: 'Blocked Song' } : { name: 'Album Song' });
    void _album;
    return t;
  }));
  const playlist = (id: string, name: string, owner: string) => ({
    id, name, uri: `spotify:playlist:${id}`, images: null, owner: { id: owner, display_name: owner === 'me' ? 'Me' : 'Someone Else' },
    snapshot_id: 'snap1', collaborative: false, public: true, description: '', items: { total: 2, href: '' },
  });
  fake.on('GET', '/v1/me/playlists', paged(2, (i) => (i === 0 ? playlist('pl1', 'My Mix', 'me') : playlist('pl2', 'Their Mix', 'other'))));
  fake.on('GET', '/v1/playlists/pl1/items', paged(2, (i) => (i === 0 ? { added_at: null, is_local: false, item: track(200, { name: 'Mix Song' }) } : { added_at: null, is_local: false, item: null })));
  fake.on('PUT', '/v1/me/library', { status: 200 });
  fake.on('DELETE', '/v1/me/library', { status: 200 });
  fake.on('POST', '/v1/me/player/queue', { status: 204 });
}

async function openLibrary(start: (o?: Omit<LaunchOptions, 'fake'>) => Promise<Launched>, fake: FakeSpotify, likedCount?: number): Promise<{ app: ElectronApplication; ui: Page }> {
  scriptLibrary(fake, likedCount);
  const launched = await start({ clientId: TEST_CLIENT_ID });
  await launched.ui.click('#login');
  await waitForPlayerReady(launched.app);
  await launched.ui.click('#nav-library');
  return launched;
}

const lastBody = (fake: FakeSpotify, method: string, path: string) => fake.requestsFor(method, path).at(-1);

test.describe('library', () => {
  test('liked songs load page by page while scrolling, with only the visible rows in the page', async ({ start, fake }) => {
    const { ui } = await openLibrary(start, fake, 1000);

    await expect(ui.locator('#list-tracks .row-title').first()).toHaveText('Liked Song 1');
    expect(fake.requestsFor('GET', '/v1/me/tracks').map((r) => r.query.get('offset'))).toEqual(['0']);

    await ui.locator('#list-tracks').evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect(ui.locator('#list-tracks .row-title', { hasText: /^Liked Song 1000$/ })).toBeVisible();
    expect(fake.requestsFor('GET', '/v1/me/tracks').map((r) => r.query.get('offset'))).toContain('950');
    expect(await ui.locator('#list-tracks .vrow').count()).toBeLessThan(60);
    await expect(ui.locator('#list-tracks .vrow').last()).toHaveAttribute('aria-setsize', '1000');
  });

  test('playing a liked song plays the songs from there on', async ({ start, fake }) => {
    const { ui } = await openLibrary(start, fake);

    await ui.locator('#list-tracks .row-main', { hasText: 'Liked Song 3' }).click();

    await expect.poll(() => fake.requestsFor('PUT', '/v1/me/player/play').length).toBe(1);
    const uris = (lastBody(fake, 'PUT', '/v1/me/player/play')?.body as { uris: string[] }).uris;
    expect(uris[0]).toBe('spotify:track:t2');
    expect(uris.length).toBeGreaterThan(1);
    await expect(ui.locator('.library-status')).toHaveText('Playing Liked Song 3.');
  });

  test('add to queue and remove from Liked Songs', async ({ start, fake }) => {
    const { ui } = await openLibrary(start, fake);

    await ui.getByRole('button', { name: 'Add Liked Song 2 to the queue' }).click();
    await expect.poll(() => lastBody(fake, 'POST', '/v1/me/player/queue')?.query.get('uri')).toBe('spotify:track:t1');

    const loadsBefore = fake.requestsFor('GET', '/v1/me/tracks').length;
    await ui.getByRole('button', { name: 'Remove Liked Song 2 from Liked Songs' }).click();
    await expect.poll(() => lastBody(fake, 'DELETE', '/v1/me/library')?.query.get('uris')).toBe('spotify:track:t1');
    // The list loads again so it shows the change.
    await expect.poll(() => fake.requestsFor('GET', '/v1/me/tracks').length).toBeGreaterThan(loadsBefore);
  });

  test("an album opens to its songs and plays from the chosen one; songs Spotify can't play are disabled", async ({ start, fake }) => {
    const { ui } = await openLibrary(start, fake);
    await ui.click('#tab-albums');

    await ui.locator('.row-main', { hasText: 'Saved Album' }).click();
    await expect(ui.locator('#detailTitle')).toHaveText('Saved Album');
    await expect(ui.locator('.row-main', { hasText: 'Blocked Song' })).toBeDisabled();
    await ui.locator('.row-main', { hasText: 'Album Song' }).click();

    await expect.poll(() => fake.requestsFor('PUT', '/v1/me/player/play').length).toBe(1);
    expect(lastBody(fake, 'PUT', '/v1/me/player/play')?.body).toEqual({ context_uri: 'spotify:album:alb1', offset: { uri: 'spotify:track:t100' } });

    await ui.click('#libraryBack');
    await expect(ui.locator('#tab-albums')).toBeVisible();
  });

  test("your playlist lists its songs; someone else's shows a note and can still be played", async ({ start, fake }) => {
    const { ui } = await openLibrary(start, fake);
    await ui.click('#tab-playlists');

    await ui.locator('.row-main', { hasText: 'My Mix' }).click();
    await expect(ui.locator('.row-main', { hasText: 'Mix Song' })).toBeVisible();
    await expect(ui.locator('.row.unavailable')).toHaveText('This song is no longer available');
    await ui.click('#libraryBack');

    await ui.locator('.row-main', { hasText: 'Their Mix' }).click();
    await expect(ui.locator('#othersNote')).toContainText('your own and collaborative playlists');
    expect(fake.requestsFor('GET', '/v1/playlists/pl2/items')).toHaveLength(0);
    await ui.click('#playContext');
    await expect.poll(() => (lastBody(fake, 'PUT', '/v1/me/player/play')?.body as { context_uri?: string } | undefined)?.context_uri).toBe('spotify:playlist:pl2');
  });

  test('a 5,000-song library keeps window memory flat', async ({ start, fake }) => {
    test.setTimeout(240_000);
    const { app, ui } = await openLibrary(start, fake, 5000);
    await expect(ui.locator('#list-tracks .row-title').first()).toHaveText('Liked Song 1');
    // Private memory of the main window's renderer, in MB.
    const windowMb = () =>
      app.evaluate(({ app: a, BrowserWindow }) => {
        const pid = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().endsWith('/ui.html'))?.webContents.getOSProcessId();
        return a.getAppMetrics().filter((m) => m.pid === pid).reduce((sum, m) => sum + (m.memory.privateBytes ?? 0) / 1024, 0);
      });
    // CHANGE HERE: how long Chromium gets to settle (it frees scrolling garbage on its own within about 25 s).
    const SETTLE_MS = 30_000;
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const before = await windowMb();

    // Scroll through the whole list in steps, so every page is loaded (and older ones dropped) once.
    const steps = await ui.locator('#list-tracks').evaluate(async (el) => {
      let n = 0;
      for (let top = 0; top < el.scrollHeight; top += el.clientHeight * 3) {
        el.scrollTo(0, top);
        n++;
        await new Promise((r) => setTimeout(r, 60));
      }
      el.scrollTo(0, el.scrollHeight);
      return n;
    });
    expect(steps).toBeGreaterThan(20);
    await expect(ui.locator('#list-tracks .row-title', { hasText: /^Liked Song 5000$/ })).toBeVisible({ timeout: 20_000 });
    expect(fake.requestsFor('GET', '/v1/me/tracks').length).toBeGreaterThanOrEqual(100);
    await new Promise((r) => setTimeout(r, SETTLE_MS));
    const after = await windowMb();

    console.log(`Main window: ${Math.round(before)} MB before, ${Math.round(after)} MB after scrolling 5,000 songs and settling`);
    // CHANGE HERE: allowed growth. Only a dozen pages of rows stay in the window, whatever the library size.
    expect(after - before).toBeLessThan(25);
    expect(await ui.locator('#list-tracks .vrow').count()).toBeLessThan(60);
  });
});
