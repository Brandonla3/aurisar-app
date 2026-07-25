/**
 * render_world_plan.mjs — a top-down, to-scale plan view of the live world.
 *
 * Why this exists: everything in this world is authored as numbers in JSON and
 * TS, and until now the only way to check a placement was to reason about
 * coordinates. That does not scale — the hub alone has 25 props, 7 NPCs and 7
 * road throats, and it is genuinely hard to notice from a table that an NPC is
 * standing inside a building or that a fence crosses a road.
 *
 * Emits BOTH:
 *   • .svg — vector, exact, opens in any browser, greppable text labels
 *   • .png — rasterized via sharp, so it can be viewed in any image tool
 *
 * It reads the same sources the game does (worldgen config, content graph,
 * PropsSystem's footprint table), so the drawing cannot drift from the world.
 *
 * Usage:
 *   npm run plan                        # whole zone
 *   npm run plan -- --view hub          # the settlement, close in
 *   npm run plan -- --center 76,-76 --radius 60 --name gallows
 *   npm run plan -- --no-png            # skip rasterizing
 *
 * Views are named presets; --center/--radius override.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWorldgen } from '../src/features/world/worldgen/index.js';
import { buildPropColliders } from '../src/features/world/systems/propFootprints.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

// ── args ────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (k, d) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const VIEWS = {
  zone:  { cx: 0, cz: 0, r: 200, name: 'zone' },
  world: { cx: 0, cz: 0, r: 520, name: 'world' },
  hub:   { cx: 0, cz: 0, r: 45,  name: 'hub' },
};
const viewKey = arg('view', 'zone');
const preset = VIEWS[viewKey] ?? VIEWS.zone;
const centerArg = arg('center', null);
const [cx, cz] = centerArg ? centerArg.split(',').map(Number) : [preset.cx, preset.cz];
const R = Number(arg('radius', preset.r));
const NAME = arg('name', preset.name);
const SIZE = Number(arg('size', 1400));
const WANT_PNG = !argv.includes('--no-png');

const OUT_DIR = join(repoRoot, 'docs', 'world-plans');

// ── world data ──────────────────────────────────────────────────────────────
const config = JSON.parse(
  readFileSync(join(repoRoot, 'src/features/world/config/zone1_world.json'), 'utf8'),
);
const wg = createWorldgen(config);

// Content graph is TS; read the authored literals without a compile step.
const readTs = (rel) => readFileSync(join(repoRoot, 'src/features/world/content', rel), 'utf8');
const npcs = [...readTs('zones/zone1/npcs.ts')
  .matchAll(/id:\s*'([^']+)'[\s\S]{0,400}?pos:\s*\{\s*x:\s*(-?[\d.]+),\s*z:\s*(-?[\d.]+)\s*\}/g)]
  .map((m) => ({ id: m[1], x: +m[2], z: +m[3] }));

// ZONE1_PROPS is a TS object literal whose values include type assertions and
// arithmetic (`Math.PI / 2`), so JSON.parse cannot read it. Stripping the type
// assertions and evaluating the literal handles both, and keeps this script
// honest about reading the SAME authored data the game does rather than a copy.
// Safe here: the input is a file in this repo, not user data. If props.ts ever
// grows imports or function calls, emit a generated JSON instead of extending
// this.
function readZone1Props() {
  const src = readTs('zones/zone1/props.ts');
  const start = src.indexOf('{', src.indexOf('ZONE1_PROPS'));
  let depth = 0, end = -1;
  for (let i = start; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) { end = i + 1; break; }
  }
  const body = src.slice(start, end)
    .replace(/\bas\s+[A-Za-z_]\w*(\s*\[\s*\])?/g, ''); // TS type assertions
  return new Function(`return (${body});`)();
}
const zone1Props = readZone1Props();
const colliders = buildPropColliders(zone1Props);

// ── projection ──────────────────────────────────────────────────────────────
// +z is north and north is up, so z is drawn INVERTED — matching
// mapRender.worldToPx. Everything else is expressed through this pair.
const S = SIZE / (2 * R);
const PX = (x) => (x - cx) * S + SIZE / 2;
const PY = (z) => SIZE / 2 - (z - cz) * S;
const M = (m) => m * S; // meters → px

const parts = [];
const add = (s) => parts.push(s);
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// ── terrain raster ──────────────────────────────────────────────────────────
// One rect per cell is far too heavy at 1400px, so bake the biome/lake/void
// field into a coarse grid and emit it as an <image> data URI is overkill too;
// instead draw a modest grid of rects (fast, and the SVG stays inspectable).
const CELLS = 180;
const step = (2 * R) / CELLS;
const col = { r: 0, g: 0, b: 0 };
add(`<g id="terrain">`);
for (let i = 0; i < CELLS; i++) {
  for (let j = 0; j < CELLS; j++) {
    const wx = cx - R + (i + 0.5) * step;
    const wz = cz - R + (j + 0.5) * step;
    let fill;
    if (wx * wx + wz * wz > config.radius * config.radius) fill = '#0e1016';
    else if (wg.lakeWaterDepthAt(wx, wz) > 0.05) fill = '#264a6e';
    else {
      wg.biomeColorAt(wx, wz, col);
      // Hillshade. The 2D maps bake biome colour only, so terrain relief is
      // invisible on them — the Frostspire massif and a flat hub plateau look
      // identical. A cheap Lambert term over the real surfaceY gradient makes
      // shelves, road cuts and slopes legible. (This is the outstanding
      // "height/relief shading" item from world-diagnostic Batch 1.)
      const e = Math.max(step * 0.5, 0.75);
      const hL = wg.surfaceY(wx - e, wz), hR = wg.surfaceY(wx + e, wz);
      const hD = wg.surfaceY(wx, wz - e), hU = wg.surfaceY(wx, wz + e);
      const nx = (hL - hR) / (2 * e), nz = (hD - hU) / (2 * e);
      // Light from the upper-left, 45° elevation.
      const inv = 1 / Math.hypot(nx, nz, 1);
      const lam = Math.max(0, (nx * -0.6 + nz * -0.6 + 1.0) * inv);
      const shade = 0.72 + 0.55 * lam;
      const mix = (v) => Math.max(0, Math.min(255, Math.round(((v * 255) * 0.62 + 40) * shade)));
      fill = `rgb(${mix(col.r)},${mix(col.g)},${mix(col.b)})`;
    }
    // PY decreases as world z increases (north is up), so the cell's top
    // edge in pixel-space comes from its LARGER-z bound, not wz - step/2.
    add(`<rect x="${PX(wx - step / 2).toFixed(1)}" y="${PY(wz + step / 2).toFixed(1)}" width="${(M(step) + 1).toFixed(1)}" height="${(M(step) + 1).toFixed(1)}" fill="${fill}"/>`);
  }
}
add(`</g>`);

// ── trails / roads ──────────────────────────────────────────────────────────
const halfW = config.trailHalfWidth ?? 3.1;
add(`<g id="roads">`);
for (const curve of wg.trailCurves) {
  const d = curve.map((p, i) => `${i ? 'L' : 'M'}${PX(p[0]).toFixed(1)},${PY(p[1]).toFixed(1)}`).join(' ');
  // Carriageway width to scale — this is what a prop has to stay out of.
  add(`<path d="${d}" fill="none" stroke="rgba(196,168,120,0.55)" stroke-width="${M(halfW * 2).toFixed(1)}" stroke-linecap="round" stroke-linejoin="round"/>`);
  add(`<path d="${d}" fill="none" stroke="rgba(120,96,60,0.9)" stroke-width="1.2" stroke-dasharray="6 5"/>`);
}
add(`</g>`);

// ── worldgen sites ──────────────────────────────────────────────────────────
add(`<g id="sites">`);
for (const c of wg.sites.chests) {
  add(`<rect x="${(PX(c.x) - 4).toFixed(1)}" y="${(PY(c.z) - 4).toFixed(1)}" width="8" height="8" fill="#f2c14e" stroke="#3a2c08" stroke-width="1"/>`);
}
for (const r of wg.sites.ruins) add(`<circle cx="${PX(r.x).toFixed(1)}" cy="${PY(r.z).toFixed(1)}" r="5" fill="none" stroke="#cbd5e1" stroke-width="1.6"/>`);
for (const c of wg.sites.caves) add(`<circle cx="${PX(c.x).toFixed(1)}" cy="${PY(c.z).toFixed(1)}" r="5" fill="#1e293b" stroke="#94a3b8" stroke-width="1.4"/>`);
add(`</g>`);

// ── prop footprints (the real collision geometry) ───────────────────────────
add(`<g id="props">`);
for (const c of colliders) {
  if (c.kind === 'rect') {
    const w = M(c.w), d = M(c.d);
    add(`<g transform="translate(${PX(c.x).toFixed(1)},${PY(c.z).toFixed(1)}) rotate(${(c.rot * 180 / Math.PI).toFixed(2)})">`
      + `<rect x="${(-w / 2).toFixed(1)}" y="${(-d / 2).toFixed(1)}" width="${w.toFixed(1)}" height="${d.toFixed(1)}" `
      + `fill="rgba(180,80,60,0.30)" stroke="#b4503c" stroke-width="1.5"/></g>`);
  } else {
    add(`<circle cx="${PX(c.x).toFixed(1)}" cy="${PY(c.z).toFixed(1)}" r="${M(c.r).toFixed(1)}" fill="rgba(180,80,60,0.28)" stroke="#b4503c" stroke-width="1.3"/>`);
  }
  if (M(Math.max(c.w ?? c.r * 2, c.d ?? c.r * 2)) > 22) {
    add(`<text x="${PX(c.x).toFixed(1)}" y="${(PY(c.z) + 3).toFixed(1)}" fill="#ffd9cf" font-family="ui-monospace,monospace" font-size="9" text-anchor="middle">${esc(c.label)}</text>`);
  }
}
add(`</g>`);

// ── NPCs: position, 12 m spacing target, 5 m talk radius ────────────────────
add(`<g id="npcs">`);
for (const n of npcs) {
  add(`<circle cx="${PX(n.x).toFixed(1)}" cy="${PY(n.z).toFixed(1)}" r="${M(5).toFixed(1)}" fill="rgba(96,180,255,0.10)" stroke="rgba(96,180,255,0.5)" stroke-width="1" stroke-dasharray="4 3"/>`);
  add(`<circle cx="${PX(n.x).toFixed(1)}" cy="${PY(n.z).toFixed(1)}" r="${M(6).toFixed(1)}" fill="none" stroke="rgba(96,180,255,0.22)" stroke-width="1"/>`);
  add(`<circle cx="${PX(n.x).toFixed(1)}" cy="${PY(n.z).toFixed(1)}" r="5" fill="#3ba7ff" stroke="#04203a" stroke-width="1.5"/>`);
  add(`<text x="${PX(n.x).toFixed(1)}" y="${(PY(n.z) - 9).toFixed(1)}" fill="#cfe9ff" font-family="ui-monospace,monospace" font-size="10" text-anchor="middle">${esc(n.id)}</text>`);
}
add(`</g>`);

// ── landmarks ───────────────────────────────────────────────────────────────
const lmSrc = readTs('zones/zone1/landmarks.generated.ts');
const landmarks = [...lmSrc.matchAll(/(\w+):\s*\{\s*id:\s*'([^']+)',\s*name:\s*"([^"]*)",\s*x:\s*(-?[\d.]+),\s*z:\s*(-?[\d.]+)\s*\}/g)]
  .map((m) => ({ id: m[2], name: m[3], x: +m[4], z: +m[5] }));
add(`<g id="landmarks">`);
for (const l of landmarks) {
  add(`<path d="M${PX(l.x).toFixed(1)},${(PY(l.z) - 9).toFixed(1)} l7,9 l-7,9 l-7,-9 z" fill="#ffd54a" stroke="#3a2c08" stroke-width="1.4"/>`);
  add(`<text x="${PX(l.x).toFixed(1)}" y="${(PY(l.z) + 24).toFixed(1)}" fill="#fff3c4" font-family="ui-monospace,monospace" font-size="11" font-weight="600" text-anchor="middle">${esc(l.name)}</text>`);
}
add(`</g>`);

// ── frame, scale bar, compass ───────────────────────────────────────────────
add(`<g id="frame">`);
add(`<circle cx="${PX(0).toFixed(1)}" cy="${PY(0).toFixed(1)}" r="${M(config.radius).toFixed(1)}" fill="none" stroke="rgba(255,220,80,0.5)" stroke-width="2"/>`);
// scale bar
const barM = R >= 300 ? 100 : R >= 100 ? 50 : 10;
add(`<g transform="translate(24,${SIZE - 34})">`
  + `<rect x="-6" y="-20" width="${(M(barM) + 90).toFixed(0)}" height="34" fill="rgba(10,12,18,0.72)" rx="4"/>`
  + `<line x1="0" y1="0" x2="${M(barM).toFixed(1)}" y2="0" stroke="#fff" stroke-width="3"/>`
  + `<text x="${(M(barM) + 8).toFixed(1)}" y="4" fill="#fff" font-family="ui-monospace,monospace" font-size="13">${barM} m</text></g>`);
// Compass. +z is north (worldSpace.js) and north is up, so this agrees with
// both 2D maps and the in-game compass strip.
add(`<g transform="translate(${SIZE - 58},64)">`
  + `<circle r="34" fill="rgba(10,12,18,0.75)"/>`
  + `<line x1="0" y1="22" x2="0" y2="-18" stroke="#fff" stroke-width="2"/>`
  + `<path d="M0,-24 l5,8 l-10,0 z" fill="#fff"/>`
  + `<text x="0" y="-27" fill="#fff" font-family="ui-monospace,monospace" font-size="13" font-weight="700">N</text>`
  + `<text x="0" y="34" fill="#9aa" font-family="ui-monospace,monospace" font-size="10" text-anchor="middle">+z</text></g>`);
add(`<text x="16" y="26" fill="#fff" font-family="ui-monospace,monospace" font-size="15" font-weight="700">Aurisar — ${esc(NAME)}  ·  centre (${cx}, ${cz})  ·  r ${R} m</text>`);
add(`</g>`);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`
  + `<rect width="${SIZE}" height="${SIZE}" fill="#0e1016"/>${parts.join('')}</svg>`;

mkdirSync(OUT_DIR, { recursive: true });
const svgPath = join(OUT_DIR, `${NAME}.svg`);
writeFileSync(svgPath, svg);
console.log(`  wrote ${svgPath.replace(repoRoot + '/', '')}  (${(svg.length / 1024).toFixed(0)} KB)`);

if (WANT_PNG) {
  const { default: sharp } = await import('sharp');
  const pngPath = join(OUT_DIR, `${NAME}.png`);
  await sharp(Buffer.from(svg)).png().toFile(pngPath);
  console.log(`  wrote ${pngPath.replace(repoRoot + '/', '')}`);
}

console.log(`  ${colliders.length} prop colliders · ${npcs.length} NPCs · ${landmarks.length} landmarks · ${wg.sites.chests.length} chests`);
