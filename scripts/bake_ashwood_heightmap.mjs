/**
 * bake_ashwood_heightmap — exports the Ashwood terrain as a 16-bit grayscale
 * PNG heightmap + JSON sidecar, for Unreal Engine Landscape import (or any
 * DCC displacement workflow).
 *
 *   node scripts/bake_ashwood_heightmap.mjs                 # 2017×2017, full world
 *   node scripts/bake_ashwood_heightmap.mjs --size 1009     # quicker preview
 *   node scripts/bake_ashwood_heightmap.mjs --out export/ashwood
 *
 * 2017 is a UE-recommended landscape resolution; at the default extent it
 * samples the full ±1008 m tile world at 1 m/px. Heights are normalized to
 * 0..65535; the sidecar records the linear mapping back to meters plus the
 * UE "Z scale" value (UE landscapes span -256..+255.992 m at Z scale 100).
 *
 * No Babylon needed — pure worldgen math + a dependency-free PNG encoder.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

const args = process.argv.slice(2);
const argValue = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
// Which world to bake. Defaults to the LIVE world (zone1_world.json); pass
// --config <path> (repo-root-relative) to bake a different one (e.g. ashwood).
const configPath = argValue('--config') ?? 'src/features/world/config/zone1_world.json';

const worldConfig = JSON.parse(readFileSync(join(root, configPath), 'utf8'));
const { createWorldgen } = await import('../src/features/world/worldgen/index.js');

const size = parseInt(argValue('--size') ?? '2017', 10);
const half = parseFloat(argValue('--half-extent') ?? '1008');
const outDir = argValue('--out') ?? join(root, 'export/ashwood');

const wg = createWorldgen(worldConfig);
const step = (2 * half) / (size - 1);

console.log(`sampling ${size}×${size} (${(2 * half).toFixed(0)} m at ${step.toFixed(2)} m/px)…`);
const t0 = performance.now();
const heights = new Float64Array(size * size);
let min = Infinity, max = -Infinity;
for (let row = 0; row < size; row++) {
  // PNG rows top→bottom; map row 0 to the world's -Z edge (north) so the
  // image reads like the in-game map (north up).
  const z = -half + row * step;
  for (let col = 0; col < size; col++) {
    const x = -half + col * step;
    const h = wg.surfaceY(x, z);
    heights[row * size + col] = h;
    if (h < min) min = h;
    if (h > max) max = h;
  }
}
console.log(`sampled in ${((performance.now() - t0) / 1000).toFixed(1)}s  range ${min.toFixed(2)}..${max.toFixed(2)} m`);

// ── 16-bit grayscale PNG (color type 0, bit depth 16, filter 0) ────────────
const range = max - min || 1;
const raw = Buffer.alloc(size * (1 + size * 2));
let o = 0;
for (let row = 0; row < size; row++) {
  raw[o++] = 0; // filter: none
  for (let col = 0; col < size; col++) {
    const v = Math.round(((heights[row * size + col] - min) / range) * 65535);
    raw[o++] = v >> 8;
    raw[o++] = v & 0xff;
  }
}

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0);
ihdr.writeUInt32BE(size, 4);
ihdr[8] = 16; // bit depth
ihdr[9] = 0;  // grayscale
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(outDir, { recursive: true });
const base = `ashwood_heightmap_${size}`;
writeFileSync(join(outDir, `${base}.png`), png);

// UE Landscape: at Z scale 100 the 16-bit range spans 512 m (-256..+255.992).
// zScale below makes the imported landscape match world meters exactly.
const sidecar = {
  source: 'scripts/bake_ashwood_heightmap.mjs',
  worldConfig: configPath,
  seed: worldConfig.seed,
  width: size,
  height: size,
  metersPerPixel: step,
  origin: { x: -half, z: -half, note: 'pixel (0,0) = world north-west corner; +row = +z (south)' },
  heightMapping: {
    minMeters: min,
    maxMeters: max,
    note: 'meters = min + (value / 65535) * (max - min)',
  },
  unreal: {
    zScale: ((max - min) / 512) * 100,
    zOffsetMeters: (max + min) / 2,
    xyScale: step * 100,
    note: 'UE units are cm. Set Landscape scale Z to zScale, XY to xyScale; raise the landscape by zOffsetMeters*100 - or simply align the lake surface to -0.5 m.',
  },
};
writeFileSync(join(outDir, `${base}.json`), JSON.stringify(sidecar, null, 2));
console.log(`wrote ${join(outDir, base)}.png (${(png.length / 1048576).toFixed(1)} MB) + .json sidecar`);
