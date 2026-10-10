import * as zlib from 'node:zlib';

/*
 * A small, strict zip reader for plugin packages (#101), built on Node's zlib so Playlish needs no zip library.
 *
 * A package comes from someone else, so everything in it is checked before it is used:
 * - only plain files with simple relative names (letters, digits, ".", "_", "-" and "/" between folders); no absolute
 *   paths, "..", backslashes, drive letters, symbolic links or names that differ only in case;
 * - only "stored" and "deflate" entries, no encryption, no zip64, no multi-disk archives;
 * - size limits on the archive, on each file and on all files together, enforced while decompressing (a "zip bomb"
 *   that claims a small size stops at that size), and each file's CRC-32 must match.
 */

// CHANGE HERE: limits for plugin packages.
export const ZIP_LIMITS = {
  /** Largest package file. */
  maxArchiveBytes: 5 * 1024 * 1024,
  /** Most entries (folders included). */
  maxEntries: 200,
  /** Largest single file once unpacked. */
  maxFileBytes: 5 * 1024 * 1024,
  /** All files together once unpacked. */
  maxTotalBytes: 10 * 1024 * 1024,
  /** Longest file name (with its folders), and deepest folder nesting. */
  maxNameLength: 200,
  maxDepth: 8,
};

export class ZipError extends Error {
  override name = 'ZipError';
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const EOCD_MIN = 22;
const SAFE_NAME = /^[A-Za-z0-9._-]+$/;
const S_IFMT = 0o170000;
const S_IFLNK = 0o120000;

/** True for a relative file name made only of simple parts. */
export function isSafeEntryName(name: string, maxLength = ZIP_LIMITS.maxNameLength, maxDepth = ZIP_LIMITS.maxDepth): boolean {
  if (name.length === 0 || name.length > maxLength) return false;
  const parts = name.split('/');
  if (parts.length > maxDepth) return false;
  return parts.every((p) => SAFE_NAME.test(p) && p !== '.' && p !== '..');
}

/** Finds the end-of-central-directory record (it sits in the last 64 KB plus 22 bytes). */
function findEndRecord(buf: Buffer): number {
  const lowest = Math.max(0, buf.length - (EOCD_MIN + 0xffff));
  for (let i = buf.length - EOCD_MIN; i >= lowest; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIGNATURE && i + EOCD_MIN + buf.readUInt16LE(i + 20) === buf.length) return i;
  }
  throw new ZipError('Not a zip file (no end record).');
}

/** Reads every file in a zip archive into a map of name to contents, or throws a ZipError explaining what is wrong. */
export function readZip(buf: Buffer, limits = ZIP_LIMITS): Map<string, Buffer> {
  if (buf.length > limits.maxArchiveBytes) throw new ZipError(`The package is larger than ${limits.maxArchiveBytes} bytes.`);
  if (buf.length < EOCD_MIN) throw new ZipError('Not a zip file (too short).');
  const end = findEndRecord(buf);
  const disk = buf.readUInt16LE(end + 4);
  const cdDisk = buf.readUInt16LE(end + 6);
  const entriesHere = buf.readUInt16LE(end + 8);
  const entries = buf.readUInt16LE(end + 10);
  const cdSize = buf.readUInt32LE(end + 12);
  const cdOffset = buf.readUInt32LE(end + 16);
  if (disk !== 0 || cdDisk !== 0 || entriesHere !== entries) throw new ZipError('Multi-part zip files are not supported.');
  if (entries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new ZipError('Zip64 files are not supported.');
  if (entries > limits.maxEntries) throw new ZipError(`The package has more than ${limits.maxEntries} entries.`);
  if (cdOffset + cdSize > end) throw new ZipError('The zip directory is damaged.');

  const files = new Map<string, Buffer>();
  const seen = new Set<string>();
  let total = 0;
  let p = cdOffset;
  for (let n = 0; n < entries; n++) {
    if (p + 46 > end || buf.readUInt32LE(p) !== CENTRAL_SIGNATURE) throw new ZipError('The zip directory is damaged.');
    const madeBy = buf.readUInt16LE(p + 4) >> 8;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLength = buf.readUInt16LE(p + 28);
    const extraLength = buf.readUInt16LE(p + 30);
    const commentLength = buf.readUInt16LE(p + 32);
    const externalAttributes = buf.readUInt32LE(p + 38);
    const localOffset = buf.readUInt32LE(p + 42);
    if (p + 46 + nameLength > end) throw new ZipError('The zip directory is damaged.');
    const name = buf.toString('latin1', p + 46, p + 46 + nameLength);
    p += 46 + nameLength + extraLength + commentLength;

    if (flags & 0x1) throw new ZipError(`"${name}" is encrypted.`);
    // Unix-made archives keep the file type in the upper 16 bits: no symbolic links.
    if (madeBy === 3 && ((externalAttributes >>> 16) & S_IFMT) === S_IFLNK) throw new ZipError(`"${name}" is a symbolic link.`);
    const isFolder = name.endsWith('/');
    const clean = isFolder ? name.slice(0, -1) : name;
    if (!isSafeEntryName(clean, limits.maxNameLength, limits.maxDepth)) throw new ZipError(`Unsafe file name in the package: "${name.slice(0, 80)}".`);
    const key = clean.toLowerCase();
    if (seen.has(key)) throw new ZipError(`"${clean}" is in the package twice.`);
    seen.add(key);
    if (isFolder) {
      if (size !== 0) throw new ZipError(`The folder "${clean}" has contents of its own.`);
      continue;
    }
    if (method !== 0 && method !== 8) throw new ZipError(`"${clean}" uses an unsupported compression method (${method}).`);
    if (size > limits.maxFileBytes) throw new ZipError(`"${clean}" is larger than ${limits.maxFileBytes} bytes.`);
    total += size;
    if (total > limits.maxTotalBytes) throw new ZipError(`The unpacked package is larger than ${limits.maxTotalBytes} bytes.`);

    if (localOffset + 30 > end || buf.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) throw new ZipError(`"${clean}" is damaged.`);
    const dataStart = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
    if (dataStart + compressedSize > end) throw new ZipError(`"${clean}" is damaged.`);
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    let data: Buffer;
    if (method === 0) {
      if (compressedSize !== size) throw new ZipError(`"${clean}" is damaged.`);
      data = Buffer.from(raw);
    } else {
      try {
        // Never more than the size the archive claims, so a bomb stops here.
        data = zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, size) });
      } catch {
        throw new ZipError(`"${clean}" is damaged or larger than it claims.`);
      }
    }
    if (data.length !== size) throw new ZipError(`"${clean}" is not the size it claims.`);
    if (zlib.crc32(data) !== crc) throw new ZipError(`"${clean}" is damaged (checksum mismatch).`);
    files.set(clean, data);
  }
  return files;
}
