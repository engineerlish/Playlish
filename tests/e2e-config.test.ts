import { describe, expect, it } from 'vitest';
import { isLoopbackBase, readE2eConfig } from '../src/main/e2e';

const GOOD = {
  PLAYLISH_E2E: '1',
  PLAYLISH_E2E_ACCOUNTS: 'http://127.0.0.1:5001',
  PLAYLISH_E2E_API: 'http://127.0.0.1:5001',
  PLAYLISH_E2E_PORT: '43900',
  PLAYLISH_E2E_SDK_STUB: 'C:\\stub\\spotify-player.js',
};
const exists = () => true;

describe('readE2eConfig', () => {
  it('is off unless PLAYLISH_E2E=1', () => {
    expect(readE2eConfig({}, false, exists)).toBeNull();
    expect(readE2eConfig({ ...GOOD, PLAYLISH_E2E: 'true' }, false, exists)).toBeNull();
  });

  it('reads a complete loopback setup', () => {
    expect(readE2eConfig(GOOD, false, exists)).toEqual({
      accountsBase: 'http://127.0.0.1:5001',
      apiBase: 'http://127.0.0.1:5001',
      port: 43900,
      sdkStubFile: 'C:\\stub\\spotify-player.js',
    });
  });

  it('can never be switched on in a packaged build', () => {
    expect(() => readE2eConfig(GOOD, true, exists)).toThrow(/packaged/);
  });

  it('refuses addresses that are not on this machine', () => {
    expect(() => readE2eConfig({ ...GOOD, PLAYLISH_E2E_ACCOUNTS: 'https://accounts.spotify.com' }, false, exists)).toThrow(/ACCOUNTS/);
    expect(() => readE2eConfig({ ...GOOD, PLAYLISH_E2E_API: 'http://evil.example:5001' }, false, exists)).toThrow(/API/);
  });

  it('refuses a bad port or a missing stub', () => {
    expect(() => readE2eConfig({ ...GOOD, PLAYLISH_E2E_PORT: '80' }, false, exists)).toThrow(/PORT/);
    expect(() => readE2eConfig({ ...GOOD, PLAYLISH_E2E_PORT: '4e4' }, false, exists)).toThrow(/PORT/);
    expect(() => readE2eConfig({ ...GOOD, PLAYLISH_E2E_PORT: '70000' }, false, exists)).toThrow(/PORT/);
    expect(() => readE2eConfig(GOOD, false, () => false)).toThrow(/SDK_STUB/);
    expect(() => readE2eConfig({ ...GOOD, PLAYLISH_E2E_SDK_STUB: 'C:\\stub\\evil.exe' }, false, exists)).toThrow(/SDK_STUB/);
  });
});

describe('isLoopbackBase', () => {
  it.each([
    ['http://127.0.0.1:5001', true],
    ['http://127.0.0.1', false],
    ['https://127.0.0.1:5001', false],
    ['http://localhost:5001', false],
    ['http://127.0.0.1.evil.example:5001', false],
    ['http://user:pw@127.0.0.1:5001', false],
    ['http://127.0.0.1:5001/v1', false],
    ['http://127.0.0.1:5001/', false],
    ['http://127.0.0.1:5001?x=1', false],
    ['not a url', false],
  ])('%s -> %s', (value, expected) => {
    expect(isLoopbackBase(value)).toBe(expected);
  });
});
