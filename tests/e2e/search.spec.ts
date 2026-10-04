import type { FakeSpotify } from '../helpers/fake-spotify';
import { expect, test } from './fixtures';
import { TEST_CLIENT_ID, waitForPlayerReady } from './harness';

/*
 * Search (#48) against a fake Spotify that answers by type and offset: 25 songs (three pages of 10), one album, one
 * artist and no playlists.
 */

function scriptSearch(fake: FakeSpotify): void {
  fake.on('GET', '/v1/me', { status: 200, body: { id: 'me', display_name: 'Me', uri: 'spotify:user:me', images: [] } });
  fake.on('GET', '/v1/search', (request) => {
    const type = request.query.get('type');
    const offset = Number(request.query.get('offset') ?? 0);
    const limit = Number(request.query.get('limit') ?? 10);
    const q = request.query.get('q') ?? '';
    const page = (total: number, make: (i: number) => unknown) => ({
      items: Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, k) => make(offset + k)),
      total,
      limit,
      offset,
      next: null,
      href: '',
    });
    const body: Record<string, unknown> = {};
    if (type === 'track')
      body['tracks'] = page(25, (i) => ({
        type: 'track', id: `s${i}`, name: `${q} song ${i + 1}`, uri: `spotify:track:s${i}`, duration_ms: 200_000, explicit: false, is_playable: true,
        artists: [{ id: 'a', name: 'Search Artist', uri: 'spotify:artist:a' }], album: { id: 'sa', name: 'Search Album', uri: 'spotify:album:sa', images: [], artists: [] },
      }));
    if (type === 'album') body['albums'] = page(1, () => ({ id: 'sa', name: 'Search Album', uri: 'spotify:album:sa', images: [], artists: [{ id: 'a', name: 'Search Artist', uri: '' }], total_tracks: 1 }));
    if (type === 'artist') body['artists'] = page(1, () => ({ id: 'a', name: 'Search Artist', uri: 'spotify:artist:a', images: [] }));
    if (type === 'playlist') body['playlists'] = page(0, () => null);
    return { status: 200, body };
  });
  fake.on('GET', '/v1/albums/sa/tracks', {
    status: 200,
    body: { items: [{ type: 'track', id: 'x1', name: 'Only Track', uri: 'spotify:track:x1', duration_ms: 1000, explicit: false, artists: [] }], total: 1, limit: 50, offset: 0, next: null, href: '' },
  });
}

async function openSearch(start: Parameters<Parameters<typeof test>[2]>[0]['start'], fake: FakeSpotify) {
  scriptSearch(fake);
  const launched = await start({ clientId: TEST_CLIENT_ID });
  await launched.ui.click('#login');
  await waitForPlayerReady(launched.app);
  await launched.ui.click('#nav-search');
  return launched;
}

const searches = (fake: FakeSpotify, type: string) => fake.requestsFor('GET', '/v1/search').filter((r) => r.query.get('type') === type);

test.describe('search', () => {
  test('typing searches once, after a pause, for each kind of result', async ({ start, fake }) => {
    const { ui } = await openSearch(start, fake);

    await ui.locator('#searchInput').pressSequentially('lofi', { delay: 40 });

    await expect(ui.locator('#results-track .row-title').first()).toHaveText('lofi song 1');
    for (const type of ['track', 'album', 'artist', 'playlist']) {
      expect(searches(fake, type).map((r) => r.query.get('q'))).toEqual(['lofi']);
    }
  });

  test('10 songs at a time, with More until all are shown; empty kinds are hidden', async ({ start, fake }) => {
    const { ui } = await openSearch(start, fake);
    await ui.fill('#searchInput', 'jazz');

    await expect(ui.locator('#results-track .search-row')).toHaveCount(10);
    await ui.click('#more-track');
    await expect(ui.locator('#results-track .search-row')).toHaveCount(20);
    await ui.click('#more-track');
    await expect(ui.locator('#results-track .search-row')).toHaveCount(25);
    await expect(ui.locator('#more-track')).toHaveCount(0);
    expect(searches(fake, 'track').map((r) => [r.query.get('offset'), r.query.get('limit')])).toEqual([
      ['0', '10'],
      ['10', '10'],
      ['20', '10'],
    ]);
    await expect(ui.locator('#results-album')).toBeVisible();
    await expect(ui.locator('#results-playlist')).toHaveCount(0);
  });

  test('playing a song plays the results from there on; an artist plays as a context', async ({ start, fake }) => {
    const { ui } = await openSearch(start, fake);
    await ui.fill('#searchInput', 'rock');

    await ui.locator('#results-track .row-main', { hasText: 'rock song 4' }).click();
    await expect.poll(() => fake.requestsFor('PUT', '/v1/me/player/play').length).toBe(1);
    const uris = (fake.requestsFor('PUT', '/v1/me/player/play')[0]?.body as { uris: string[] }).uris;
    expect(uris.slice(0, 2)).toEqual(['spotify:track:s3', 'spotify:track:s4']);

    await ui.locator('#results-artist .row-main', { hasText: 'Search Artist' }).click();
    await expect.poll(() => (fake.requestsFor('PUT', '/v1/me/player/play').at(-1)?.body as { context_uri?: string }).context_uri).toBe('spotify:artist:a');
  });

  test('a search that finds nothing says so', async ({ start, fake }) => {
    const { ui } = await openSearch(start, fake);
    fake.on('GET', '/v1/search', (request) => {
      const key = `${request.query.get('type') ?? ''}s`;
      return { status: 200, body: { [key]: { items: [], total: 0, limit: 10, offset: 0, next: null, href: '' } } };
    });

    await ui.fill('#searchInput', 'zzzzqx');

    await expect(ui.locator('#noResults')).toHaveText('No results for “zzzzqx”.');
  });

  test('an album opens from the results, and Back returns to them without searching again', async ({ start, fake }) => {
    const { ui } = await openSearch(start, fake);
    await ui.fill('#searchInput', 'blues');
    await expect(ui.locator('#results-album .row-main')).toBeVisible();
    const before = fake.requestsFor('GET', '/v1/search').length;

    await ui.locator('#results-album .row-main', { hasText: 'Search Album' }).click();
    await expect(ui.locator('#detailTitle')).toHaveText('Search Album');
    await expect(ui.locator('.row-main', { hasText: 'Only Track' })).toBeVisible();
    await ui.click('#libraryBack');

    await expect(ui.locator('#results-track .search-row')).toHaveCount(10);
    await expect(ui.locator('#searchInput')).toHaveValue('blues');
    expect(fake.requestsFor('GET', '/v1/search')).toHaveLength(before);
  });
});
