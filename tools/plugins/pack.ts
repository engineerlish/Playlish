/*
 * Packs a plugin folder into a .playlish file (#104), and checks it exactly as Playlish will when it is installed.
 *
 *   npm run plugin:pack -- examples/listening-stats            writes examples/listening-stats.playlish
 *   npm run plugin:pack -- my-plugin --out C:\path\my.playlish
 *
 * Every file in the folder goes in, except hidden files (names starting with "."). The check uses the built app
 * (dist/), which the npm script builds first, so a package that packs here also installs.
 */
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { makeZip, type ZipEntry } from './zip-writer.ts';

/** Every file under `dir`, as package names with "/" between folders. */
function filesIn(dir: string, prefix = ''): ZipEntry[] {
  const entries: ZipEntry[] = [];
  for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (item.name.startsWith('.')) continue;
    const name = prefix + item.name;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) entries.push(...filesIn(full, `${name}/`));
    else if (item.isFile()) entries.push({ name, data: fs.readFileSync(full) });
  }
  return entries;
}

/** Packs `dir` into a package and returns its bytes; throws with Playlish's own message if it would be refused. */
export function pack(dir: string): Buffer {
  const files = filesIn(dir);
  // manifest.json first, so a quick look at the archive finds it.
  files.sort((a, b) => (a.name === 'manifest.json' ? -1 : b.name === 'manifest.json' ? 1 : 0));
  const buf = makeZip(files);
  const require = createRequire(import.meta.url);
  const store = require(path.resolve('dist/main/plugins/store.js')) as { inspectPackage(b: Buffer): { manifest: { id: string; version: string; permissions: string[] }; sha256: string } };
  store.inspectPackage(buf);
  return buf;
}

/** Command line: pack <folder> [--out <file>]. */
function main(argv: string[]): void {
  const dir = argv.find((a) => !a.startsWith('--'));
  const outIndex = argv.indexOf('--out');
  if (!dir) {
    console.error('Usage: npm run plugin:pack -- <plugin folder> [--out <file.playlish>]');
    process.exit(2);
  }
  const out = outIndex >= 0 ? (argv[outIndex + 1] ?? '') : `${dir.replace(/[/\\]+$/, '')}.playlish`;
  try {
    const buf = pack(dir);
    fs.writeFileSync(out, buf);
    console.log(`Packed ${dir} into ${out} (${buf.length} bytes).`);
  } catch (err) {
    console.error(`Not packed: ${(err as Error).message}`);
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) main(process.argv.slice(2));
