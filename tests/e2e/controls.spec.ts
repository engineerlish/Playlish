import type { ElectronApplication, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { TEST_CLIENT_ID, inHost, stubCommands, waitForPlayerReady } from './harness';

/** Logs in, waits for the player and starts playback. */
async function playing(start: (o: { clientId: string }) => Promise<{ app: ElectronApplication; ui: Page }>) {
  const launched = await start({ clientId: TEST_CLIENT_ID });
  await launched.ui.click('#login');
  await waitForPlayerReady(launched.app);
  await inHost(launched.app, 'window.__stub.startPlaying()');
  await expect(launched.ui.locator('#toggle')).toHaveAttribute('aria-label', 'Pause');
  return launched;
}

/** Waits until the stub has received a call to `method`, and returns all calls. */
async function expectCall(app: ElectronApplication, method: string) {
  await expect.poll(async () => (await stubCommands(app)).map((c) => c.method)).toContain(method);
  return stubCommands(app);
}

test.describe('Now Playing controls', () => {
  test('play/pause, next and previous send the matching player commands', async ({ start }) => {
    const { app, ui } = await playing(start);

    await ui.click('#toggle');
    await expectCall(app, 'togglePlay');
    await ui.click('#next');
    await expectCall(app, 'nextTrack');
    await expect(ui.locator('#track')).toHaveText('E2E Song Two');
    await ui.click('#prev');
    await expectCall(app, 'previousTrack');
    await expect(ui.locator('#track')).toHaveText('E2E Song One');

    expect((await stubCommands(app)).map((c) => c.method)).toEqual(['togglePlay', 'nextTrack', 'previousTrack']);
  });

  test('the volume slider sets the player volume', async ({ start }) => {
    const { app, ui } = await playing(start);

    await ui.locator('#volume').fill('30');

    await expect.poll(() => inHost<number>(app, 'window.__stub.volume()')).toBeCloseTo(0.3, 5);
  });

  test('the fade button fades out and pauses, then fades back in', async ({ start }) => {
    const { app, ui } = await playing(start);
    await ui.locator('#volume').fill('80');
    await expect.poll(() => inHost<number>(app, 'window.__stub.volume()')).toBeCloseTo(0.8, 5);

    await ui.click('#fade');
    const out = await expectCall(app, 'pause');
    const rampDown = out.filter((c) => c.method === 'setVolume').map((c) => c.args[0] as number);
    // Several steps going down to (almost) silence, then the user's volume is restored for the next play.
    expect(rampDown.length).toBeGreaterThan(3);
    expect(Math.min(...rampDown)).toBeLessThan(0.05);
    await expect(ui.locator('#toggle')).toHaveAttribute('aria-label', 'Play');

    await ui.click('#fade');
    await expectCall(app, 'resume');
    await expect.poll(() => inHost<number>(app, 'window.__stub.volume()'), { timeout: 10_000 }).toBeCloseTo(0.8, 5);
    await expect(ui.locator('#toggle')).toHaveAttribute('aria-label', 'Pause');
  });
});
