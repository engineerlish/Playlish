import type { FakeSpotify } from '../helpers/fake-spotify';
import { expect, test } from './fixtures';
import { TEST_CLIENT_ID, inHost, waitForPlayerReady } from './harness';

/** Scripts the device list: this computer (the stub's device) and a kitchen speaker, one of them active. */
function scriptDevices(fake: FakeSpotify, active: 'e2e-device' | 'kitchen' = 'e2e-device'): void {
  const device = (id: string, name: string, type: string) => ({
    id,
    name,
    type,
    is_active: id === active,
    is_restricted: false,
    is_private_session: false,
    volume_percent: 50,
    supports_volume: true,
  });
  fake.on('GET', '/v1/me/player/devices', {
    status: 200,
    body: { devices: [device('kitchen', 'Kitchen speaker', 'Speaker'), device('e2e-device', 'Playlish', 'Computer'), { ...device('tv', 'Living room TV', 'TV'), is_restricted: true }] },
  });
  fake.on('PUT', '/v1/me/player', { status: 204 });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test.describe('devices', () => {
  test('the Devices page lists this computer first and loads only when opened or refreshed', async ({ start, fake }) => {
    scriptDevices(fake);
    const { app, ui } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#login');
    await waitForPlayerReady(app);
    await sleep(500);
    expect(fake.requestsFor('GET', '/v1/me/player/devices')).toHaveLength(0);

    await ui.click('#nav-devices');

    await expect(ui.locator('#device-this')).toContainText('This computer (Playlish)');
    await expect(ui.locator('#device-this')).toContainText('Playing here');
    await expect(ui.locator('#device-kitchen')).toBeEnabled();
    await expect(ui.locator('#device-tv')).toBeDisabled();
    const names = await ui.locator('.devices .device-name').allTextContents();
    expect(names).toEqual(['This computer (Playlish)', 'Kitchen speaker', 'Living room TV']);

    // Never on a timer.
    await sleep(3_000);
    expect(fake.requestsFor('GET', '/v1/me/player/devices')).toHaveLength(1);
    await ui.click('#refreshDevices');
    await expect.poll(() => fake.requestsFor('GET', '/v1/me/player/devices').length).toBe(2);
  });

  test('moving playback to another device keeps it playing', async ({ start, fake }) => {
    scriptDevices(fake);
    const { app, ui } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#login');
    await waitForPlayerReady(app);
    await inHost(app, 'window.__stub.startPlaying()');
    await expect(ui.locator('#toggle')).toHaveAttribute('aria-label', 'Pause');
    await ui.click('#nav-devices');

    await ui.click('#device-kitchen');

    await expect.poll(() => fake.requestsFor('PUT', '/v1/me/player').length).toBe(1);
    expect(fake.requestsFor('PUT', '/v1/me/player')[0]?.body).toEqual({ device_ids: ['kitchen'], play: true });
    await expect(ui.locator('#device-kitchen')).toContainText('Playing here');
  });

  test('after moving playback away, the bar names the other device even while the player reports a pause', async ({ start, fake }) => {
    scriptDevices(fake);
    const { app, ui } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#login');
    await waitForPlayerReady(app);
    await inHost(app, 'window.__stub.startPlaying()');
    await expect(ui.locator('#toggle')).toHaveAttribute('aria-label', 'Pause');
    // Spotify reports the new device only after a moment: first nothing, then the kitchen speaker.
    const kitchen = {
      device: { id: 'kitchen', name: 'Kitchen speaker', type: 'Speaker', is_active: true, is_restricted: false, is_private_session: false, volume_percent: 40, supports_volume: true },
      repeat_state: 'off',
      shuffle_state: false,
      context: null,
      timestamp: 0,
      progress_ms: 1_000,
      is_playing: true,
      currently_playing_type: 'track',
      item: { type: 'track', id: 'k1', name: 'E2E Song One', uri: 'spotify:track:k1', duration_ms: 240_000, explicit: false, artists: [{ id: 'a', name: 'E2E Artist', uri: 'spotify:artist:a' }], album: { id: 'al', name: 'Album', uri: 'spotify:album:al', artists: [], images: [] } },
    };
    fake.on('GET', '/v1/me/player', { status: 204 }, { status: 200, body: kitchen });
    await ui.click('#nav-devices');

    await ui.click('#device-kitchen');
    // What the real SDK may do when another device takes over: it reports this player paused, not gone, and can go on
    // reporting the playback (now on the other device) as playing (smoke tests, 2026-10-08).
    await inHost(app, "window.__stub.emit('player_state_changed', { ...window.__stub.state(), paused: true })");
    await expect(ui.locator('#device')).toHaveText(/Playing on Kitchen speaker/);
    await inHost(app, "window.__stub.emit('player_state_changed', { ...window.__stub.state(), paused: false })");

    // Spotify still names the kitchen speaker, so the bar does too.
    await expect.poll(() => fake.requestsFor('GET', '/v1/me/player').length).toBeGreaterThan(2);
    await expect(ui.locator('#device')).toHaveText(/Playing on Kitchen speaker/);
  });

  test('the bar picker brings playback back to this computer', async ({ start, fake }) => {
    scriptDevices(fake, 'kitchen');
    const { app, ui } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#login');
    await waitForPlayerReady(app);

    await ui.click('#devicePicker');
    await expect(ui.locator('#pick-kitchen')).toContainText('Playing here');
    await ui.click('#pick-this');

    await expect.poll(() => fake.requestsFor('PUT', '/v1/me/player').length).toBe(1);
    expect(fake.requestsFor('PUT', '/v1/me/player')[0]?.body).toMatchObject({ device_ids: ['e2e-device'] });
    // The picker closes once the move is done.
    await expect(ui.locator('.popover')).toHaveCount(0);
  });

  test('the picker closes with Escape and gives focus back to its button', async ({ start, fake }) => {
    scriptDevices(fake);
    const { app, ui } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#login');
    await waitForPlayerReady(app);

    await ui.click('#devicePicker');
    await expect(ui.locator('.popover')).toBeVisible();
    await ui.keyboard.press('Escape');

    await expect(ui.locator('.popover')).toHaveCount(0);
    await expect(ui.locator('#devicePicker')).toBeFocused();
  });

  test('a failed transfer is explained and nothing changes', async ({ start, fake }) => {
    scriptDevices(fake);
    fake.on('PUT', '/v1/me/player', { status: 404, body: { error: { status: 404, message: 'Device not found' } } });
    const { app, ui } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#login');
    await waitForPlayerReady(app);
    await ui.click('#nav-devices');

    await ui.click('#device-kitchen');

    await expect(ui.locator('.error-text')).toHaveText('Could not move playback to that device.', { timeout: 20_000 });
    await expect(ui.locator('#device-this')).toContainText('Playing here');
  });
});
