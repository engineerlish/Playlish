import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig, redirectUriFor } from '../src/main/config';

const GOOD_ID = '0123456789abcdef0123456789abcdef';

let dir: string;

/** Writes spike.config.json into the temp app root. */
function writeConfig(contents: string): void {
  fs.writeFileSync(path.join(dir, 'spike.config.json'), contents);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'playlish-config-'));
  vi.stubEnv('PLAYLISH_CLIENT_ID', undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('reports a missing file as a configuration problem, with the default port', () => {
    const result = loadConfig(dir);

    expect(result.config).toBeNull();
    expect(result.error).toMatch(/Client ID/);
    expect(result.port).toBe(43821);
  });

  it('reads a valid file and fills in the defaults', () => {
    writeConfig(JSON.stringify({ clientId: GOOD_ID }));

    const result = loadConfig(dir);

    expect(result.error).toBeNull();
    expect(result.config).toEqual({ clientId: GOOD_ID, trackUri: 'spotify:track:4cOdK2wGLETKBW3PvgPWqT', port: 43821 });
  });

  it('uses a custom track and port from the file', () => {
    writeConfig(JSON.stringify({ clientId: GOOD_ID, trackUri: 'spotify:track:11dFghVXANMlKmJXsNCbNl', port: 50000 }));

    const result = loadConfig(dir);

    expect(result.config).toMatchObject({ trackUri: 'spotify:track:11dFghVXANMlKmJXsNCbNl', port: 50000 });
    expect(result.port).toBe(50000);
  });

  it('keeps the custom port available even when the Client ID is invalid, so the UI can still load', () => {
    writeConfig(JSON.stringify({ clientId: 'nope', port: 50001 }));

    const result = loadConfig(dir);

    expect(result.config).toBeNull();
    expect(result.port).toBe(50001);
  });

  it('accepts upper case hex and trims whitespace', () => {
    writeConfig(JSON.stringify({ clientId: `  ${GOOD_ID.toUpperCase()}  ` }));

    expect(loadConfig(dir).config?.clientId).toBe(GOOD_ID.toUpperCase());
  });

  it.each([
    ['too short', GOOD_ID.slice(1)],
    ['too long', `${GOOD_ID}0`],
    ['not hex', 'z'.repeat(32)],
    ['the placeholder from the example file', 'PASTE_YOUR_SPOTIFY_CLIENT_ID_HERE'],
    ['empty', ''],
  ])('rejects a Client ID that is %s', (_name, clientId) => {
    writeConfig(JSON.stringify({ clientId }));

    const result = loadConfig(dir);

    expect(result.config).toBeNull();
    expect(result.error).toMatch(/Client ID/);
  });

  it('reports invalid JSON with the parser message and does not throw', () => {
    writeConfig('{ "clientId": ');

    const result = loadConfig(dir);

    expect(result.config).toBeNull();
    expect(result.error).toMatch(/not valid JSON/);
    expect(result.port).toBe(43821);
  });

  it('lets the environment override the Client ID in the file', () => {
    writeConfig(JSON.stringify({ clientId: 'f'.repeat(32) }));
    vi.stubEnv('PLAYLISH_CLIENT_ID', GOOD_ID);

    expect(loadConfig(dir).config?.clientId).toBe(GOOD_ID);
  });

  it('works with only the environment variable and no file', () => {
    vi.stubEnv('PLAYLISH_CLIENT_ID', GOOD_ID);

    expect(loadConfig(dir).config?.clientId).toBe(GOOD_ID);
  });
});

describe('loadConfig with malformed values (#28)', () => {
  it.each([
    ['a number', 123],
    ['null', null],
    ['an object', { id: GOOD_ID }],
    ['an array', [GOOD_ID]],
    ['a boolean', true],
  ])('reports a Client ID that is %s as an error instead of throwing', (_name, clientId) => {
    writeConfig(JSON.stringify({ clientId }));

    const result = loadConfig(dir);

    expect(result.config).toBeNull();
    expect(result.error).toMatch(/Client ID/);
  });

  it.each([['null'], ['[]'], ['"just a string"'], ['42'], ['true']])('reports a file containing %s as an error instead of throwing', (contents) => {
    writeConfig(contents);

    const result = loadConfig(dir);

    expect(result.config).toBeNull();
    expect(result.error).toMatch(/JSON object/);
    expect(result.port).toBe(43821);
  });

  it('treats an empty PLAYLISH_CLIENT_ID as not set and falls back to the file', () => {
    writeConfig(JSON.stringify({ clientId: GOOD_ID }));
    vi.stubEnv('PLAYLISH_CLIENT_ID', '');

    expect(loadConfig(dir).config?.clientId).toBe(GOOD_ID);
  });

  it('treats a blank PLAYLISH_CLIENT_ID as not set', () => {
    writeConfig(JSON.stringify({ clientId: GOOD_ID }));
    vi.stubEnv('PLAYLISH_CLIENT_ID', '   ');

    expect(loadConfig(dir).config?.clientId).toBe(GOOD_ID);
  });

  it.each([
    ['zero', 0],
    ['negative', -5],
    ['above 65535', 70_000],
    ['a fraction', 8080.5],
    ['a string', '43821'],
    ['null', null],
  ])('rejects a port that is %s and names the valid range', (_name, port) => {
    writeConfig(JSON.stringify({ clientId: GOOD_ID, port }));

    const result = loadConfig(dir);

    expect(result.config).toBeNull();
    expect(result.error).toMatch(/port/i);
    expect(result.error).toMatch(/1.*65535/);
    expect(result.port).toBe(43821); // the UI can still load and explain the problem
  });

  it('accepts the edges of the valid port range', () => {
    writeConfig(JSON.stringify({ clientId: GOOD_ID, port: 1 }));
    expect(loadConfig(dir).config?.port).toBe(1);

    writeConfig(JSON.stringify({ clientId: GOOD_ID, port: 65_535 }));
    expect(loadConfig(dir).config?.port).toBe(65_535);
  });

  it.each([
    ['a number', 5],
    ['not a Spotify URI', 'hello'],
    ['an album URI', 'spotify:album:4cOdK2wGLETKBW3PvgPWqT'],
    ['a track URI with a short id', 'spotify:track:abc'],
    ['an empty string', ''],
    ['null', null],
  ])('rejects a track URI that is %s', (_name, trackUri) => {
    writeConfig(JSON.stringify({ clientId: GOOD_ID, trackUri }));

    const result = loadConfig(dir);

    expect(result.config).toBeNull();
    expect(result.error).toMatch(/trackUri/);
  });
});

describe('redirectUriFor', () => {
  it('builds the loopback redirect URI to register in the Spotify dashboard', () => {
    expect(redirectUriFor(43821)).toBe('http://127.0.0.1:43821/callback');
  });

  it('uses the given port', () => {
    expect(redirectUriFor(50000)).toBe('http://127.0.0.1:50000/callback');
  });
});
