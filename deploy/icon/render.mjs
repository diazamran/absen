// Render the new PresensiKu icon (SVG) to all required PNG sizes.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const mainSvg = join(here, 'logo-main.svg');
const maskSvg = join(here, 'logo-maskable.svg');

async function render(svgPath, outPath, size) {
  const buf = await sharp(svgPath, { density: 144 })
    .resize(size, size, { fit: 'fill' })
    .png({ compressionLevel: 9 })
    .toBuffer();
  mkdirSync(dirname(outPath), { recursive: true });
  await sharp(buf).toFile(outPath);
  console.log('ok', outPath.replace(root + '/', ''), size + 'px');
}

const jobs = [
  // PWA (web)
  [mainSvg, 'apps/web/public/icons/icon-192.png', 192],
  [mainSvg, 'apps/web/public/icons/icon-512.png', 512],
  [maskSvg, 'apps/web/public/icons/maskable-192.png', 192],
  [maskSvg, 'apps/web/public/icons/maskable-512.png', 512],
  [mainSvg, 'apps/web/public/favicon.png', 64],

  // Android TWA launcher + maskable
  [mainSvg, 'deploy/android/twa/app/src/main/res/mipmap-mdpi/ic_launcher.png', 48],
  [mainSvg, 'deploy/android/twa/app/src/main/res/mipmap-hdpi/ic_launcher.png', 72],
  [mainSvg, 'deploy/android/twa/app/src/main/res/mipmap-xhdpi/ic_launcher.png', 96],
  [mainSvg, 'deploy/android/twa/app/src/main/res/mipmap-xxhdpi/ic_launcher.png', 144],
  [mainSvg, 'deploy/android/twa/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', 192],
  [maskSvg, 'deploy/android/twa/app/src/main/res/mipmap-mdpi/ic_maskable.png', 48],
  [maskSvg, 'deploy/android/twa/app/src/main/res/mipmap-hdpi/ic_maskable.png', 72],
  [maskSvg, 'deploy/android/twa/app/src/main/res/mipmap-xhdpi/ic_maskable.png', 96],
  [maskSvg, 'deploy/android/twa/app/src/main/res/mipmap-xxhdpi/ic_maskable.png', 144],
  [maskSvg, 'deploy/android/twa/app/src/main/res/mipmap-xxxhdpi/ic_maskable.png', 192],

  // Android WebView launcher
  [mainSvg, 'deploy/android/webview/app/src/main/res/mipmap-mdpi/ic_launcher.png', 48],
  [mainSvg, 'deploy/android/webview/app/src/main/res/mipmap-hdpi/ic_launcher.png', 72],
  [mainSvg, 'deploy/android/webview/app/src/main/res/mipmap-xhdpi/ic_launcher.png', 96],
  [mainSvg, 'deploy/android/webview/app/src/main/res/mipmap-xxhdpi/ic_launcher.png', 144],
  [mainSvg, 'deploy/android/webview/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png', 192],
];

for (const [svg, rel, size] of jobs) {
  await render(svg, join(root, rel), size);
}
console.log('done');
