import { execFileSync } from 'node:child_process';
import type { ElectronApplication } from '@playwright/test';
import { expect, test } from './fixtures';
import { TEST_CLIENT_ID, uiWindow, waitForPlayerReady, windowCounts } from './harness';

/** Clicks the tray icon (through the test-mode hook: Playwright cannot reach the notification area). */
async function clickTray(app: ElectronApplication): Promise<void> {
  await app.evaluate(() => (globalThis as unknown as { __playlishE2E: { clickTray: () => void } }).__playlishE2E.clickTray());
}

/** Closes the main window the way the title-bar X does. */
async function closeMainWindow(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()
      .find((w) => !w.isDestroyed() && w.webContents.getURL().endsWith('/ui.html'))
      ?.close();
  });
}

/** Process ids of every Playlish process (main and helpers) that runs with this profile. Windows only. */
function processesFor(userDataDir: string): number[] {
  const script = `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${userDataDir.replace(/'/g, "''")}*' } | ForEach-Object { $_.ProcessId }`;
  const out = execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  return out.split(/\s+/).filter(Boolean).map(Number);
}

test.describe('tray', () => {
  test('closing the window keeps the app and the player running', async ({ start }) => {
    const { app, ui } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#login');
    await waitForPlayerReady(app);

    await closeMainWindow(app);

    await expect.poll(() => windowCounts(app)).toEqual({ all: 1, hosts: 1 });
  });

  test('clicking the tray icon reopens the window', async ({ start }) => {
    const { app } = await start({ clientId: TEST_CLIENT_ID });
    await closeMainWindow(app);
    await expect.poll(() => windowCounts(app)).toEqual({ all: 0, hosts: 0 });

    await clickTray(app);

    const ui = await uiWindow(app);
    await expect(ui.locator('#status')).toHaveText('Not logged in.');
  });

  test('starting in the tray opens no window until the icon is clicked', async ({ start }) => {
    const { app } = await start({ clientId: TEST_CLIENT_ID, trayOnly: true });
    expect(await windowCounts(app)).toEqual({ all: 0, hosts: 0 });

    await clickTray(app);

    await uiWindow(app);
  });

  test('quitting ends every Playlish process', async ({ start }) => {
    test.skip(process.platform !== 'win32', 'process listing uses PowerShell');
    const { app, ui, userDataDir } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#login');
    await waitForPlayerReady(app);
    expect(processesFor(userDataDir).length).toBeGreaterThan(1);

    const exited = new Promise<number | null>((resolve) => app.process().once('exit', (code) => resolve(code)));
    await app.evaluate(({ app: electronApp }) => electronApp.quit());

    expect(await exited).toBe(0);
    await expect.poll(() => processesFor(userDataDir), { timeout: 10_000 }).toEqual([]);
  });
});
