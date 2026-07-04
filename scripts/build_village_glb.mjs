/**
 * build_village_glb.mjs — process the Meshy-AI village into a game prop.
 *
 *   npm run build:village
 *
 * Input : assets_src/village/meshy_village_source.glb (Meshy AI export,
 *         66 flat-colored parts in the segmentation-preview palette, no
 *         textures, ~1.9 M triangles, normalized to a 0.2 m footprint)
 * Output: public/assets/props/village_center.glb — recolored to a natural
 *         palette, rescaled to meters (VILLAGE_W wide, height compressed so
 *         the stylized-tall houses stay ~2-3 stories), simplified to a
 *         web-friendly triangle budget, quantized + meshopt-compressed.
 *
 * Also refreshes public/vendor/meshopt_decoder.js (the self-hosted decoder
 * Babylon is pointed at by game/meshoptConfig.js — the CDN default is
 * CSP-blocked in production).
 *
 * The recolor works off PART_ROLE below: each of the 66 parts is classified
 * into a semantic role (roof / wall / window / chimney / foliage / ground …)
 * from its source palette family + measured shape, with a small override
 * table for the ambiguous ones. Tweak PALETTE / OVERRIDES and re-run to
 * restyle the village.
 */

import { NodeIO } from '@gltf-transform/core';
import { KHRMeshQuantization, EXTMeshoptCompression } from '@gltf-transform/extensions';
import {
  dequantize, flatten, clearNodeTransform, weld, simplify, prune, dedup, meshopt,
} from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder } from 'meshoptimizer';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const SRC = join(repoRoot, 'assets_src/village/meshy_village_source.glb');
const OUT = join(repoRoot, 'public/assets/props/village_center.glb');

// ── Tunables ─────────────────────────────────────────────────────────────────
const VILLAGE_W = 75;          // footprint (largest XZ extent) in meters
const HEIGHT_SCALE = 0.5;      // Y scale relative to XZ (Meshy houses are stylized-tall)
const TRI_BUDGET_RATIO = 0.12; // simplify keeps ~this fraction of triangles
const SIMPLIFY_ERROR = 0.015;  // simplifier error tolerance (fraction of extent)

// Natural palette (linear-ish sRGB factors, matching the game's flat-color props).
// Slightly over-saturated on purpose: the in-game fog + grading LUT wash
// distant colors toward pastel, so the source colors need extra punch.
const PALETTE = {
  roof_russet:    [0.52, 0.24, 0.15],
  roof_slate:     [0.28, 0.41, 0.53],
  wall_cream:     [0.87, 0.78, 0.58],
  wall_sage:      [0.76, 0.76, 0.56],
  window:         [0.34, 0.51, 0.65],
  chimney:        [0.56, 0.53, 0.48],
  timber:         [0.40, 0.27, 0.17],
  hedge:          [0.29, 0.47, 0.22],
  foliage_dark:   [0.21, 0.39, 0.17],
  foliage_light:  [0.40, 0.57, 0.26],
  terracotta:     [0.68, 0.38, 0.23],
  // ground plate roles (applied as vertex colors, material stays white)
  path:           [0.56, 0.50, 0.39],
  grass:          [0.34, 0.48, 0.24],
  stone:          [0.54, 0.52, 0.47],
};

// Per-part overrides where the family+shape classifier gets it wrong.
// Keyed by part index (mesh_N / model_partN in the source).
const OVERRIDES = {
  9:  'timber',      // window ledge strip
  11: 'path',        // flat rug/paving patch on the plaza
  12: 'timber',      // planter/crate cluster
  14: 'terracotta',  // flat garden bed / awning piece
  17: 'timber',      // door
  30: 'window',      // shutters (blue-mauve)
  34: 'timber',      // bench/planter box
};

// Source palette families (Meshy segmentation colors, matched with tolerance).
const FAMILIES = {
  blue:       [0.13, 0.46, 0.69],
  green:      [0.17, 0.63, 0.17],
  red:        [0.85, 0.16, 0.16],
  purple:     [0.59, 0.41, 0.74],
  pink:       [0.88, 0.47, 0.76],
  olive:      [0.74, 0.74, 0.13],
  lightgreen: [0.60, 0.85, 0.52],
  brightgreen:[0.48, 0.70, 0.15],
  midgreen:   [0.44, 0.79, 0.37],
};

function familyOf(rgb) {
  let best = null, bestD = Infinity;
  for (const [name, ref] of Object.entries(FAMILIES)) {
    const d = ref.reduce((s, v, i) => s + (v - rgb[i]) ** 2, 0);
    if (d < bestD) { bestD = d; best = name; }
  }
  return bestD < 0.06 ? best : 'other';
}

/**
 * Classify a part into a palette role from its source color family + shape.
 * size/minY are in the source's world units (village footprint ≈ 0.2, ground
 * plate top at y ≈ 0, roof ridges ≈ 0.095, chimney tops ≈ 0.12).
 */
function roleOf(index, family, size, minY) {
  if (OVERRIDES[index] !== undefined) return OVERRIDES[index];
  if (index === 62) return 'ground';
  const maxXZ = Math.max(size[0], size[2]);
  switch (family) {
    case 'purple': return 'roof_russet';
    case 'blue':   return maxXZ > 0.03 ? 'roof_slate' : 'window';
    case 'pink':   return size[1] > 0.02 && minY > 0.01 ? 'chimney' : 'wall_cream';
    case 'green':  return size[1] > 0.025 && minY > -0.005 ? 'chimney' : 'foliage_dark';
    case 'olive':  return 'hedge';
    case 'lightgreen':
      // big chunks are the sage-plastered houses; small bits are vines/shrubs
      return maxXZ > 0.02 ? 'wall_sage' : 'foliage_light';
    case 'brightgreen':
    case 'midgreen': return 'foliage_light';
    case 'red':    return 'terracotta';
    default:       return 'wall_cream';
  }
}

// ── Pipeline ─────────────────────────────────────────────────────────────────

const io = new NodeIO().registerExtensions([KHRMeshQuantization, EXTMeshoptCompression]);
io.registerDependencies({ 'meshopt.encoder': MeshoptEncoder });

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;

console.log('reading', SRC);
const doc = await io.read(SRC);

// 1. Float positions + world-space bake (all parts share one quantization
//    matrix and the root has a normalization matrix — flatten then clear).
await doc.transform(dequantize(), flatten());
for (const node of doc.getRoot().listNodes()) clearNodeTransform(node);

// 2. Measure, then classify + recolor each part. Parts are 1:1 with meshes
//    and materials (model_partN). Non-ground parts lose their COLOR_0 (flat
//    segmentation color, redundant once the material is recolored).
const meshes = doc.getRoot().listMeshes();
const partInfo = [];
for (const mesh of meshes) {
  const prim = mesh.listPrimitives()[0];
  // Part index rides on the material name ('model_partN'); mesh names are empty.
  const idx = Number(/(\d+)$/.exec(prim.getMaterial().getName())?.[1] ?? -1);
  const pos = prim.getAttribute('POSITION');
  const mn = pos.getMinNormalized([]), mx = pos.getMaxNormalized([]);
  const size = mn.map((v, i) => mx[i] - v);
  const mat = prim.getMaterial();
  const family = familyOf(mat.getBaseColorFactor().slice(0, 3));
  const role = roleOf(idx, family, size, mn[1]);
  partInfo.push({ idx, mesh, role, minY: mn[1], maxY: mx[1] });
  if (process.env.VILLAGE_DEBUG) console.log(`part ${idx}: ${family} -> ${role}`);
}

const globalMinY = Math.min(...partInfo.map((p) => p.minY));

for (const { idx, mesh, role } of partInfo) {
  for (const prim of mesh.listPrimitives()) {
    const mat = prim.getMaterial();
    mat.setRoughnessFactor(0.9).setMetallicFactor(0);
    if (role === 'ground') {
      // Vertex-colored by height band: engraved paths/plaza low, lawns on
      // the slightly-raised areas, curbs/steps/the plaza well in stone.
      // Bands read off the plate's height quantiles (p55 ≈ 0.0017,
      // p97 ≈ 0.008 in source units).
      mat.setBaseColorFactor([1, 1, 1, 1]);
      const pos = prim.getAttribute('POSITION');
      const color = prim.getAttribute('COLOR_0');
      const n = pos.getCount();
      const out = new Float32Array(n * 3);
      const v = [];
      for (let i = 0; i < n; i++) {
        pos.getElement(i, v);
        const h = v[1] - globalMinY;
        let c;
        if (h > 0.006) c = PALETTE.stone;
        else if (h > 0.0017) c = PALETTE.grass;
        else c = PALETTE.path;
        out.set(c, i * 3);
      }
      const buffer = doc.getRoot().listBuffers()[0];
      const acc = doc.createAccessor().setType('VEC3').setArray(out).setBuffer(buffer);
      if (color) color.dispose();
      prim.setAttribute('COLOR_0', acc);
    } else {
      mat.setBaseColorFactor([...PALETTE[role], 1]);
      const color = prim.getAttribute('COLOR_0');
      if (color) { prim.setAttribute('COLOR_0', null); color.dispose(); }
    }
  }
}

// 3. Rescale to meters and recenter: XZ centered on origin, base at y = 0.
//    (Baked into the geometry so PropsSystem can place it 1:1; height is
//    deliberately compressed — see HEIGHT_SCALE.)
{
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const mesh of meshes) for (const prim of mesh.listPrimitives()) {
    const a = prim.getAttribute('POSITION').getMinNormalized([]);
    const b = prim.getAttribute('POSITION').getMaxNormalized([]);
    for (let i = 0; i < 3; i++) { mn[i] = Math.min(mn[i], a[i]); mx[i] = Math.max(mx[i], b[i]); }
  }
  const cx = (mn[0] + mx[0]) / 2, cz = (mn[2] + mx[2]) / 2;
  const sXZ = VILLAGE_W / Math.max(mx[0] - mn[0], mx[2] - mn[2]);
  const sY = sXZ * HEIGHT_SCALE;
  const seen = new Set();
  for (const mesh of meshes) for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION');
    if (seen.has(pos)) continue;
    seen.add(pos);
    const arr = pos.getArray();
    for (let i = 0; i < arr.length; i += 3) {
      arr[i]     = (arr[i] - cx) * sXZ;
      arr[i + 1] = (arr[i + 1] - mn[1]) * sY;
      arr[i + 2] = (arr[i + 2] - cz) * sXZ;
    }
    pos.setArray(arr);
  }
  console.log(`scaled: footprint ${(mx[0]-mn[0])*sXZ|0}x${(mx[2]-mn[2])*sXZ|0} m, height ${((mx[1]-mn[1])*sY).toFixed(1)} m`);
}

// 4. Simplify to the triangle budget, then compress.
const trisBefore = countTris(doc);
await doc.transform(
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: TRI_BUDGET_RATIO, error: SIMPLIFY_ERROR }),
  dedup(),
  prune(),
  meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
);
const trisAfter = countTris(doc);

mkdirSync(dirname(OUT), { recursive: true });
await io.write(OUT, doc);
const bytes = readFileSync(OUT).length;
console.log(`tris ${trisBefore} -> ${trisAfter}; wrote ${OUT} (${(bytes / 1e6).toFixed(2)} MB)`);

// 5. Refresh the self-hosted meshopt decoder Babylon uses at runtime
//    (UMD build: registers the MeshoptDecoder global as a plain script).
const decoderSrc = readFileSync(join(repoRoot, 'node_modules/meshoptimizer/meshopt_decoder.cjs'));
mkdirSync(join(repoRoot, 'public/vendor'), { recursive: true });
writeFileSync(join(repoRoot, 'public/vendor/meshopt_decoder.js'), decoderSrc);
console.log('refreshed public/vendor/meshopt_decoder.js');

function countTris(document) {
  let t = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      t += (idx ? idx.getCount() : prim.getAttribute('POSITION').getCount()) / 3;
    }
  }
  return Math.round(t);
}
