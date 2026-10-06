import { execFileSync, spawn } from 'node:child_process';
import * as path from 'node:path';
import type { ElectronApplication } from '@playwright/test';
import { expect, test } from './fixtures';
import { TEST_CLIENT_ID, inHost, stubCommands, uiWindow, waitForPlayerReady, windowCounts } from './harness';

type TrayItem =
  | { kind: 'label'; label: string }
  | { kind: 'separator' }
  | { kind: 'action'; label: string; action: string; enabled: boolean }
  | { kind: 'submenu'; label: string; items: TrayItem[] }
  | { kind: 'output'; label: string; output: string | null; checked: boolean };

interface TrayHooks {
  clickTray: () => void;
  trayMenu: () => TrayItem[];
  trayTooltip: () => string | null;
  clickTrayItem: (action: string) => void;
  clickTrayOutput: (label: string) => void;
}

/** The "Play on" submenu as "label" or "label (checked)" lines, or null when the menu has none. */
async function trayOutputs(app: ElectronApplication): Promise<string[] | null> {
  const items = await app.evaluate(() => (globalThis as unknown as { __playlishE2E: TrayHooks }).__playlishE2E.trayMenu());
  const menu = items.find((i) => i.kind === 'submenu' && i.label === 'Play on');
  if (menu?.kind !== 'submenu') return null;
  return menu.items.map((i) => (i.kind === 'output' && i.checked ? `${i.label} (checked)` : i.kind === 'separator' ? '---' : i.label));
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

    // The playback host has reported its outputs by now, so the menu also offers "Play on" (#89).
    await expect.poll(() => trayLines(app)).toEqual(['▶ E2E Song One – E2E Artist', 'Pause', 'Next', 'Previous', 'Play on', 'Open Playlish', 'Quit']);
    expect(await app.evaluate(() => (globalThis as unknown as { __playlishE2E: TrayHooks }).__playlishE2E.trayTooltip())).toBe('Playlish – E2E Song One – E2E Artist');

    await app.evaluate(() => (globalThis as unknown as { __playlishE2E: TrayHooks }).__playlishE2E.clickTrayItem('next'));
    await expect.poll(async () => (await stubCommands(app)).map((c) => c.method)).toContain('nextTrack');
    await app.evaluate(() => (globalThis as unknown as { __playlishE2E: TrayHooks }).__playlishE2E.clickTrayItem('toggle'));
    await expect.poll(() => trayLines(app)).toContain('Play');
  });

  test('the tray menu chooses the output device (#89)', async ({ start }) => {
    const { app, ui } = await start({ clientId: TEST_CLIENT_ID });
    // No "Play on" before the playback host has said which outputs exist.
    expect(await trayOutputs(app)).toBeNull();
    await ui.click('#login');
    await waitForPlayerReady(app);
    await expect.poll(() => trayOutputs(app)).not.toBeNull();
    // A known list in place of whatever this machine has, through the same bridge the host page uses.
    await inHost(app, "window.host.outputs(['E2E Speakers', 'E2E Headphones'])");
    await expect.poll(() => trayOutputs(app)).toEqual(['System default (checked)', 'E2E Headphones', 'E2E Speakers']);

    await app.evaluate(() => (globalThis as unknown as { __playlishE2E: TrayHooks }).__playlishE2E.clickTrayOutput('E2E Headphones'));

    await expect.poll(() => trayOutputs(app)).toEqual(['System default', 'E2E Headphones (checked)', 'E2E Speakers']);
    await ui.click('#nav-settings');
    await expect(ui.locator('#outputDevice')).toHaveValue('E2E Headphones');

    // Unplugged: still shown as the choice, marked as not connected.
    await inHost(app, "window.host.outputs(['E2E Speakers'])");
    await expect.poll(() => trayOutputs(app)).toEqual(['System default', 'E2E Speakers', 'E2E Headphones (not connected) (checked)']);
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
        // The minimize event itself: the hidden desktop of a CI runner does not always minimize a window.
        ?.emit('minimize');
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
