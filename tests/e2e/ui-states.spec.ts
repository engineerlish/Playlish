import * as fs from 'node:fs';
import * as path from 'node:path';
import { expect, test } from './fixtures';
import { TEST_CLIENT_ID, inHost, waitForPlayerReady } from './harness';

test.describe('main window states', () => {
  test('logged out: the app asks for a login and the player controls are disabled', async ({ start }) => {
    const { ui } = await start({ clientId: TEST_CLIENT_ID });

    await expect(ui.locator('#status')).toHaveText('Not logged in.');
    await expect(ui.locator('#login')).toBeVisible();
    await expect(ui.locator('#toggle')).toBeDisabled();
    await expect(ui.locator('#volume')).toBeDisabled();
  });

  test('ready: nothing plays by itself, and Play resumes the last playback on this device', async ({ start, fake }) => {
    const { app, ui } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#login');
    await waitForPlayerReady(app);

    await expect(ui.locator('#status')).toHaveText('Player ready.');
    await expect(ui.locator('#track')).toHaveText('Nothing playing');
    expect(fake.requestsFor('PUT', '/v1/me/player/play')).toHaveLength(0);

    await ui.click('#toggle');
    await expect.poll(() => fake.requestsFor('PUT', '/v1/me/player/play').length).toBe(1);
    const [play] = fake.requestsFor('PUT', '/v1/me/player/play');
    expect(play?.query.get('device_id')).toBe('e2e-device');
    expect(play?.headers.authorization).toBe('Bearer e2e-access-token');
    // A resume of whatever the account played last, not a specific track.
    expect(play?.body).toBeUndefined();
  });

  test('playing and paused: the Now Playing bar follows the player', async ({ start }) => {
    const { app, ui } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#login');
    await waitForPlayerReady(app);

    await inHost(app, `window.__stub.startPlaying('E2E Song Two')`);
    await expect(ui.locator('#track')).toHaveText('E2E Song Two');
    await expect(ui.locator('#artists')).toHaveText('E2E Artist');
    await expect(ui.locator('#toggle')).toHaveAttribute('aria-label', 'Pause');

    await ui.click('#toggle');
    await expect(ui.locator('#toggle')).toHaveAttribute('aria-label', 'Play');
    const paused = await ui.locator('#seek').inputValue();
    await ui.waitForTimeout(700);
    expect(await ui.locator('#seek').inputValue()).toBe(paused);
  });

  test('player error: an account Spotify refuses gets a plain explanation', async ({ start }) => {
    const { app, ui } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#login');
    await waitForPlayerReady(app);

    await inHost(app, `window.__stub.emit('account_error', { message: 'This functionality is restricted to premium users only' })`);

    await expect(ui.locator('#status')).toHaveText('Spotify rejected this account for playback. Premium is required.');
  });

  test('session expired: a refused stored session is deleted and the app asks for a new login', async ({ start, fake }) => {
    const first = await start({ clientId: TEST_CLIENT_ID });
    await first.ui.click('#login');
    await waitForPlayerReady(first.app);
    await first.app.close();
    const stored = path.join(first.userDataDir, 'refresh-token.bin');
    expect(fs.existsSync(stored)).toBe(true);

    fake.on('POST', '/api/token', { status: 400, body: { error: 'invalid_grant', error_description: 'Refresh token revoked' } });
    const second = await start({ clientId: TEST_CLIENT_ID, userDataDir: first.userDataDir });

    await expect(second.ui.locator('#status')).toContainText('session expired');
    await expect(second.ui.locator('#login')).toBeVisible();
    expect(fs.existsSync(stored)).toBe(false);
  });

  test('sidebar: pages switch with clicks and Alt+number, and the last page is remembered', async ({ start }) => {
    const first = await start({ clientId: TEST_CLIENT_ID });
    // Logged out, every page but Settings shows the login prompt, so log in first.
    await first.ui.click('#login');
    await waitForPlayerReady(first.app);
    await first.ui.click('#nav-search');
    await expect(first.ui.locator('#page-search')).toBeVisible();
    await first.ui.keyboard.press('Alt+5');
    await expect(first.ui.locator('#page-settings')).toBeVisible();
    await expect(first.ui.locator('#nav-settings')).toHaveAttribute('aria-current', 'page');
    await first.app.close();

    const second = await start({ clientId: TEST_CLIENT_ID, userDataDir: first.userDataDir });
    await expect(second.ui.locator('#page-settings')).toBeVisible();
  });
});
