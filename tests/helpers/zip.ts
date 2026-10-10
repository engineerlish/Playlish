import * as zlib from 'node:zlib';

/*
 * Builds zip files for tests (#101): normal plugin packages, and broken or hostile ones (every field can be overridden,
 * so a test can claim a wrong size, a wrong checksum, encryption, a symbolic link or a path outside the package).
 */

export interface ZipEntry {
  name: string;
  data?: Buffer | string;
  /** 0 stored, 8 deflate (default). */
  method?: number;
  /** Overrides, to build a broken entry. */
  crc?: number;
  size?: number;
  flags?: number;
  /** Upper byte of "version made by" (3 = Unix) and the external attributes. */
  madeBy?: number;
  externalAttributes?: number;
}

/** A zip archive with the given entries, in order. */
export function makeZip(entries: ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data ?? '', 'utf8');
    const method = e.method ?? 8;
    const body = method === 8 ? zlib.deflateRawSync(data) : data;
    const name = Buffer.from(e.name, 'latin1');
    const crc = e.crc ?? zlib.crc32(data);
    const size = e.size ?? data.length;
    const flags = e.flags ?? 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(((e.madeBy ?? 0) << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(e.externalAttributes ?? 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

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
