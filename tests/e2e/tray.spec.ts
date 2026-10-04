import { execFileSync, spawn } from 'node:child_process';
import * as path from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { expect, test } from './fixtures';
import { TEST_CLIENT_ID, inHost, stubCommands, uiWindow, waitForPlayerReady, windowCounts } from './harness';

interface TrayHooks {
  clickTray: () => void;
  trayMenu: () => ({ kind: 'label'; label: string } | { kind: 'separator' } | { kind: 'action'; label: string; action: string; enabled: boolean })[];
  trayTooltip: () => string | null;
  clickTrayItem: (action: string) => void;
}

/** The tray menu as "label" or "label (off)" lines, separators left out. */
async function trayLines(app: ElectronApplication): Promise<string[]> {
  const items = await app.evaluate(() => (globalThis as unknown as { __playlishE2E: TrayHooks }).__playlishE2E.trayMenu());
  return items.filter((i) => i.kind !== 'separator').map((i) => (i.kind === 'action' && !i.enabled ? `${i.label} (off)` : i.label));
}

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

  test('the tray menu shows what plays and controls it', async ({ start }) => {
    const { app, ui } = await start({ clientId: TEST_CLIENT_ID });
    expect(await trayLines(app)).toEqual(['Nothing playing', 'Play (off)', 'Next (off)', 'Previous (off)', 'Open Playlish', 'Quit']);
    await ui.click('#login');
    await waitForPlayerReady(app);
    await inHost(app, 'window.__stub.startPlaying()');

    await expect.poll(() => trayLines(app)).toEqual(['▶ E2E Song One – E2E Artist', 'Pause', 'Next', 'Previous', 'Open Playlish', 'Quit']);
    expect(await app.evaluate(() => (globalThis as unknown as { __playlishE2E: TrayHooks }).__playlishE2E.trayTooltip())).toBe('Playlish – E2E Song One – E2E Artist');

    await app.evaluate(() => (globalThis as unknown as { __playlishE2E: TrayHooks }).__playlishE2E.clickTrayItem('next'));
    await expect.poll(async () => (await stubCommands(app)).map((c) => c.method)).toContain('nextTrack');
    await app.evaluate(() => (globalThis as unknown as { __playlishE2E: TrayHooks }).__playlishE2E.clickTrayItem('toggle'));
    await expect.poll(() => trayLines(app)).toContain('Play');
  });

  test('with "keep running in the tray" off, closing the window quits', async ({ start }) => {
    const { app, ui } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#nav-settings');
    await ui.uncheck('#prefCloseToTray');
    await expect(ui.locator('#prefCloseToTray')).not.toBeChecked();

    const exited = new Promise<number | null>((resolve) => app.process().once('exit', (code) => resolve(code)));
    await closeMainWindow(app);

    expect(await exited).toBe(0);
  });

  test('minimize to tray closes the window but keeps the app and player', async ({ start }) => {
    const { app, ui } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#login');
    await waitForPlayerReady(app);
    await ui.click('#nav-settings');
    await ui.check('#prefMinimizeToTray');

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()
        .find((w) => !w.isDestroyed() && w.webContents.getURL().endsWith('/ui.html'))
        ?.minimize();
    });

    await expect.poll(() => windowCounts(app)).toEqual({ all: 1, hosts: 1 });
  });

  test('"start in the tray" opens no window on the next start', async ({ start }) => {
    const first = await start({ clientId: TEST_CLIENT_ID });
    await first.ui.click('#nav-settings');
    await first.ui.check('#prefStartMinimized');
    await first.app.close();

    const second = await start({ clientId: TEST_CLIENT_ID, userDataDir: first.userDataDir, trayOnly: false, expectWindow: false });
    await new Promise((resolve) => setTimeout(resolve, 1500));
    expect(await windowCounts(second.app)).toEqual({ all: 0, hosts: 0 });
    await clickTray(second.app);
    await uiWindow(second.app);
  });

  test('starting Playlish again brings the running one back instead of a second copy', async ({ start }) => {
    const { app, userDataDir } = await start({ clientId: TEST_CLIENT_ID });
    await closeMainWindow(app);
    await expect.poll(() => windowCounts(app)).toEqual({ all: 0, hosts: 0 });

    const exe = path.join(__dirname, '..', '..', 'node_modules', 'electron', 'dist', 'electron.exe');
    const second = spawn(exe, ['.', `--user-data-dir=${userDataDir}`], { cwd: path.join(__dirname, '..', '..'), stdio: 'ignore' });
    const secondExit = await new Promise<number | null>((resolve) => second.once('exit', (code) => resolve(code)));

    expect(secondExit).toBe(0);
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
