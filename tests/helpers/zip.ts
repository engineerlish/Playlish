import { makeZip, type ZipEntry } from '../../tools/plugins/zip-writer';

export { makeZip, type ZipEntry };

/*
 * Plugin packages for tests (#101): a valid manifest with fields replaced, and a package built from it. The zip writer
 * itself (which can also build broken or hostile archives) lives in tools/plugins/zip-writer.ts.
 */

/** A valid manifest, with fields replaced or removed (undefined) as a test needs. */
export function manifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: 'com.example.hello',
    name: 'Hello',
    version: '1.0.0',
    author: 'Example',
    description: 'Says hello.',
    apiVersion: 1,
    permissions: ['playback.read'],
    entry: 'main.js',
  };
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete base[k];
    else base[k] = v;
  }
  return base;
}

/** A plugin package: manifest.json plus its code (and any extra files). */
export function makePackage(overrides: Record<string, unknown> = {}, code = "playlish.log('hello');", extra: ZipEntry[] = []): Buffer {
  const m = manifest(overrides);
  return makeZip([{ name: 'manifest.json', data: JSON.stringify(m) }, { name: typeof m['entry'] === 'string' ? m['entry'] : 'main.js', data: code }, ...extra]);
}
