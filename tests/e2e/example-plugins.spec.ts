import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, test } from './fixtures';
import { TEST_CLIENT_ID, inHost, waitForPlayerReady, type Launched, type LaunchOptions } from './harness';
import { offerPackage, packExample, violations } from './plugin-helpers';

/*
 * The example plugins (#104), installed from the real examples/ folder and run against the fake Spotify: what each shows
 * and what it asks Spotify to do.
 */

type Start = (options?: Omit<LaunchOptions, 'fake'>) => Promise<Launched>;

/** A track in the Web API's shape. */
function track(n: number, artist: string, name = `Song ${n}`) {
  return {
    type: 'track',
    id: `t${n}`,
    uri: `spotify:track:t${n}`,
    name,
    duration_ms: 200_000,
    explicit: false,
    artists: [{ id: artist, name: artist, uri: `spotify:artist:${artist}` }],
    album: { id: 'al', name: 'Album', uri: 'spotify:album:al', images: [], artists: [] },
  };
}

/** Logs in, then installs an example after its prompt. */
async function installExample(start: Start, name: string, extra: { eqDir?: string } = {}): Promise<Launched> {
  const launched = await start({ clientId: TEST_CLIENT_ID, ...extra });
  await launched.ui.click('#login');
  await waitForPlayerReady(launched.app);
  await launched.ui.click('#nav-plugins');
  await offerPackage(launched.app, launched.userDataDir, `${name}.playlish`, packExample(name));
  await launched.ui.click('#installPlugin');
  await launched.ui.click('#approvePlugin');
  return launched;
}

test.describe('example plugins', () => {
  test('Listening stats shows your top artists and tracks below the sidebar', async ({ start, fake }) => {
    const plays = [track(1, 'Artist X', 'Song A'), track(1, 'Artist X', 'Song A'), track(1, 'Artist X', 'Song A'), track(2, 'Artist Y', 'Song B'), track(2, 'Artist Y', 'Song B'), track(3, 'Artist X', 'Song C')];
    fake.on('GET', '/v1/me/player/recently-played', { status: 200, body: { items: plays.map((t, i) => ({ track: t, played_at: `2026-10-10T10:0${i}:00Z` })) } });

    const { ui } = await installExample(start, 'listening-stats');

    const panel = ui.locator('.sidebar-panels section[data-plugin="io.github.engineerlish.listening-stats"]');
    await expect(panel.locator('.pp-title')).toHaveText('Listening stats');
    await expect(panel.locator('.pp-list').first().locator('li')).toHaveText(['Artist X 4 plays', 'Artist Y 2 plays']);
    await expect(panel.locator('.pp-list').nth(1).locator('li')).toHaveText(['Song A – Artist X 3 plays', 'Song B – Artist Y 2 plays', 'Song C – Artist X 1 play']);
    await expect(panel).toContainText('From your last 6 plays.');
    expect(await violations(ui)).toEqual([]);

    const before = fake.requestsFor('GET', '/v1/me/player/recently-played').length;
    await panel.getByRole('button', { name: 'Refresh' }).click();
    await expect.poll(() => fake.requestsFor('GET', '/v1/me/player/recently-played').length).toBe(before + 1);
  });

  test('Smart shuffle queues a mix without repeats and never the same artist twice in a row', async ({ start, fake }) => {
    const artists = ['A', 'A', 'A', 'B', 'B', 'C', 'C', 'D', 'E', 'F', 'G', 'H'];
    const liked = artists.map((a, i) => ({ added_at: '2026-10-01T00:00:00Z', track: track(i + 1, a) }));
    fake.on('GET', '/v1/me/tracks', { status: 200, body: { items: liked, total: liked.length, offset: 0, limit: 50, next: null, previous: null, href: '' } });
    fake.on('POST', '/v1/me/player/queue', { status: 204 });
    const artistOf = new Map(liked.map((l) => [l.track.uri, l.track.artists[0]?.name]));
    const queued = () => fake.requestsFor('POST', '/v1/me/player/queue').map((r) => r.query.get('uri') ?? '');

    const { ui } = await installExample(start, 'smart-shuffle');
    const panel = ui.locator('section[data-plugin="io.github.engineerlish.smart-shuffle"]');
    await expect(panel.locator('.pp-title')).toHaveText('Smart shuffle');
    await panel.getByRole('slider', { name: /Songs in a mix/ }).fill('5');
    await expect(panel.getByRole('slider')).toHaveAccessibleName('Songs in a mix: 5');

    await panel.getByRole('button', { name: 'Queue a mix' }).click();
    await expect(panel).toContainText('Queued 5 songs');
    const first = queued();
    expect(first).toHaveLength(5);
    expect(new Set(first).size).toBe(5);
    for (let i = 1; i < first.length; i++) expect(artistOf.get(first[i] ?? ''), `songs ${i - 1} and ${i}`).not.toBe(artistOf.get(first[i - 1] ?? ''));

    // The next mix leaves out what the last one queued (12 songs, so there are 7 fresh ones).
    await panel.getByRole('button', { name: 'Queue a mix' }).click();
    await expect.poll(() => queued().length).toBe(10);
    const second = queued().slice(5);
    expect(second.filter((uri) => first.includes(uri))).toEqual([]);
  });

  test('EQ by playlist switches the equalizer preset when the chosen playlist plays', async ({ start, fake }) => {
    const apo = fs.mkdtempSync(path.join(os.tmpdir(), 'playlish-eqapo-'));
    fs.writeFileSync(path.join(apo, 'config.txt'), 'Preamp: 0 dB\r\n');
    const playlist = (id: string, name: string) => ({ id, name, uri: `spotify:playlist:${id}`, images: null, owner: { id: 'me', display_name: 'Me' }, snapshot_id: 's', collaborative: false, public: false, description: null, items: { total: 3, href: '' } });
    fake.on('GET', '/v1/me/playlists', { status: 200, body: { items: [playlist('gym', 'Gym'), playlist('chill', 'Chill')], total: 2, offset: 0, limit: 50, next: null, previous: null, href: '' } });

    const { app, ui } = await installExample(start, 'eq-by-playlist', { eqDir: apo });
    // The user's own choice: the equalizer is on.
    await ui.click('#nav-settings');
    await ui.check('#eqEnabled');
    await expect(ui.locator('#eqPreset')).toHaveValue('flat');
    await ui.click('#nav-plugins');

    const panel = ui.locator('section[data-plugin="io.github.engineerlish.eq-by-playlist"]');
    await panel.getByRole('combobox', { name: 'Playlist' }).selectOption('spotify:playlist:gym');
    await panel.getByRole('combobox', { name: 'Preset' }).selectOption('bassBoost');
    await panel.getByRole('button', { name: 'Use this preset for the playlist' }).click();
    await expect(panel.locator('.pp-list li')).toHaveText(['Gym Bass boost']);

    // Music starts from the Gym playlist.
    await inHost(app, "window.__stub.set({ context: 'spotify:playlist:gym' }); window.__stub.startPlaying()");

    await expect(panel).toContainText('Playing from Gym: Bass boost.');
    await ui.click('#nav-settings');
    await expect(ui.locator('#eqPreset')).toHaveValue('bassBoost');
    await expect.poll(() => fs.readFileSync(path.join(apo, 'playlish.txt'), 'utf8')).toMatch(/GraphicEQ/);
    fs.rmSync(apo, { recursive: true, force: true });
  });

  test('the template plugin counts tracks in its storage and resets', async ({ start }) => {
    const { app, ui, userDataDir } = await installExample(start, 'template');
    const panel = ui.locator('section[data-plugin="com.example.my-plugin"]');
    await expect(panel).toContainText('Tracks played since the last reset: 0');

    await inHost(app, 'window.__stub.startPlaying()');
    await expect(panel).toContainText('Tracks played since the last reset: 1');
    const stored = JSON.parse(fs.readFileSync(path.join(userDataDir, 'plugin-data', 'com.example.my-plugin', 'storage.json'), 'utf8')) as { count: number };
    expect(stored.count).toBe(1);

    await panel.getByRole('button', { name: 'Reset' }).click();
    await expect(panel).toContainText('Tracks played since the last reset: 0');
  });
});
