import sharp from 'sharp';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(__dirname, '../src/assets/aurisar-mark-3d.png');
const pub = path.join(__dirname, '../public');

const bg = { r: 17, g: 17, b: 17, alpha: 1 }; // #111111

const sizes = [
  { out: 'favicon.png',          size: 32  },
  { out: 'apple-touch-icon.png', size: 180 },
  { out: 'icon-192x192.png',     size: 192 },
  { out: 'icon-512x512.png',     size: 512 },
];

for (const { out, size } of sizes) {
  await sharp(src)
    .resize(size, size, { fit: 'contain', background: bg })
    .flatten({ background: bg })
    .png()
    .toFile(path.join(pub, out));
  console.log(`✓ ${out} (${size}×${size})`);
}
