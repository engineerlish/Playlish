// Copies the static renderer HTML and CSS next to the compiled JS and generates the tray icon (no binary assets in the repo).
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

mkdirSync('dist/web/renderer', { recursive: true });
mkdirSync('dist/assets', { recursive: true });

for (const file of ['host.html', 'ui.html', 'ui.css']) {
  copyFileSync(`src/renderer/${file}`, `dist/web/renderer/${file}`);
}

/** CRC-32 of a buffer, as required by PNG chunks. */
function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Builds one PNG chunk (length, type, data, CRC). */
function chunk(type, data) {
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(8 + data.length + 4);
  out.writeUInt32BE(data.length, 0);
  typeAndData.copy(out, 4);
  out.writeUInt32BE(crc32(typeAndData), 8 + data.length);
  return out;
}

/** Draws a filled green circle on a transparent background and encodes it as an RGBA PNG. */
function makeTrayPng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const c = (size - 1) / 2;
  const r = size / 2 - 1;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const inside = (x - c) ** 2 + (y - c) ** 2 <= r * r;
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = 0x1d;
      raw[o + 1] = 0xb9;
      raw[o + 2] = 0x54;
      raw[o + 3] = inside ? 255 : 0;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

writeFileSync('dist/assets/tray.png', makeTrayPng(32));
// App icon for the installer, the executable and the Start menu (electron-builder converts it to .ico).
mkdirSync('build', { recursive: true });
writeFileSync('build/icon.png', makeTrayPng(256));
console.log('assets built');
