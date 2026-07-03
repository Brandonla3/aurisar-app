/**
 * generate_env_hdris.mjs — authors the Phase 0 IBL environment maps into
 * /public/env/ as equirectangular RADIANCE .hdr panoramas:
 *
 *   overworld_day.hdr    daytime sky gradient + soft midday sun glow
 *   overworld_night.hdr  dim night gradient + faint moon glow
 *   dungeon_dim.hdr      near-dark, faintly warm from above
 *
 *   node scripts/generate_env_hdris.mjs
 *
 * The runtime loader (_loadEnvSafe) accepts either prefiltered .env or raw
 * .hdr for each slot; .hdr is prefiltered on load by HDRCubeTexture (GPU
 * PMREM, ~100-300ms on real devices). Pure Node, no dependencies — flat
 * (non-RLE) RGBE scanlines, which Babylon's parser reads via its
 * uncompressed fallback.
 *
 * The sky colors mirror AshwoodSky's palette so the baked skybox/IBL
 * matches the shader dome the scene cross-fades against. The day sun is a
 * soft broad glow at its MIDDAY position (the HDRI is only fully visible at
 * full day, when the dome has cross-faded out; the dome still owns the
 * crisp animated sun at dawn/dusk) — no hard disc, so there's never a
 * "second sun" reading.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'env');
const W = 256, H = 128;

const lerp = (a, b, t) => a + (b - a) * t;
const hex = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (v) => { const l = Math.hypot(...v); return v.map((x) => x / l); };

// AshwoodSky palette (day/night top+bot; mid = mix(top, bot, 0.38))
const D_TOP = hex(0x2b5aac), D_BOT = hex(0x86b2dd);
const N_TOP = hex(0x1e2c4a), N_BOT = hex(0x303444);
const mid = (top, bot) => top.map((v, i) => lerp(v, bot[i], 0.38));

// Sun toward its midday position (LightingManager phase math at tod=12);
// moon glow used by the night map.
const SUN = norm([0, 0.838, -0.545]);
const MOON = norm([0, 0.7, 0.5]);

function skyGradient(top, bot, d, groundScale) {
  const m = mid(top, bot);
  const h = d[1];
  if (h >= 0) {
    const zenith = 1 - Math.exp(-h * 3.4);           // AshwoodSky falloff
    return m.map((v, i) => lerp(v, top[i], zenith));
  }
  // Below horizon: darkened ground bounce, not mirrored sky — this is what
  // the IBL lights the underside of objects with.
  const k = Math.min(1, -h * 3);
  const ground = [0.16, 0.17, 0.13].map((v) => v * groundScale);
  return m.map((v, i) => lerp(v, ground[i], k));
}

const SHADERS = {
  'overworld_day.hdr': (d) => {
    const c = skyGradient(D_TOP, D_BOT, d, 1);
    const mu = Math.max(dot(d, SUN), 0);
    const glow = Math.pow(mu, 220) * 14 + Math.pow(mu, 8) * 0.35;
    return [c[0] + glow, c[1] + glow * 0.92, c[2] + glow * 0.8];
  },
  'overworld_night.hdr': (d) => {
    const c = skyGradient(N_TOP, N_BOT, d, 0.25).map((v) => v * 0.28);
    const mu = Math.max(dot(d, MOON), 0);
    const glow = Math.pow(mu, 160) * 0.9 + Math.pow(mu, 10) * 0.05;
    return [c[0] + glow * 0.75, c[1] + glow * 0.82, c[2] + glow];
  },
  'dungeon_dim.hdr': (d) => {
    // near-dark, faintly warm from above (torch bounce off stone ceilings)
    const up = Math.max(d[1], 0);
    const base = 0.012 + 0.024 * up;
    return [base * 1.25, base * 1.05, base * 0.85];
  },
};

function encodeHDR(shade) {
  const header = `#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y ${H} +X ${W}\n`;
  const head = Buffer.from(header, 'ascii');
  const data = Buffer.alloc(W * H * 4);
  let o = 0;
  for (let y = 0; y < H; y++) {
    const theta = ((y + 0.5) / H) * Math.PI;          // 0 = zenith row
    const sy = Math.cos(theta);
    const sxz = Math.sin(theta);
    for (let x = 0; x < W; x++) {
      const phi = ((x + 0.5) / W) * Math.PI * 2 - Math.PI;
      const d = [Math.sin(phi) * sxz, sy, -Math.cos(phi) * sxz];
      let [r, g, b] = shade(d);
      r = Math.max(r, 0); g = Math.max(g, 0); b = Math.max(b, 0);
      const m = Math.max(r, g, b);
      if (m < 1e-9) { o += 4; continue; }              // 0,0,0,0 = black
      const e = Math.ceil(Math.log2(m));
      const s = Math.pow(2, -e) * 255.9999;
      data[o++] = Math.min(255, r * s) | 0;
      data[o++] = Math.min(255, g * s) | 0;
      data[o++] = Math.min(255, b * s) | 0;
      data[o++] = e + 128;
    }
  }
  return Buffer.concat([head, data]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, shade] of Object.entries(SHADERS)) {
  const bytes = encodeHDR(shade);
  const path = join(OUT, name);
  writeFileSync(path, bytes);
  console.log(`wrote ${path} (${bytes.length} bytes)`);
}
