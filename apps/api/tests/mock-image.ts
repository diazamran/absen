import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const jpeg = require(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../node_modules/jpeg-js'));

/**
 * Membuat frame JPEG 64x64 dengan variasi halus (deterministik).
 * Frame yang berdekatan cukup mirip untuk lulus matching mock provider.
 */
export class MockImageMaker {
  static jpg(i: number): string {
    const w = 64;
    const h = 64;
    const data = Buffer.alloc(w * h * 4);
    const base = [120 + i * 10, 90 + i * 8, 60 + i * 6];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = (y * w + x) * 4;
        data[p] = base[0] + x * 0.2;
        data[p + 1] = base[1] + y * 0.2;
        data[p + 2] = base[2];
        data[p + 3] = 255;
      }
    }
    const raw = jpeg.encode({ data, width: w, height: h }, 80);
    return `data:image/jpeg;base64,${raw.data.toString('base64')}`;
  }
}
