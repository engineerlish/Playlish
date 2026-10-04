import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { expect, test } from './fixtures';
import { TEST_CLIENT_ID, logEntries } from './harness';

/*
 * The Equalizer APO integration (#91) against a fake config folder (test mode reads it from PLAYLISH_E2E_EQ_DIR
 * instead of the registry). The one-time Windows prompt is never clicked here: it would ask for administrator rights.
 */
const USER_CONFIG = 'Preamp: -2 dB\r\nGraphicEQ: 100 1\r\n';

function fakeApo(): { dir: string; config: string; own: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playlish-eqapo-'));
  const config = path.join(dir, 'config.txt');
  fs.writeFileSync(config, USER_CONFIG);
  return { dir, config, own: path.join(dir, 'playlish.txt') };
}

test.describe('equalizer', () => {
  test('without Equalizer APO, Settings explains it and links to its download', async ({ start }) => {
    const { ui, userDataDir } = await start({ clientId: TEST_CLIENT_ID });
    await ui.click('#nav-settings');

    await expect(ui.locator('#eqNotInstalled')).toBeVisible();
    await ui.click('#eqDownload');
    await expect.poll(() => logEntries(userDataDir, 'E2E_OPEN_EXTERNAL').map((e) => (e['context'] as { host: string }).host)).toContain('sourceforge.net');
  });

  test('on, presets, custom gains and off: only Playlish file and line, and config.txt comes back as it was', async ({ start }) => {
    const apo = fakeApo();
    const { ui } = await start({ clientId: TEST_CLIENT_ID, eqDir: apo.dir });
    await ui.click('#nav-settings');
    await expect(ui.locator('#eqEnabled')).not.toBeChecked();
    expect(fs.existsSync(apo.own)).toBe(false);

    await ui.check('#eqEnabled');
    await expect.poll(() => fs.existsSync(apo.own) && fs.readFileSync(apo.config, 'utf8')).toBe(`${USER_CONFIG}Include: playlish.txt\r\n`);
    expect(fs.readFileSync(`${apo.config}.playlish-backup`, 'utf8')).toBe(USER_CONFIG);
    expect(fs.readFileSync(apo.own, 'utf8')).toContain('GraphicEQ: 31 0;');

    await ui.selectOption('#eqPreset', 'bassBoost');
    await expect.poll(() => fs.readFileSync(apo.own, 'utf8')).toContain('GraphicEQ: 31 6; 62 5; 125 4;');
    expect(fs.readFileSync(apo.own, 'utf8')).toContain('Preamp: -6 dB');

    await ui.selectOption('#eqPreset', 'custom');
    await ui.getByRole('slider', { name: '16k Hz' }).fill('-4');
    await expect.poll(() => fs.readFileSync(apo.own, 'utf8')).toContain('16000 -4');

    await ui.uncheck('#eqEnabled');
    await expect.poll(() => fs.existsSync(apo.own)).toBe(false);
    expect(fs.readFileSync(apo.config, 'utf8')).toBe(USER_CONFIG);
    fs.rmSync(apo.dir, { recursive: true, force: true });
  });

  test('a config folder Playlish cannot write asks for the one-time Windows permission', async ({ start }) => {
    const apo = fakeApo();
    fs.chmodSync(apo.config, 0o444); // read-only, like Program Files for a normal user
    const { ui } = await start({ clientId: TEST_CLIENT_ID, eqDir: apo.dir });
    await ui.click('#nav-settings');

    await ui.check('#eqEnabled');

    await expect(ui.locator('#eqSetup')).toBeVisible();
    expect(fs.readFileSync(apo.config, 'utf8')).toBe(USER_CONFIG);
    fs.chmodSync(apo.config, 0o644);
    fs.rmSync(apo.dir, { recursive: true, force: true });
  });
});
