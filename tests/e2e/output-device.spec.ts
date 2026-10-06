import { expect, test } from './fixtures';
import { TEST_CLIENT_ID, inHost, logEntries, waitForPlayerReady } from './harness';

/*
 * Output device selection (#89). Test machines may have no sound devices, so a device that does not exist is chosen:
 * that covers the plumbing (setting, injection into the playback frames, fallback) without real hardware. Real
 * switching is checked by the smoke test on the owner's machine.
 */
const MISSING = 'E2E Speakers That Are Not Here';

test.describe('output device', () => {
  test('the hook is in the playback frame and tracks the elements that play', async ({ start }) => {
    const { app, ui } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#login');
    await waitForPlayerReady(app);

    await expect.poll(() => inHost<boolean>(app, 'Boolean(window.__playlishOutput)')).toBe(true);
    const tracked = await inHost<number>(app, `(() => { const a = new Audio(); a.play().catch(() => {}); return window.__playlishOutput.elements.size; })()`);
    expect(tracked).toBeGreaterThanOrEqual(1);
  });

  test('a chosen device that is not connected falls back to the default and says so; the choice is remembered', async ({ start }) => {
    const first = await start({ clientId: TEST_CLIENT_ID });
    await first.ui.click('#login');
    await waitForPlayerReady(first.app);
    await first.ui.click('#nav-settings');
    await expect(first.ui.locator('#outputDevice')).toHaveValue('');

    await first.ui.evaluate((name) => (window as unknown as { ui: { setOutput(n: string | null): void } }).ui.setOutput(name), MISSING);

    await expect(first.ui.locator('#outputMissing')).toBeVisible();
    await expect(first.ui.locator('#outputDevice')).toHaveValue(MISSING);
    await expect.poll(() => inHost<string | null>(first.app, 'window.__playlishOutput.label')).toBe(MISSING);
    await expect.poll(() => logEntries(first.userDataDir, 'OUTPUT_DEVICE_MISSING').length).toBeGreaterThan(0);
    await first.app.close();

    // The login is remembered too, so the player starts by itself.
    const second = await start({ clientId: TEST_CLIENT_ID, userDataDir: first.userDataDir });
    await waitForPlayerReady(second.app);
    await expect.poll(() => inHost<string | null>(second.app, 'window.__playlishOutput?.label ?? null')).toBe(MISSING);

    await second.ui.click('#nav-settings');
    await second.ui.selectOption('#outputDevice', '');
    await expect.poll(() => inHost<string | null>(second.app, 'window.__playlishOutput.label')).toBeNull();
    await expect(second.ui.locator('#outputMissing')).toHaveCount(0);
  });
});

test.describe('volume per output device (#90)', () => {
  test('each output keeps its own volume, restored when switching and after a restart', async ({ start }) => {
    const first = await start({ clientId: TEST_CLIENT_ID });
    await first.ui.click('#login');
    await waitForPlayerReady(first.app);
    await inHost(first.app, 'window.__stub.startPlaying()');
    const stubVolume = (app: typeof first.app) => inHost<number>(app, 'window.__stub.volume()');
    const setOutput = (name: string | null) => first.ui.evaluate((n) => (window as unknown as { ui: { setOutput(n: string | null): void } }).ui.setOutput(n), name);

    await first.ui.locator('#volume').fill('30');
    await expect.poll(() => stubVolume(first.app)).toBeCloseTo(0.3, 5);
    await setOutput(MISSING);
    // A device with no remembered volume keeps the current one.
    await first.ui.waitForTimeout(300);
    expect(await stubVolume(first.app)).toBeCloseTo(0.3, 5);
    await first.ui.locator('#volume').fill('80');
    await expect.poll(() => stubVolume(first.app)).toBeCloseTo(0.8, 5);

    await setOutput(null);
    await expect.poll(() => stubVolume(first.app)).toBeCloseTo(0.3, 5);
    await setOutput(MISSING);
    await expect.poll(() => stubVolume(first.app)).toBeCloseTo(0.8, 5);
    await first.app.close();

    // After a restart the player starts at the volume remembered for the chosen output.
    const second = await start({ clientId: TEST_CLIENT_ID, userDataDir: first.userDataDir });
    await waitForPlayerReady(second.app);
    await expect.poll(() => stubVolume(second.app)).toBeCloseTo(0.8, 5);
  });
});
