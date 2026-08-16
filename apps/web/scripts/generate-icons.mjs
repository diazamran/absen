// Membuat ikon PWA (192/512 + maskable) tanpa dependency native.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.resolve(__dirname, '../public/icons');
fs.mkdirSync(outDir, { recursive: true });

// Warna teal PresensiKu
const TEAL = [13, 148, 136];
const TEAL_DARK = [45, 212, 191];
const WHITE = [255, 255, 255];

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, draw) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    row[0] = 0; // filter none
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = draw(x, y, size);
      const p = 1 + x * 4;
      row[p] = r;
      row[p + 1] = g;
      row[p + 2] = b;
      row[p + 3] = a;
    }
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Ikon: rounded square teal dengan "P" putih (seperti tanda centang sederhana)
function drawIcon(x, y, size) {
  const radius = size * 0.22;
  const cx = x - size / 2;
  const cy = y - size / 2;
  const inside =
    x >= radius && x < size - radius && y >= radius && y < size - radius
      ? true
      : cornerIn(x, y, radius, size);
  if (!inside) return [0, 0, 0, 0];
  // gradient
  const t = (x + y) / (2 * size);
  const r = Math.round(TEAL[0] + (TEAL_DARK[0] - TEAL[0]) * t);
  const g = Math.round(TEAL[1] + (TEAL_DARK[1] - TEAL[1]) * t);
  const b = Math.round(TEAL[2] + (TEAL_DARK[2] - TEAL[2]) * t);
  // huruf "P" (garis putih)
  const isLetter = drawP(x, y, size);
  if (isLetter) return [WHITE[0], WHITE[1], WHITE[2], 255];
  return [r, g, b, 255];
}

function cornerIn(x, y, radius, size) {
  const corners = [
    [radius, radius], [size - radius, radius], [radius, size - radius], [size - radius, size - radius],
  ];
  return corners.some(([cxp, cyp]) => {
    const dx = x - cxp;
    const dy = y - cyp;
    return dx * dx + dy * dy <= radius * radius;
  });
}

function drawP(x, y, size) {
  const u = size / 100; // unit
  const left = 30 * u;
  const right = 70 * u;
  const top = 26 * u;
  const bottom = 74 * u;
  const stroke = 9 * u;
  // batang vertikal "P"
  if (x >= left - stroke / 2 && x <= left + stroke / 2 && y >= top - stroke / 2 && y <= bottom + stroke / 2) return true;
  // lengkung "P"
  if (y >= top - stroke / 2 && y <= top + 34 * u + stroke / 2) {
    const cy = top + 17 * u;
    const cx = left + 20 * u;
    const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    if (Math.abs(d - 20 * u) <= stroke / 2 && x >= left) return true;
  }
  return false;
}

// Maskable: padding aman (icon dalam lingkaran 80%)
function drawMaskable(x, y, size) {
  const c = size / 2;
  const d = Math.sqrt((x - c) ** 2 + (y - c) ** 2);
  const safeR = size * 0.42;
  if (d > safeR) {
    // latar teal penuh di luar lingkaran aman
    const t = (x + y) / (2 * size);
    return [
      Math.round(TEAL[0] + (TEAL_DARK[0] - TEAL[0]) * t),
      Math.round(TEAL[1] + (TEAL_DARK[1] - TEAL[1]) * t),
      Math.round(TEAL[2] + (TEAL_DARK[2] - TEAL[2]) * t),
      255,
    ];
  }
  return drawIcon(x, y, size);
}

for (const size of [192, 512]) {
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), encodePng(size, drawIcon));
  fs.writeFileSync(path.join(outDir, `maskable-${size}.png`), encodePng(size, drawMaskable));
}
console.log('✅ Ikon PWA dibuat di public/icons');
