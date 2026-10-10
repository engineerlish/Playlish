import * as zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { ZIP_LIMITS, ZipError, isSafeEntryName, readZip } from '../src/main/plugins/zip';
import { makeZip } from './helpers/zip';

describe('readZip', () => {
  it('reads stored and deflated files, and skips folders', () => {
    const files = readZip(
      makeZip([
        { name: 'a.txt', data: 'stored', method: 0 },
        { name: 'ui/', data: '', method: 0 },
        { name: 'ui/panel.json', data: '{"x":1}'.repeat(50) },
        { name: 'empty.js', data: '' },
      ]),
    );

    expect([...files.keys()]).toEqual(['a.txt', 'ui/panel.json', 'empty.js']);
    expect(files.get('a.txt')?.toString()).toBe('stored');
    expect(files.get('ui/panel.json')?.toString()).toBe('{"x":1}'.repeat(50));
    expect(files.get('empty.js')?.length).toBe(0);
  });

  it.each([
    ['../evil.js', 'parent folder'],
    ['ui/../../evil.js', 'parent folder inside'],
    ['/abs.js', 'absolute path'],
    ['C:/evil.js', 'drive letter'],
    ['ui\\evil.js', 'backslash'],
    ['./main.js', 'dot folder'],
    ['ui//main.js', 'empty part'],
    ['spa ce.js', 'space'],
    ['naïve.js', 'non-ASCII'],
  ])('refuses the unsafe name %s (%s)', (name) => {
    expect(() => readZip(makeZip([{ name, data: 'x' }]))).toThrow(/Unsafe file name/);
  });

  it('refuses names that differ only in case, and duplicates', () => {
    expect(() => readZip(makeZip([{ name: 'Main.js', data: 'a' }, { name: 'main.js', data: 'b' }]))).toThrow(/twice/);
  });

  it('refuses symbolic links, encryption and unsupported compression', () => {
    expect(() => readZip(makeZip([{ name: 'link.js', data: '/etc/passwd', method: 0, madeBy: 3, externalAttributes: (0o120777 << 16) >>> 0 }]))).toThrow(/symbolic link/);
    expect(() => readZip(makeZip([{ name: 'a.js', data: 'x', flags: 1 }]))).toThrow(/encrypted/);
    expect(() => readZip(makeZip([{ name: 'a.js', data: 'x', method: 12 }]))).toThrow(/compression method/);
  });

  it('stops a zip bomb at the size it claims', () => {
    // 50 MB of zeros that claims to be 1 KB.
    const bomb = makeZip([{ name: 'bomb.js', data: Buffer.alloc(50 * 1024 * 1024), size: 1024 }]);
    expect(bomb.length).toBeLessThan(ZIP_LIMITS.maxArchiveBytes);

    expect(() => readZip(bomb)).toThrow(/larger than it claims|not the size/);
  });

  it('refuses files and packages over the size limits', () => {
    const limits = { ...ZIP_LIMITS, maxFileBytes: 100, maxTotalBytes: 150 };
    expect(() => readZip(makeZip([{ name: 'big.js', data: 'x'.repeat(101) }]), limits)).toThrow(/larger than 100 bytes/);
    expect(() => readZip(makeZip([{ name: 'a.js', data: 'x'.repeat(80) }, { name: 'b.js', data: 'x'.repeat(80) }]), limits)).toThrow(/unpacked package is larger/);
    expect(() => readZip(Buffer.alloc(ZIP_LIMITS.maxArchiveBytes + 1))).toThrow(/package is larger/);
  });

  it('refuses too many entries', () => {
    const entries = Array.from({ length: 4 }, (_, i) => ({ name: `f${i}.js`, data: 'x' }));
    expect(() => readZip(makeZip(entries), { ...ZIP_LIMITS, maxEntries: 3 })).toThrow(/more than 3 entries/);
  });

  it('refuses a wrong checksum or a size that does not match', () => {
    expect(() => readZip(makeZip([{ name: 'a.js', data: 'hello', crc: 1234 }]))).toThrow(/checksum/);
    expect(() => readZip(makeZip([{ name: 'a.js', data: 'hello', method: 0, size: 4 }]))).toThrow(/damaged/);
    expect(() => readZip(makeZip([{ name: 'a.js', data: 'hello', size: 9 }]))).toThrow(/not the size|damaged/);
  });

  it('refuses things that are not zip files, or damaged ones', () => {
    expect(() => readZip(Buffer.from('just text, not a zip archive at all'))).toThrow(ZipError);
    expect(() => readZip(Buffer.alloc(10))).toThrow(/too short/);
    const good = makeZip([{ name: 'a.js', data: 'x'.repeat(100) }]);
    // Point the directory past the end.
    const broken = Buffer.from(good);
    broken.writeUInt32LE(good.length, good.length - 6);
    expect(() => readZip(broken)).toThrow(/damaged/);
    // Deflated data that ends early (stored as-is under method 8, claiming the full size).
    const truncated = zlib.deflateRawSync(Buffer.from('y'.repeat(1000))).subarray(0, 3);
    const cut = makeZip([{ name: 'a.js', data: truncated, method: 0, size: 1000 }]);
    cut.writeUInt16LE(8, 8); // local header: method 8
    cut.writeUInt16LE(8, 30 + 'a.js'.length + truncated.length + 10); // central header: method 8
    expect(() => readZip(cut)).toThrow(/damaged|not the size/);
  });
});

describe('isSafeEntryName', () => {
  it('accepts simple relative names and refuses deep or long ones', () => {
    expect(isSafeEntryName('main.js')).toBe(true);
    expect(isSafeEntryName('ui/panel-1.json')).toBe(true);
    expect(isSafeEntryName('a/b/c/d/e/f/g/h/i.js')).toBe(false);
    expect(isSafeEntryName(`${'x'.repeat(201)}.js`)).toBe(false);
    expect(isSafeEntryName('')).toBe(false);
  });
});
