import { describe, expect, it } from 'vitest';
import { SAFE_MODE_FLAG, isSafeMode, relaunchArgs } from '../src/main/safe-mode';

describe('isSafeMode', () => {
  it('is on with the command-line flag or PLAYLISH_SAFE_MODE=1, off otherwise', () => {
    expect(isSafeMode(['electron.exe', '.', SAFE_MODE_FLAG], {})).toBe(true);
    expect(isSafeMode(['electron.exe', '.'], { PLAYLISH_SAFE_MODE: '1' })).toBe(true);
    expect(isSafeMode(['electron.exe', '.'], { PLAYLISH_SAFE_MODE: 'true' })).toBe(false);
    expect(isSafeMode(['electron.exe', '.', '--tray'], {})).toBe(false);
  });
});

describe('relaunchArgs', () => {
  it('adds the flag once, or removes it, keeping the other arguments', () => {
    expect(relaunchArgs(['electron.exe', '.', '--user-data-dir=x'], true)).toEqual(['.', '--user-data-dir=x', SAFE_MODE_FLAG]);
    expect(relaunchArgs(['electron.exe', '.', SAFE_MODE_FLAG, '--user-data-dir=x'], true)).toEqual(['.', '--user-data-dir=x', SAFE_MODE_FLAG]);
    expect(relaunchArgs(['electron.exe', '.', SAFE_MODE_FLAG, '--user-data-dir=x'], false)).toEqual(['.', '--user-data-dir=x']);
  });
});
