import { describe, expect, it } from 'vitest';
import { MANIFEST_MAX_BYTES, ManifestError, PLUGIN_API_VERSION, parseManifest } from '../src/main/plugins/manifest';
import { manifest } from './helpers/zip';

const parse = (overrides: Record<string, unknown> = {}) => parseManifest(JSON.stringify(manifest(overrides)));

describe('parseManifest', () => {
  it('reads a valid manifest, trimming text and defaulting optional fields', () => {
    expect(parse({ name: '  Hello  ', description: undefined, ui: ['sidebar'] })).toEqual({
      id: 'com.example.hello',
      name: 'Hello',
      version: '1.0.0',
      author: 'Example',
      description: '',
      apiVersion: PLUGIN_API_VERSION,
      permissions: ['playback.read'],
      entry: 'main.js',
      ui: ['sidebar'],
    });
    expect(parse({ permissions: [] }).permissions).toEqual([]);
    // A byte-order mark from Notepad is fine.
    expect(parseManifest(`\uFEFF${JSON.stringify(manifest())}`).id).toBe('com.example.hello');
  });

  it('says when a plugin needs a newer Playlish', () => {
    expect(() => parse({ apiVersion: 2 })).toThrow(/needs a newer Playlish/);
    expect(() => parse({ apiVersion: 0 })).toThrow(/not supported/);
    expect(() => parse({ apiVersion: '1' })).toThrow(/whole number/);
    expect(() => parse({ apiVersion: undefined })).toThrow(/whole number/);
  });

  it.each([
    ['Com.Example', 'upper case'],
    ['com..example', 'empty part'],
    ['-com.example', 'leading dash'],
    ['com/example', 'slash'],
    ['com.example.', 'trailing dot'],
    ['x'.repeat(65), 'too long'],
    ['', 'empty'],
    [42, 'not text'],
  ])('refuses the id %s (%s)', (id, what) => {
    expect(() => parse({ id }), what).toThrow(/"id" must be/);
  });

  it('refuses ids that start with a name Windows reserves', () => {
    for (const id of ['con', 'nul.plugin', 'com1-thing', 'lpt9.x']) expect(() => parse({ id }), id).toThrow(/Windows reserves/);
    // Only as a whole first part.
    expect(parse({ id: 'console.tools' }).id).toBe('console.tools');
  });

  it('refuses unknown fields, unknown or repeated permissions, and unknown UI slots', () => {
    expect(() => parse({ main: 'x.js' })).toThrow(/Unknown field/);
    expect(() => parse({ permissions: ['network'] })).toThrow(/Unknown permission/);
    expect(() => parse({ permissions: ['storage', 'storage'] })).toThrow(/twice/);
    expect(() => parse({ permissions: 'storage' })).toThrow(/must be a list/);
    expect(() => parse({ permissions: ['__proto__'] })).toThrow(/Unknown permission/);
    expect(() => parse({ ui: ['window'] })).toThrow(/Unknown UI slot/);
    expect(() => parse({ ui: ['sidebar', 'sidebar'] })).toThrow(/twice/);
  });

  it('checks the version, the entry file and the text fields', () => {
    for (const version of ['1.0', '1.0.0-beta', 'v1.0.0', '01.0.0']) expect(() => parse({ version }), version).toThrow(/"version"/);
    for (const entry of ['../main.js', 'main.ts', '/main.js', 'lib\\main.js']) expect(() => parse({ entry }), entry).toThrow(/"entry"/);
    expect(parse({ entry: 'dist/main.js' }).entry).toBe('dist/main.js');
    expect(() => parse({ name: '' })).toThrow(/must not be empty/);
    expect(() => parse({ name: 'x'.repeat(61) })).toThrow(/longer than 60/);
    expect(() => parse({ author: 42 })).toThrow(/must be text/);
    expect(() => parse({ description: 'y'.repeat(301) })).toThrow(/longer than 300/);
  });

  it('refuses hidden characters that could disguise a name in the prompt', () => {
    expect(() => parse({ name: 'Safe\u202Etxt.exe' })).toThrow(/hidden characters/);
    expect(() => parse({ author: 'A\u0000B' })).toThrow(/hidden characters/);
    expect(() => parse({ name: 'Zero\u200Bwidth' })).toThrow(/hidden characters/);
  });

  it('refuses something that is not a JSON object, or is too large', () => {
    expect(() => parseManifest('not json')).toThrow(/not valid JSON/);
    expect(() => parseManifest('[]')).toThrow(/JSON object/);
    expect(() => parseManifest('null')).toThrow(/JSON object/);
    expect(() => parseManifest(JSON.stringify(manifest({ description: 'z'.repeat(MANIFEST_MAX_BYTES) })))).toThrow(ManifestError);
  });
});
