import * as path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BACKUP_SUFFIX, apoStatus, applyEq, elevatedSetupScript, parseRegQuery, type ApoDeps, type ApoFs } from '../src/main/eq/apo';
import { INCLUDE_LINE } from '../src/main/eq/config';

/*
 * #12: Equalizer APO integration against a fake config folder. Files live in memory; a path in `locked` cannot be
 * written (like Program Files for a normal user), and `lockedDir` makes every new file in the folder fail.
 */
const DIR = 'C:\\Program Files\\EqualizerAPO\\config';
const CONFIG = path.join(DIR, 'config.txt');
const OWN = path.join(DIR, 'playlish.txt');
const USER_CONFIG = 'Preamp: -2 dB\r\nGraphicEQ: 100 1\r\n';

function fakeFs(files: Record<string, string>, locked: string[] = [], lockedDir = false) {
  const data = new Map(Object.entries(files));
  const writable = (p: string) => !locked.includes(p) && !(lockedDir && !data.has(p));
  const fs: ApoFs = {
    existsSync: (p) => data.has(p),
    readFileSync: (p) => {
      const v = data.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    writeFileSync: (p, d) => {
      if (!writable(p)) throw new Error(`EPERM ${p}`);
      data.set(p, d);
    },
    renameSync: (from, to) => {
      if (!writable(to)) throw new Error(`EPERM ${to}`);
      const v = data.get(from);
      if (v === undefined) throw new Error(`ENOENT ${from}`);
      data.set(to, v);
      data.delete(from);
    },
    copyFileSync: (from, to) => {
      if (!writable(to)) throw new Error(`EPERM ${to}`);
      data.set(to, data.get(from) ?? '');
    },
    rmSync: (p) => {
      data.delete(p);
    },
  };
  return { fs, data };
}

const deps = (fs: ApoFs, configPath: string | null = DIR): ApoDeps => ({ configPath: () => configPath, fs });
const GAINS = [6, 5, 4, 2, 0, 0, 0, 0, 0, 0];

describe('detecting Equalizer APO', () => {
  it('reads the config folder from the registry query output', () => {
    const out = `\r\nHKEY_LOCAL_MACHINE\\SOFTWARE\\EqualizerAPO\r\n    ConfigPath    REG_SZ    ${DIR}\r\n\r\n`;
    expect(parseRegQuery(out)).toBe(DIR);
    expect(parseRegQuery('ERROR: The system was unable to find the specified registry key or value.')).toBeNull();
  });

  it('is not installed without the registry value or without config.txt', () => {
    expect(apoStatus(deps(fakeFs({}).fs, null))).toEqual({ installed: false });
    expect(apoStatus(deps(fakeFs({}).fs))).toEqual({ installed: false });
  });

  it('reports what Playlish may change', () => {
    const { fs } = fakeFs({ [CONFIG]: USER_CONFIG }, [CONFIG], true);
    expect(apoStatus(deps(fs))).toEqual({ installed: true, configPath: DIR, configWritable: false, ownWritable: false, included: false });
  });
});

describe('turning the EQ on and off (writable folder)', () => {
  it('writes playlish.txt, backs config.txt up once and adds the Include line', () => {
    const { fs, data } = fakeFs({ [CONFIG]: USER_CONFIG });

    expect(applyEq(deps(fs), { enabled: true, gains: GAINS, device: 'Speakers' })).toBe('applied');
    expect(data.get(OWN)).toContain('Device: Speakers');
    expect(data.get(OWN)).toContain('Preamp: -6 dB');
    expect(data.get(CONFIG)).toBe(`${USER_CONFIG}${INCLUDE_LINE}\r\n`);
    expect(data.get(`${CONFIG}${BACKUP_SUFFIX}`)).toBe(USER_CONFIG);

    // Again with other gains: the file changes, config.txt and the backup do not.
    expect(applyEq(deps(fs), { enabled: true, gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], device: 'Speakers' })).toBe('applied');
    expect(data.get(OWN)).toContain('Preamp: 0 dB');
    expect(data.get(CONFIG)).toBe(`${USER_CONFIG}${INCLUDE_LINE}\r\n`);
    expect(data.get(`${CONFIG}${BACKUP_SUFFIX}`)).toBe(USER_CONFIG);
  });

  it('turning off removes only Playlish lines and file, leaving the user configuration as it was', () => {
    const { fs, data } = fakeFs({ [CONFIG]: USER_CONFIG });
    applyEq(deps(fs), { enabled: true, gains: GAINS, device: null });

    expect(applyEq(deps(fs), { enabled: false, gains: GAINS, device: null })).toBe('off');
    expect(data.get(CONFIG)).toBe(USER_CONFIG);
    expect(data.has(OWN)).toBe(false);
    expect([...data.keys()].some((k) => k.endsWith('.tmp') || k.endsWith('-probe'))).toBe(false);
  });

  it('says so when Equalizer APO is not installed', () => {
    expect(applyEq(deps(fakeFs({}).fs, null), { enabled: true, gains: GAINS, device: null })).toBe('not-installed');
  });
});

describe('a config folder the user cannot write (Program Files)', () => {
  it('asks for the one-time setup instead of half-applying', () => {
    const { fs, data } = fakeFs({ [CONFIG]: USER_CONFIG }, [CONFIG], true);

    expect(applyEq(deps(fs), { enabled: true, gains: GAINS, device: null })).toBe('needs-setup');
    expect(data.get(CONFIG)).toBe(USER_CONFIG);
    expect(data.has(OWN)).toBe(false);
  });

  it('after the setup (Include added, own file writable) only playlish.txt changes; off empties it', () => {
    const { fs, data } = fakeFs({ [CONFIG]: `${USER_CONFIG}${INCLUDE_LINE}\r\n`, [OWN]: '# off\r\n' }, [CONFIG], true);

    expect(applyEq(deps(fs), { enabled: true, gains: GAINS, device: 'Headphones' })).toBe('applied');
    expect(data.get(OWN)).toContain('Device: Headphones');
    expect(applyEq(deps(fs), { enabled: false, gains: GAINS, device: null })).toBe('off');
    expect(data.get(OWN)).toMatch(/off/);
    expect(data.get(OWN)).not.toContain('GraphicEQ');
    expect(data.get(CONFIG)).toBe(`${USER_CONFIG}${INCLUDE_LINE}\r\n`);
  });
});

describe('the one-time setup script', () => {
  it('backs up, adds the Include line once, creates the file and grants only that file to the user', () => {
    const script = elevatedSetupScript("C:\\Program Files\\EqualizerAPO\\config", "PC\\o'brien");

    expect(script).toContain("Join-Path 'C:\\Program Files\\EqualizerAPO\\config' 'config.txt'");
    expect(script).toContain('if (-not (Test-Path -LiteralPath $backup))');
    expect(script).toContain("-notmatch '(?im)^\\s*include\\s*:\\s*playlish\\.txt\\s*$'");
    expect(script).toContain(`'${INCLUDE_LINE}'`);
    expect(script).toContain("icacls.exe $own /grant 'PC\\o''brien:(M)'");
    expect(script).not.toMatch(/icacls[^\n]*\$config|Remove-Item|-Recurse/);
  });
});
