import { expect, test } from './fixtures';
import { TEST_CLIENT_ID, logEntries } from './harness';

/*
 * Plugins page shell and safe mode (#50). The restart buttons are not clicked: app.relaunch() would start a copy of
 * Playlish outside the test's control. The flag they pass is unit tested (relaunchArgs).
 */
test.describe('plugins', () => {
  test('lists no plugins yet and offers safe mode, even before logging in', async ({ start }) => {
    const { ui, userDataDir } = await start({ clientId: TEST_CLIENT_ID });

    await ui.click('#nav-plugins');

    await expect(ui.locator('#noPlugins')).toHaveText('No plugins installed.');
    await expect(ui.locator('#restartSafe')).toBeVisible();
    await expect(ui.locator('#safeModeBanner')).toHaveCount(0);
    expect(logEntries(userDataDir, 'SAFE_MODE')).toHaveLength(0);
  });

  test('--safe-mode starts with plugins off and says so', async ({ start }) => {
    const { ui, userDataDir } = await start({ clientId: TEST_CLIENT_ID, safeMode: true });

    await ui.click('#nav-plugins');

    await expect(ui.locator('#safeModeBanner')).toContainText('all plugins are off');
    await expect(ui.locator('#restartNormal')).toBeVisible();
    await expect(ui.locator('#restartSafe')).toHaveCount(0);
    expect(logEntries(userDataDir, 'SAFE_MODE')).toHaveLength(1);
  });
});
