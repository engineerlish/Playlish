import type { ElectronApplication, Page } from '@playwright/test';
import type { FakeSpotify } from '../helpers/fake-spotify';
import { expect, test } from './fixtures';
import { TEST_CLIENT_ID, inHost, stubCommands, waitForPlayerReady, type Launched, type LaunchOptions } from './harness';

/** Logs in and starts playback on this device (the stub plays its first track). */
async function playingHere(start: (o?: Omit<LaunchOptions, 'fake'>) => Promise<Launched>): Promise<{ app: ElectronApplication; ui: Page }> {
  const launched = await start({ clientId: TEST_CLIENT_ID });
  await launched.ui.click('#login');
  await waitForPlayerReady(launched.app);
  await inHost(launched.app, 'window.__stub.startPlaying()');
  await expect(launched.ui.locator('#toggle')).toHaveAttribute('aria-label', 'Pause');
  return launched;
}

/** Scripts the fake so that a kitchen speaker is playing (or paused on) a track. */
function kitchenPlaying(fake: FakeSpotify, isPlaying = true): void {
  fake.on('GET', '/v1/me/player', {
    status: 200,
    body: {
      device: { id: 'kitchen', name: 'Kitchen speaker', type: 'Speaker', is_active: true, is_restricted: false, is_private_session: false, volume_percent: 40, supports_volume: true },
      repeat_state: 'off',
      shuffle_state: false,
      context: null,
      timestamp: 0,
      progress_ms: 60_000,
      is_playing: isPlaying,
      currently_playing_type: 'track',
      item: {
        type: 'track',
        id: 'k1',
        name: 'Kitchen Song',
        uri: 'spotify:track:k1',
        duration_ms: 240_000,
        explicit: false,
        artists: [{ id: 'a', name: 'Kitchen Band', uri: 'spotify:artist:a' }],
        album: { id: 'al', name: 'Album', uri: 'spotify:album:al', artists: [], images: [{ url: 'https://i.scdn.co/image/kitchen-300', width: 300, height: 300 }] },
      },
    },
  });
}

/** Query string of the latest request to a path, once there is one. */
async function lastQuery(fake: FakeSpotify, method: string, path: string): Promise<URLSearchParams> {
  await expect.poll(() => fake.requestsFor(method, path).length).toBeGreaterThan(0);
  return fake.requestsFor(method, path).at(-1)?.query ?? new URLSearchParams();
}

/** Closes the main window the way the title-bar X does. */
async function closeMainWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => !w.isDestroyed() && w.webContents.getURL().endsWith('/ui.html'))
      ?.close();
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test.describe('Now Playing on this device', () => {
  test('shows the track and no device label', async ({ start }) => {
    const { ui } = await playingHere(start);

    await expect(ui.locator('#track')).toHaveText('E2E Song One');
    await expect(ui.locator('#artists')).toHaveText('E2E Artist');
    await expect(ui.locator('#device')).toHaveCount(0);
  });

  test('seek, mute and unmute go to the player here', async ({ start }) => {
    const { app, ui } = await playingHere(start);

    await ui.locator('#seek').fill('60000');
    await expect.poll(async () => (await stubCommands(app)).find((c) => c.method === 'seek')?.args[0]).toBe(60_000);

    await ui.click('#mute');
    await expect.poll(() => inHost<number>(app, 'window.__stub.volume()')).toBe(0);
    await expect(ui.locator('#mute')).toHaveAttribute('aria-pressed', 'true');
    await ui.click('#mute');
    await expect.poll(() => inHost<number>(app, 'window.__stub.volume()')).toBeCloseTo(0.5, 5);
    await expect(ui.locator('#mute')).toHaveAttribute('aria-pressed', 'false');
  });

  test('shuffle and repeat go to the Web API for this device, and the buttons follow what Spotify reports', async ({ start, fake }) => {
    const { app, ui } = await playingHere(start);

    await ui.click('#shuffle');
    const shuffle = await lastQuery(fake, 'PUT', '/v1/me/player/shuffle');
    expect(shuffle.get('state')).toBe('true');
    expect(shuffle.get('device_id')).toBe('e2e-device');
    await inHost(app, 'window.__stub.set({ shuffle: true })');
    await expect(ui.locator('#shuffle')).toHaveAttribute('aria-pressed', 'true');

    await ui.click('#repeat');
    expect((await lastQuery(fake, 'PUT', '/v1/me/player/repeat')).get('state')).toBe('context');
    await inHost(app, 'window.__stub.set({ repeat: 2 })');
    await expect(ui.locator('#repeat')).toHaveAttribute('aria-label', 'Repeating this track');
    await ui.click('#repeat');
    await expect.poll(() => fake.requestsFor('PUT', '/v1/me/player/repeat').at(-1)?.query.get('state')).toBe('off');
  });

  test('the Windows media overlay gets the track, art and play state', async ({ start }) => {
    const { app } = await playingHere(start);
    const overlay = () =>
      inHost<{ title: string; artist: string; art: string[]; state: string }>(
        app,
        `({ title: navigator.mediaSession.metadata?.title, artist: navigator.mediaSession.metadata?.artist,
            art: [...(navigator.mediaSession.metadata?.artwork ?? [])].map((a) => a.sizes), state: navigator.mediaSession.playbackState })`,
      );

    await expect.poll(overlay).toEqual({ title: 'E2E Song One', artist: 'E2E Artist', art: ['64x64', '300x300', '640x640'], state: 'playing' });
  });

  test('no Web API polling while playing here', async ({ start, fake }) => {
    await playingHere(start);
    const before = fake.requestsFor('GET', '/v1/me/player').length;

    await sleep(6_000);

    expect(fake.requestsFor('GET', '/v1/me/player')).toHaveLength(before);
  });
});

test.describe('Now Playing on another device', () => {
  test('shows what another device plays and controls it through the Web API', async ({ start, fake }) => {
    kitchenPlaying(fake);
    const { ui } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#login');

    await expect(ui.locator('#track')).toHaveText('Kitchen Song');
    await expect(ui.locator('#device')).toHaveText(/Playing on Kitchen speaker/);

    await ui.click('#toggle');
    expect((await lastQuery(fake, 'PUT', '/v1/me/player/pause')).get('device_id')).toBe('kitchen');
    await ui.click('#next');
    expect((await lastQuery(fake, 'POST', '/v1/me/player/next')).get('device_id')).toBe('kitchen');
    await ui.locator('#volume').fill('20');
    await expect.poll(() => fake.requestsFor('PUT', '/v1/me/player/volume').at(-1)?.query.get('volume_percent')).toBe('20');
    await ui.locator('#seek').fill('90000');
    expect((await lastQuery(fake, 'PUT', '/v1/me/player/seek')).get('position_ms')).toBe('90000');
  });

  test('polls only while the window is open', async ({ start, fake }) => {
    kitchenPlaying(fake);
    const { app, ui } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#login');
    await expect(ui.locator('#device')).toBeVisible();
    // Playing elsewhere: checked every 5 seconds while the window is visible.
    await expect.poll(() => fake.requestsFor('GET', '/v1/me/player').length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);

    await closeMainWindow(app);
    await sleep(500);
    const afterClose = fake.requestsFor('GET', '/v1/me/player').length;
    await sleep(11_000);

    expect(fake.requestsFor('GET', '/v1/me/player')).toHaveLength(afterClose);
  });
});
