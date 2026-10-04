import { expect, test } from './fixtures';
import { TEST_CLIENT_ID, inHost, logEntries, waitForPlayerReady, windowCounts } from './harness';

test.describe('recovery', () => {
  test('a crashed playback host is recorded and rebuilt', async ({ start }) => {
    const { app, ui, userDataDir } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#login');
    await waitForPlayerReady(app);

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith('/host.html'))
        ?.webContents.forcefullyCrashRenderer();
    });

    await expect.poll(() => logEntries(userDataDir, 'PLAYBACK_HOST_RESTART').length).toBe(1);
    // The new host is a fresh page, so the stub's call list starts again; wait for its token request.
    await waitForPlayerReady(app);
    expect(await windowCounts(app)).toMatchObject({ hosts: 1 });
    await expect(ui.locator('#toggle')).toBeEnabled();
  });

  test('repeated playback errors stop the player with a clear message instead of looping', async ({ start, fake }) => {
    const { app, ui, userDataDir } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#login');
    await waitForPlayerReady(app);
    const playsBefore = fake.requestsFor('PUT', '/v1/me/player/play').length;

    await inHost(app, `for (let i = 0; i < 3; i++) window.__stub.emit('playback_error', { message: 'Failed to perform playback' })`);

    await expect(ui.locator('#status')).toContainText('Playback failed repeatedly');
    await expect.poll(() => windowCounts(app)).toMatchObject({ hosts: 0 });
    expect(logEntries(userDataDir, 'PLAYBACK_ERROR_BURST')).toHaveLength(1);
    // Nothing retries on its own.
    await ui.waitForTimeout(1500);
    expect(fake.requestsFor('PUT', '/v1/me/player/play')).toHaveLength(playsBefore);
  });

  test('a stalled player is nudged first, then rebuilt when the nudge does not help', async ({ start }) => {
    test.slow();
    const launched = await start({ clientId: TEST_CLIENT_ID });
    const { app, ui } = launched;
    await ui.click('#login');
    await waitForPlayerReady(app);
    await inHost(app, 'window.__stub.startPlaying(); window.__stub.freeze()');

    await expect.poll(async () => (await inHost<{ method: string }[]>(app, 'window.__stub.calls')).some((c) => c.method === 'pause'), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => logEntries(launched.userDataDir, 'PLAYBACK_HOST_RESTART').length, { timeout: 30_000 }).toBe(1);
  });
});
