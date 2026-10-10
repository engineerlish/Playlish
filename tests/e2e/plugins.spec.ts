import * as fs from 'node:fs';
import * as path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import axe from 'axe-core';
import { makePackage } from '../helpers/zip';
import { expect, test } from './fixtures';
import { TEST_CLIENT_ID, logEntries } from './harness';

/*
 * The plugin manager (#101) and safe mode (#50). Packages are built by the test and picked through the real file dialog
 * code, with Electron's dialog answered by the test. The restart buttons are not clicked: app.relaunch() would start a
 * copy of Playlish outside the test's control (the flag they pass is unit tested in relaunchArgs).
 */

/** Writes a package next to the profile and makes the next file dialog pick it. */
async function offerPackage(app: ElectronApplication, userDataDir: string, name: string, data: Buffer): Promise<void> {
  const file = path.join(path.dirname(userDataDir), `${path.basename(userDataDir)}-${name}`);
  fs.writeFileSync(file, data);
  await app.evaluate(({ dialog }, picked) => {
    dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [picked] });
  }, file);
}

/** How many plugin-host processes run (it only exists while a plugin is on). */
async function pluginProcesses(app: ElectronApplication): Promise<number> {
  return app.evaluate(({ app: a }) => a.getAppMetrics().filter((m) => m.type === 'Utility' && m.name === 'Playlish plugins').length);
}

/** Lines the plugins wrote to plugins.log. */
function pluginLog(userDataDir: string): string {
  const file = path.join(userDataDir, 'logs', 'plugins.log');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

/** WCAG A and AA violations on the page, as readable lines. */
async function violations(page: Page): Promise<string[]> {
  await page.evaluate(axe.source);
  const results = await page.evaluate(() =>
    (window as unknown as { axe: typeof axe }).axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } }),
  );
  return results.violations.map((v) => `${v.id}: ${v.help} — ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

const HELLO = "playlish.log('hello from the sandbox');";
const row = '#plugin-com-example-hello';

test.describe('plugins', () => {
  test('lists no plugins yet and offers safe mode, even before logging in', async ({ start }) => {
    const { app, ui, userDataDir } = await start({ clientId: TEST_CLIENT_ID });

    await ui.click('#nav-plugins');

    await expect(ui.locator('#noPlugins')).toHaveText('No plugins installed.');
    await expect(ui.locator('#restartSafe')).toBeVisible();
    await expect(ui.locator('#safeModeBanner')).toHaveCount(0);
    expect(logEntries(userDataDir, 'SAFE_MODE')).toHaveLength(0);
    expect(await pluginProcesses(app)).toBe(0);
  });

  test('install after the prompt, run, turn off and on, update with a new permission, uninstall', async ({ start }) => {
    const { app, ui, userDataDir } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#nav-plugins');
    expect(await pluginProcesses(app)).toBe(0);

    // Install: the prompt first, nothing installed until approved.
    await offerPackage(app, userDataDir, 'hello.playlish', makePackage({}, HELLO));
    await ui.click('#installPlugin');
    await expect(ui.locator('#pluginPromptTitle')).toHaveText('Install Hello 1.0.0?');
    await expect(ui.locator('#pluginPromptTitle')).toBeFocused();
    await expect(ui.locator('#promptPermissions')).toHaveText('See what is playing and on which device');
    expect(await violations(ui)).toEqual([]);
    await expect(ui.locator('#noPlugins')).toBeVisible();
    await ui.click('#approvePlugin');

    // Installed, on, and really running in the plugin process.
    await expect(ui.locator(`${row} .plugin-name`)).toHaveText('Hello');
    await expect(ui.locator(`${row} .plugin-enabled`)).toBeChecked();
    await expect(ui.locator('#pluginPrompt')).toHaveCount(0);
    await expect.poll(() => pluginLog(userDataDir)).toContain('hello from the sandbox');
    await expect.poll(() => pluginProcesses(app)).toBe(1);
    expect(fs.existsSync(path.join(userDataDir, 'plugins', 'com.example.hello', 'main.js'))).toBe(true);

    // Off: the plugin process goes away. On: it comes back.
    await ui.locator(`${row} .plugin-enabled`).uncheck();
    await expect.poll(() => pluginProcesses(app)).toBe(0);
    await ui.locator(`${row} .plugin-enabled`).check();
    await expect.poll(() => pluginProcesses(app)).toBe(1);

    // An update that asks for more: the new permission is marked, and nothing changes until approved.
    await offerPackage(app, userDataDir, 'hello-1.1.playlish', makePackage({ version: '1.1.0', permissions: ['playback.read', 'storage'] }, HELLO));
    await ui.click('#installPlugin');
    await expect(ui.locator('#pluginPromptTitle')).toHaveText('Update Hello from 1.0.0 to 1.1.0?');
    await expect(ui.locator('#promptPermissions li')).toHaveText([
      'See what is playing and on which device',
      'Keep a small amount of its own data on this computer (deleted when you uninstall it)new',
    ]);
    await ui.click('#cancelPlugin');
    await expect(ui.locator(`${row} .muted`).first()).toHaveText('1.0.0');
    await ui.click('#installPlugin');
    await ui.click('#approvePlugin');
    await expect(ui.locator(`${row} .muted`).first()).toHaveText('1.1.0');
    await expect(ui.locator(`${row} .plugin-permissions`)).toContainText('keep a small amount of its own data');

    // Uninstall asks first, then removes the files and the plugin's storage, and stops the process.
    fs.mkdirSync(path.join(userDataDir, 'plugin-data', 'com.example.hello'), { recursive: true });
    await ui.locator(`${row} .uninstall`).click();
    await ui.locator(`${row} .keep-plugin`).click();
    await expect(ui.locator(row)).toBeVisible();
    await ui.locator(`${row} .uninstall`).click();
    await ui.locator(`${row} .confirm-uninstall`).click();
    await expect(ui.locator('#noPlugins')).toBeVisible();
    await expect.poll(() => pluginProcesses(app)).toBe(0);
    expect(fs.existsSync(path.join(userDataDir, 'plugins', 'com.example.hello'))).toBe(false);
    expect(fs.existsSync(path.join(userDataDir, 'plugin-data', 'com.example.hello'))).toBe(false);
  });

  test('a broken package is explained, and a plugin that fails to start is turned off with the reason', async ({ start }) => {
    const { app, ui, userDataDir } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#nav-plugins');

    await offerPackage(app, userDataDir, 'evil.playlish', makePackage({ id: '../evil' }));
    await ui.click('#installPlugin');
    await expect(ui.locator('#pluginError')).toContainText('manifest is not valid');
    await expect(ui.locator('#pluginPrompt')).toHaveCount(0);
    await ui.click('#dismissPluginError');
    await expect(ui.locator('#pluginError')).toHaveCount(0);

    await offerPackage(app, userDataDir, 'broken.playlish', makePackage({}, 'this is not javascript ('));
    await ui.click('#installPlugin');
    await ui.click('#approvePlugin');

    await expect(ui.locator(`${row} .plugin-disabled-reason`)).toContainText('failed to start');
    await expect(ui.locator(`${row} .plugin-enabled`)).not.toBeChecked();
    await expect.poll(() => pluginProcesses(app)).toBe(0);
  });

  test('an installed plugin starts with Playlish, and --safe-mode keeps it off', async ({ start }) => {
    const first = await start({ clientId: TEST_CLIENT_ID });
    await first.ui.click('#nav-plugins');
    await offerPackage(first.app, first.userDataDir, 'hello.playlish', makePackage({}, HELLO));
    await first.ui.click('#installPlugin');
    await first.ui.click('#approvePlugin');
    await expect.poll(() => pluginProcesses(first.app)).toBe(1);
    await first.app.close();

    const again = await start({ clientId: TEST_CLIENT_ID, userDataDir: first.userDataDir });
    await expect.poll(() => pluginProcesses(again.app)).toBe(1);
    await again.app.close();

    const safe = await start({ clientId: TEST_CLIENT_ID, userDataDir: first.userDataDir, safeMode: true });
    await safe.ui.click('#nav-plugins');
    await expect(safe.ui.locator('#safeModeBanner')).toContainText('all plugins are off');
    await expect(safe.ui.locator('#restartNormal')).toBeVisible();
    await expect(safe.ui.locator('#restartSafe')).toHaveCount(0);
    await expect(safe.ui.locator(row)).toContainText('Not running: safe mode.');
    expect(logEntries(safe.userDataDir, 'SAFE_MODE')).toHaveLength(1);
    // Give a plugin time to start if it were going to.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await pluginProcesses(safe.app)).toBe(0);
  });
});
