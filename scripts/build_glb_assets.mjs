/**
 * build_glb_assets.mjs — pure-Node placeholder GLB generator.
 *
 * Produces:
 *   public/assets/mobs/wolf.glb            — quadruped composite, baked geometry
 *   public/assets/tiles/T_03_03_render.glb — sample 256m tile, plane + scattered trees
 *
 * Why pure Node (and not Babylon NullEngine + GLTF2Export):
 *   The Babylon serializers' Node path has three years of forum reports of
 *   missing materials, missing lights, and broken texture pixel reads. We
 *   skip that entirely and emit glTF buffers ourselves via @gltf-transform/core.
 *
 * Output format: glTF 2.0 binary (.glb), PBR materials, no textures (per-mesh
 * baseColor only — keeps file size tiny and runtime LoadAssetContainerAsync
 * snappy). The runtime loader is `LoadAssetContainerAsync` in MobAssetLibrary
 * (mobs) and GlbTileProvider (tiles).
 *
 * Re-run with:  npm run build:glb
 */

import { Document, NodeIO } from '@gltf-transform/core';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

// ── Geometry helpers ─────────────────────────────────────────────────────────
// Each helper returns { positions, normals, indices } where positions/normals
// are flat Float32Arrays (x,y,z,x,y,z,...) and indices is a Uint32Array.
// Triangles, CCW winding, +Y up, +Z forward.

function emptyGeo() {
  return { positions: [], normals: [], indices: [] };
}

function pushQuad(geo, a, b, c, d, n) {
  // CCW-wound quad split into two triangles: a-b-c and a-c-d.
  const base = geo.positions.length / 3;
  geo.positions.push(...a, ...b, ...c, ...d);
  geo.normals.push(...n, ...n, ...n, ...n);
  geo.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function box(w, h, d, cx = 0, cy = 0, cz = 0) {
  const g = emptyGeo();
  const x0 = cx - w / 2, x1 = cx + w / 2;
  const y0 = cy - h / 2, y1 = cy + h / 2;
  const z0 = cz - d / 2, z1 = cz + d / 2;
  // +X face
  pushQuad(g, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [1, 0, 0]);
  // -X face
  pushQuad(g, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [-1, 0, 0]);
  // +Y face
  pushQuad(g, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [0, 1, 0]);
  // -Y face
  pushQuad(g, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]);
  // +Z face
  pushQuad(g, [x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [0, 0, 1]);
  // -Z face
  pushQuad(g, [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1]);
  return g;
}

function cylinder(rTop, rBottom, h, segments, cx = 0, cy = 0, cz = 0) {
  // Vertical along +Y, centered at (cx, cy, cz).
  const g = emptyGeo();
  const halfH = h / 2;
  const y0 = cy - halfH, y1 = cy + halfH;

  // Side strip — one triangle pair per segment, flat per-segment normals
  // (good enough for low-poly placeholders, looks faceted/stylized).
  for (let i = 0; i < segments; i++) {
    const t0 = (i / segments) * Math.PI * 2;
    const t1 = ((i + 1) / segments) * Math.PI * 2;
    const c0 = Math.cos(t0), s0 = Math.sin(t0);
    const c1 = Math.cos(t1), s1 = Math.sin(t1);
    const p00 = [cx + rBottom * c0, y0, cz + rBottom * s0];
    const p01 = [cx + rTop    * c0, y1, cz + rTop    * s0];
    const p10 = [cx + rBottom * c1, y0, cz + rBottom * s1];
    const p11 = [cx + rTop    * c1, y1, cz + rTop    * s1];
    const nx = Math.cos((t0 + t1) / 2);
    const nz = Math.sin((t0 + t1) / 2);
    pushQuad(g, p00, p10, p11, p01, [nx, 0, nz]);
  }
  // Top fan (if radius > 0)
  if (rTop > 0) {
    const center = [cx, y1, cz];
    for (let i = 0; i < segments; i++) {
      const t0 = (i / segments) * Math.PI * 2;
      const t1 = ((i + 1) / segments) * Math.PI * 2;
      const p0 = [cx + rTop * Math.cos(t0), y1, cz + rTop * Math.sin(t0)];
      const p1 = [cx + rTop * Math.cos(t1), y1, cz + rTop * Math.sin(t1)];
      const base = g.positions.length / 3;
      g.positions.push(...center, ...p0, ...p1);
      g.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
      g.indices.push(base, base + 1, base + 2);
    }
  }
  // Bottom fan (if radius > 0)
  if (rBottom > 0) {
    const center = [cx, y0, cz];
    for (let i = 0; i < segments; i++) {
      const t0 = (i / segments) * Math.PI * 2;
      const t1 = ((i + 1) / segments) * Math.PI * 2;
      const p0 = [cx + rBottom * Math.cos(t0), y0, cz + rBottom * Math.sin(t0)];
      const p1 = [cx + rBottom * Math.cos(t1), y0, cz + rBottom * Math.sin(t1)];
      const base = g.positions.length / 3;
      g.positions.push(...center, ...p1, ...p0); // reversed for downward normal
      g.normals.push(0, -1, 0, 0, -1, 0, 0, -1, 0);
      g.indices.push(base, base + 1, base + 2);
    }
  }
  return g;
}

function cone(rBottom, h, segments, cx = 0, cy = 0, cz = 0) {
  return cylinder(0, rBottom, h, segments, cx, cy, cz);
}

function subdividedPlane(w, d, segsX, segsZ, cx = 0, cy = 0, cz = 0) {
  // Horizontal plane in the XZ plane at height cy. +Y normals.
  const g = emptyGeo();
  const x0 = cx - w / 2, z0 = cz - d / 2;
  const stepX = w / segsX, stepZ = d / segsZ;
  // Vertex grid: (segsX+1) × (segsZ+1)
  for (let j = 0; j <= segsZ; j++) {
    for (let i = 0; i <= segsX; i++) {
      g.positions.push(x0 + i * stepX, cy, z0 + j * stepZ);
      g.normals.push(0, 1, 0);
    }
  }
  // Triangles
  const stride = segsX + 1;
  for (let j = 0; j < segsZ; j++) {
    for (let i = 0; i < segsX; i++) {
      const a = j * stride + i;
      const b = a + 1;
      const c = a + stride;
      const d2 = c + 1;
      g.indices.push(a, c, d2, a, d2, b);
    }
  }
  return g;
}

// Rotate a geometry's positions+normals around X by `angle` rad. Used for the
// wolf tail (angled up-back from the rear).
function rotateX(g, angle, pivotY = 0, pivotZ = 0) {
  const c = Math.cos(angle), s = Math.sin(angle);
  for (let i = 0; i < g.positions.length; i += 3) {
    const y = g.positions[i + 1] - pivotY;
    const z = g.positions[i + 2] - pivotZ;
    g.positions[i + 1] = c * y - s * z + pivotY;
    g.positions[i + 2] = s * y + c * z + pivotZ;
    const ny = g.normals[i + 1];
    const nz = g.normals[i + 2];
    g.normals[i + 1] = c * ny - s * nz;
    g.normals[i + 2] = s * ny + c * nz;
  }
  return g;
}

function merge(...geos) {
  const out = emptyGeo();
  let offset = 0;
  for (const g of geos) {
    out.positions.push(...g.positions);
    out.normals.push(...g.normals);
    for (const idx of g.indices) out.indices.push(idx + offset);
    offset += g.positions.length / 3;
  }
  return out;
}

// ── Doc emission ─────────────────────────────────────────────────────────────

// Adds one Primitive (positions + normals + indices, single material) to the
// given Mesh. All gltf-transform Accessors are bound to the supplied Buffer.
function addPrimitive(doc, buffer, mesh, geo, material) {
  const pos = doc.createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array(geo.positions))
    .setBuffer(buffer);
  const nor = doc.createAccessor()
    .setType('VEC3')
    .setArray(new Float32Array(geo.normals))
    .setBuffer(buffer);
  const idx = doc.createAccessor()
    .setType('SCALAR')
    .setArray(new Uint32Array(geo.indices))
    .setBuffer(buffer);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', pos)
    .setAttribute('NORMAL', nor)
    .setIndices(idx)
    .setMaterial(material);
  mesh.addPrimitive(prim);
}

function makePbr(doc, name, rgb) {
  return doc.createMaterial(name)
    .setBaseColorFactor([rgb[0], rgb[1], rgb[2], 1])
    .setMetallicFactor(0.0)
    .setRoughnessFactor(0.9);
}

// ── Wolf asset ───────────────────────────────────────────────────────────────

async function buildWolf(outPath) {
  const doc = new Document();
  doc.createBuffer();
  const buf = doc.getRoot().listBuffers()[0];

  const matBody = makePbr(doc, 'wolf_body', [0.28, 0.26, 0.24]); // charcoal
  const matPale = makePbr(doc, 'wolf_pale', [0.55, 0.50, 0.44]); // muzzle / underside
  const matDark = makePbr(doc, 'wolf_dark', [0.12, 0.11, 0.10]); // ears / legs

  const mesh = doc.createMesh('wolf_mesh');

  // Body parts grouped by material.
  // Torso + head — body color.
  const bodyGeo = merge(
    box(0.55, 0.45, 1.0, 0, 0.65, 0),        // torso
    box(0.40, 0.38, 0.40, 0, 0.82, 0.62),    // head
  );
  addPrimitive(doc, buf, mesh, bodyGeo, matBody);

  // Snout — pale color.
  const snoutGeo = box(0.22, 0.20, 0.28, 0, 0.72, 0.90);
  addPrimitive(doc, buf, mesh, snoutGeo, matPale);

  // Ears + legs + tail — dark color (the tail uses body color, see below;
  // keeping it visually distinct from the body box helps silhouette).
  const earL = cone(0.07, 0.18, 4, -0.13, 1.08 - 0.09, 0.55);
  const earR = cone(0.07, 0.18, 4,  0.13, 1.08 - 0.09, 0.55);
  const fl   = cylinder(0.07, 0.07, 0.60, 6,  0.18, 0.30,  0.36);
  const fr   = cylinder(0.07, 0.07, 0.60, 6, -0.18, 0.30,  0.36);
  const bl   = cylinder(0.07, 0.07, 0.60, 6,  0.18, 0.30, -0.36);
  const br   = cylinder(0.07, 0.07, 0.60, 6, -0.18, 0.30, -0.36);
  const limbsGeo = merge(earL, earR, fl, fr, bl, br);
  addPrimitive(doc, buf, mesh, limbsGeo, matDark);

  // Tail — body color, angled up-back from rear of torso.
  let tail = cylinder(0.03, 0.07, 0.45, 6, 0, 0.75, -0.62 - 0.225);
  tail = rotateX(tail, -Math.PI / 4, 0.75, -0.62);
  addPrimitive(doc, buf, mesh, tail, matBody);

  const node = doc.createNode('wolf_root').setMesh(mesh);
  doc.createScene('wolf').addChild(node);

  await writeGlb(doc, outPath);
  console.log('  wolf.glb → primitives:', mesh.listPrimitives().length, '· triangles:',
    mesh.listPrimitives().reduce((n, p) => n + p.getIndices().getCount() / 3, 0));
}

// ── Sample tile asset ────────────────────────────────────────────────────────

// Deterministic RNG matched to ProceduralTileProvider (mulberry32 seeded from
// tile column/row). Keeping the same seed means trees sit in identical
// positions on this tile and on the procedural fallback neighbors, so
// boundaries are seamless.
function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TREES_PER_TILE = 12;

async function buildTile(outPath, col, row, tileSizeM) {
  const doc = new Document();
  doc.createBuffer();
  const buf = doc.getRoot().listBuffers()[0];

  // Slightly darker grass than the procedural fallback so the GLB tile is
  // visually distinguishable in dev (proves the GLB path is firing).
  const matGround = makePbr(doc, 'tile_ground', [0.22, 0.34, 0.18]);
  const matTrunk  = makePbr(doc, 'tile_trunk',  [0.30, 0.21, 0.13]);
  const matLeaf   = makePbr(doc, 'tile_leaf',   [0.18, 0.32, 0.16]);

  const mesh = doc.createMesh('tile_mesh');

  // Ground — subdivided so future vertex displacement / wind has somewhere
  // to land. 16 × 16 cells is enough density at tile size 256m.
  const ground = subdividedPlane(tileSizeM, tileSizeM, 16, 16, 0, 0, 0);
  addPrimitive(doc, buf, mesh, ground, matGround);

  // Trees — local tile coords centered at (0,0), spread within the tile.
  const seed = ((col * 73856093) ^ (row * 19349663)) >>> 0;
  const rng = mulberry32(seed);
  const trunks = [];
  const leaves = [];
  for (let i = 0; i < TREES_PER_TILE; i++) {
    const tx = (rng() - 0.5) * (tileSizeM * 0.9);
    const tz = (rng() - 0.5) * (tileSizeM * 0.9);
    const trunkH = 3.0 + rng() * 1.5;
    const canopyR = 1.6 + rng() * 0.8;
    trunks.push(cylinder(0.18, 0.22, trunkH, 6, tx, trunkH / 2, tz));
    leaves.push(cone(canopyR, canopyR * 1.8, 6, tx, trunkH + canopyR * 0.6, tz));
  }
  addPrimitive(doc, buf, mesh, merge(...trunks), matTrunk);
  addPrimitive(doc, buf, mesh, merge(...leaves), matLeaf);

  const node = doc.createNode('tile_root').setMesh(mesh);
  doc.createScene('tile').addChild(node);

  await writeGlb(doc, outPath);
  console.log('  tile.glb → primitives:', mesh.listPrimitives().length, '· trees:', TREES_PER_TILE);
}

// ── IO ───────────────────────────────────────────────────────────────────────

async function writeGlb(doc, outPath) {
  mkdirSync(dirname(outPath), { recursive: true });
  const io = new NodeIO();
  const bytes = await io.writeBinary(doc);
  writeFileSync(outPath, bytes);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const wolfPath = resolve(repoRoot, 'public/assets/mobs/wolf.glb');
const tilePath = resolve(repoRoot, 'public/assets/tiles/T_03_03_render.glb');

console.log('Building placeholder GLB assets:');
console.log('  →', wolfPath);
console.log('  →', tilePath);

await buildWolf(wolfPath);
// Sample tile is T_03_03 — center of the 8×8 grid, sits on world origin.
// tile_size_m comes from world_build_config.tiling_streaming.tile_size_m (256m).
await buildTile(tilePath, 3, 3, 256);

console.log('Done.');
