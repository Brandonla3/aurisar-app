/**
 * ashwoodPropMeshes — template meshes + per-tile thin-instance builders for
 * all Ashwood props: overworld trees (broadleaf / pine / dead), rocks,
 * bushes, ground details, chests, ruins, caves, the Wildwood forest (trunks,
 * leaf blobs, undergrowth, fallen logs) and per-tile understory.
 *
 * Recipes ported from the prototype (spawnTree ~2345, spawnRock ~2404,
 * spawnRuin ~2441, spawnCave ~2491,
 * buildForest ~1639, buildUnderstory ~1076), simplified where a merged
 * template keeps the silhouette at a fraction of the draw calls. Every
 * scattered element is a thin instance of a shared template — a tile costs
 * one draw call per non-empty template.
 *
 * Determinism: per-site visual variance derives from mulberry32(site.seed);
 * understory derives from mulberry32(worldSeed ^ tileSeed). No Math.random.
 */

/* global BABYLON */

import { mulberry32, hash2 } from '../worldgen/index.js';
import { parseTileId } from './tileMath.js';

const rand = (rng, a, b) => a + rng() * (b - a);

// ── geometry helpers ────────────────────────────────────────────────────────

// Displaced icosphere — the prototype's organic blob/boulder silhouette.
function displacedIcoSphere(name, scene, opts) {
  const m = BABYLON.MeshBuilder.CreateIcoSphere(name, { radius: 1, subdivisions: 2, updatable: true }, scene);
  const pos = m.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    const nf = opts.base + opts.amp * hash2((x + opts.seed) * 3.1, (z - opts.seed) * 2.7)
             + 0.12 * Math.sin(y * 4 + opts.seed);
    pos[i] = x * nf; pos[i + 1] = y * nf; pos[i + 2] = z * nf;
  }
  m.setVerticesData(BABYLON.VertexBuffer.PositionKind, pos, false);
  m.convertToFlatShadedMesh();
  if (opts.moss) {
    // moss on upward faces, baked as vertex color (prototype spawnRock)
    const p2 = m.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const n2 = m.getVerticesData(BABYLON.VertexBuffer.NormalKind);
    const cols = new Float32Array((p2.length / 3) * 4);
    for (let i = 0; i < p2.length / 3; i++) {
      const k = Math.max(0, (n2[i * 3 + 1] - 0.35) / 0.65);
      cols[i * 4]     = 0.95 * (1 - k) + 0.18 * k;
      cols[i * 4 + 1] = 0.95 * (1 - k) + 0.48 * k;
      cols[i * 4 + 2] = 0.95 * (1 - k) + 0.14 * k;
      cols[i * 4 + 3] = 1;
    }
    m.setVerticesData(BABYLON.VertexBuffer.ColorKind, cols, false, 4);
  }
  return m;
}

function mergeKeep(name, meshes) {
  const merged = BABYLON.Mesh.MergeMeshes(meshes, true, true, undefined, false, false);
  merged.name = name;
  return merged;
}

// ── templates (built once per scene, never rendered directly) ───────────────

export function buildPropTemplates(scene) {
  const mat = (name, hex, flat = true) => {
    const m = new BABYLON.StandardMaterial(name, scene);
    m.diffuseColor = BABYLON.Color3.FromHexString(hex);
    m.specularColor = new BABYLON.Color3(0, 0, 0);
    if (flat) m.disableLighting = false;
    return m;
  };

  const bark   = mat('ash_bark', '#46331f');
  const leaf   = mat('ash_leaf', '#4a6e29');
  const pine   = mat('ash_pine', '#9ab080');
  leaf.useVertexColors = false;
  const rockM  = mat('ash_rock', '#8a8d88');
  const bushM  = mat('ash_bush', '#35451f');
  const wood   = mat('ash_wood', '#5a3b22');
  const gold   = mat('ash_gold', '#caa050');
  const green  = mat('ash_green', '#ffffff'); // tinted per instance
  const fTrunkM = mat('ash_ftrunk', '#8a6a48');
  const fLeafM  = mat('ash_fleaf', '#ffffff'); // HSL variance per instance

  const T = {};

  // overworld tree trunk: unit height, scaled (w, h, w) per instance
  T.trunk = BABYLON.MeshBuilder.CreateCylinder('tpl_trunk', {
    diameterTop: 0.55, diameterBottom: 1.0, height: 1, tessellation: 8,
  }, scene);
  T.trunk.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0, 0.5, 0));
  T.trunk.material = bark;

  // broadleaf canopy blob (instanced 4-6× per tree)
  T.blob = displacedIcoSphere('tpl_blob', scene, { base: 0.8, amp: 0.3, seed: 17 });
  T.blob.material = leaf;

  // pine canopy: 5 stacked cones merged, unit-ish (≈2.4 wide, ≈6 tall)
  {
    const cones = [];
    for (let i = 0; i < 5; i++) {
      const cr = Math.max(0.5, 2.4 - i * 0.42), ch = 1.9;
      const c = BABYLON.MeshBuilder.CreateCylinder(`pc${i}`, {
        diameterTop: 0, diameterBottom: cr * 2, height: ch, tessellation: 8,
      }, scene);
      c.position.y = i * ch * 0.62 + ch / 2;
      cones.push(c);
    }
    T.pineCanopy = mergeKeep('tpl_pine', cones);
    T.pineCanopy.material = pine;
  }

  // dead-tree branch crown: 4 bare angled branches merged
  {
    const brs = [];
    for (let i = 0; i < 4; i++) {
      const ba = (i / 4) * 6.28 + 0.7;
      const br = BABYLON.MeshBuilder.CreateCylinder(`db${i}`, {
        diameterTop: 0.08, diameterBottom: 0.26, height: 2.0, tessellation: 5,
      }, scene);
      br.position.set(Math.cos(ba) * 0.3, i * 0.5, Math.sin(ba) * 0.3);
      br.rotation.z = -Math.cos(ba) * 1.1;
      br.rotation.x = Math.sin(ba) * 1.1;
      brs.push(br);
    }
    T.deadCrown = mergeKeep('tpl_dead', brs);
    T.deadCrown.material = bark;
  }

  // rock boulder with baked moss vertex colors
  T.rock = displacedIcoSphere('tpl_rock', scene, { base: 0.78, amp: 0.34, seed: 41, moss: true });
  T.rock.material = rockM;

  // bush
  T.bush = BABYLON.MeshBuilder.CreateSphere('tpl_bush', { diameter: 2, segments: 5 }, scene);
  T.bush.bakeTransformIntoVertices(BABYLON.Matrix.Scaling(1, 0.7, 1).multiply(BABYLON.Matrix.Translation(0, 0.55, 0)));
  T.bush.material = bushM;

  // ground details / understory
  T.tuft = BABYLON.MeshBuilder.CreateCylinder('tpl_tuft', { diameterTop: 0, diameterBottom: 0.8, height: 1.05, tessellation: 5 }, scene);
  T.tuft.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0, 0.52, 0));
  T.tuft.material = green;
  T.fern = BABYLON.MeshBuilder.CreateCylinder('tpl_fern', { diameterTop: 0, diameterBottom: 1.48, height: 0.5, tessellation: 6 }, scene);
  T.fern.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0, 0.25, 0));
  T.fern.material = green;
  T.flower = BABYLON.MeshBuilder.CreateIcoSphere('tpl_flower', { radius: 0.3, subdivisions: 1 }, scene);
  T.flower.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0, 0.3, 0));
  T.flower.convertToFlatShadedMesh();
  T.flower.material = green;

  // chest: body + lid merged
  {
    const body = BABYLON.MeshBuilder.CreateBox('cb', { width: 1.0, height: 0.6, depth: 0.65 }, scene);
    body.position.y = 0.3;
    const lid = BABYLON.MeshBuilder.CreateCylinder('cl', {
      diameter: 0.65, height: 1.0, tessellation: 8, arc: 0.5,
    }, scene);
    lid.rotation.z = Math.PI / 2;
    lid.position.y = 0.6;
    T.chest = mergeKeep('tpl_chest', [body, lid]);
    T.chest.material = wood;
  }
  void gold;

  // Wildwood forest: trunk (unit, scaled (w,h,w)), leaf blob sphere, brush cone
  T.fTrunk = BABYLON.MeshBuilder.CreateCylinder('tpl_ftrunk', {
    diameterTop: 1.4, diameterBottom: 2.4, height: 1, tessellation: 8,
  }, scene);
  T.fTrunk.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0, 0.5, 0));
  T.fTrunk.material = fTrunkM;
  T.fLeaf = BABYLON.MeshBuilder.CreateSphere('tpl_fleaf', { diameterX: 2, diameterY: 1.8, diameterZ: 2, segments: 6 }, scene);
  T.fLeaf.material = fLeafM;
  T.fBrush = BABYLON.MeshBuilder.CreateCylinder('tpl_fbrush', { diameterTop: 0, diameterBottom: 1.2, height: 1.0, tessellation: 5 }, scene);
  T.fBrush.bakeTransformIntoVertices(BABYLON.Matrix.Translation(0, 0.5, 0));
  T.fBrush.material = bushM;
  T.log = BABYLON.MeshBuilder.CreateCylinder('tpl_log', { diameterTop: 1.2, diameterBottom: 1.4, height: 1, tessellation: 8 }, scene);
  T.log.material = fTrunkM;

  // ── ruins & caves (prototype spawnRuin ~2441, spawnCave ~2491) ──
  const stone   = mat('ash_stone', '#8c8b86');
  const boulderM = mat('ash_boulder', '#ffffff'); // grey shades per instance

  // unit stone box, center origin: walls, caps, arch legs, lintels
  T.stoneBox = BABYLON.MeshBuilder.CreateBox('tpl_stonebox', { size: 1 }, scene);
  T.stoneBox.material = stone;

  // ruin column, unit height, center origin (toppled ones lie on their side)
  T.column = BABYLON.MeshBuilder.CreateCylinder('tpl_column', {
    diameterTop: 0.8, diameterBottom: 0.92, height: 1, tessellation: 10,
  }, scene);
  T.column.material = stone;

  // plain boulder (no moss) — ruin rubble, cave ring, cave roof slab
  T.boulder = displacedIcoSphere('tpl_boulder', scene, { base: 0.78, amp: 0.34, seed: 23 });
  T.boulder.material = boulderM;

  // stalagmite cone, unit radius/height, center origin
  T.stalag = BABYLON.MeshBuilder.CreateCylinder('tpl_stalag', {
    diameterTop: 0, diameterBottom: 2, height: 1, tessellation: 6,
  }, scene);
  T.stalag.convertToFlatShadedMesh();
  T.stalag.material = mat('ash_stalag', '#5a5a60');

  // eerie cave crystal — emissive teal cone
  {
    const crysM = new BABYLON.StandardMaterial('ash_crystal', scene);
    crysM.diffuseColor  = BABYLON.Color3.FromHexString('#2a6b66');
    crysM.emissiveColor = BABYLON.Color3.FromHexString('#39c8b0').scale(0.9);
    crysM.specularColor = new BABYLON.Color3(0, 0, 0);
    T.crystal = BABYLON.MeshBuilder.CreateCylinder('tpl_crystal', {
      diameterTop: 0, diameterBottom: 2, height: 1, tessellation: 5,
    }, scene);
    T.crystal.convertToFlatShadedMesh();
    T.crystal.material = crysM;
  }

  // glowing mushroom — stem + cap merged under one soft-emissive material
  {
    const shroomM = new BABYLON.StandardMaterial('ash_shroom', scene);
    shroomM.diffuseColor  = BABYLON.Color3.FromHexString('#3aa0b8');
    shroomM.emissiveColor = BABYLON.Color3.FromHexString('#2aa0c0').scale(0.6);
    shroomM.specularColor = new BABYLON.Color3(0, 0, 0);
    const stem = BABYLON.MeshBuilder.CreateCylinder('shs', { diameterTop: 0.08, diameterBottom: 0.1, height: 0.3, tessellation: 5 }, scene);
    stem.position.y = 0.15;
    const cap = BABYLON.MeshBuilder.CreateSphere('shc', { diameter: 0.28, segments: 4, slice: 0.6 }, scene);
    cap.position.y = 0.3;
    T.shroom = mergeKeep('tpl_shroom', [stem, cap]);
    T.shroom.material = shroomM;
  }

  // cave void dome — inward-facing near-black hemisphere; the open mouth of
  // the boulder ring reads as a real opening into darkness. Fog must not
  // wash it out or the illusion breaks.
  {
    const voidM = new BABYLON.StandardMaterial('ash_cavevoid', scene);
    voidM.diffuseColor  = BABYLON.Color3.FromHexString('#04050a');
    voidM.emissiveColor = BABYLON.Color3.FromHexString('#04050a');
    voidM.specularColor = new BABYLON.Color3(0, 0, 0);
    voidM.disableLighting = true;
    voidM.fogEnabled = false;
    T.caveDome = BABYLON.MeshBuilder.CreateSphere('tpl_cavedome', {
      diameter: 2, segments: 8, slice: 0.52,
      sideOrientation: BABYLON.Mesh.BACKSIDE,
    }, scene);
    T.caveDome.material = voidM;
  }

  for (const key of Object.keys(T)) {
    T[key].setEnabled(false);
    T[key].isPickable = false;
  }
  return T;
}

// ── per-tile thin-instance accumulation ─────────────────────────────────────

class Acc {
  constructor() { this.mats = []; this.cols = []; }
  push(px, py, pz, rx, ry, rz, sx, sy, sz, col) {
    const q = BABYLON.Quaternion.FromEulerAngles(rx, ry, rz);
    const m = BABYLON.Matrix.Compose(new BABYLON.Vector3(sx, sy, sz), q, new BABYLON.Vector3(px, py, pz));
    for (let i = 0; i < 16; i++) this.mats.push(m.m[i]);
    if (col) this.cols.push(col.r, col.g, col.b, 1);
  }
  realize(name, template, scene, container, castShadow) {
    if (!this.mats.length) return;
    const mesh = template.clone(name);
    // CRITICAL: thinInstanceSetBuffer stores world0-3 in the GEOMETRY, and
    // clone() shares geometry with the template (and so with every other
    // tile's clone). Without a unique geometry, all tiles fight over one
    // instance buffer and stale counts render giant garbage triangles.
    mesh.makeGeometryUnique();
    mesh.setEnabled(true);
    mesh.isPickable = false;
    mesh.thinInstanceSetBuffer('matrix', new Float32Array(this.mats), 16, true);
    if (this.cols.length) mesh.thinInstanceSetBuffer('color', new Float32Array(this.cols), 4, true);
    mesh.thinInstanceRefreshBoundingInfo();
    container.meshes.push(mesh);
    if (castShadow) castShadow(mesh);
  }
}

function hslToRgb(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
  };
  return { r: f(0), g: f(8), b: f(4) };
}

/**
 * Build all prop thin-instance meshes for one tile.
 * @param {function} inBounds  (x,z) => bool for this tile
 * @param {object}   opts      { lights?: boolean } — cave point lights are
 *   skipped in bake mode (the GLB contract is geometry + vertex colors).
 */
export function buildTileProps(meta, scene, wg, templates, container, inBounds, castShadow, opts = {}) {
  const surfaceY = wg.surfaceY;
  const s = wg.sites;
  const acc = {
    trunk: new Acc(), blob: new Acc(), pineCanopy: new Acc(), deadCrown: new Acc(),
    rock: new Acc(), bush: new Acc(), tuft: new Acc(), fern: new Acc(),
    flower: new Acc(), chest: new Acc(),
    stoneBox: new Acc(), column: new Acc(), boulder: new Acc(),
    stalag: new Acc(), crystal: new Acc(), shroom: new Acc(), caveDome: new Acc(),
    fTrunk: new Acc(), fLeaf: new Acc(), fBrush: new Acc(), log: new Acc(),
  };

  // ── overworld trees (prototype spawnTree) ──
  for (const t of s.trees) {
    if (!inBounds(t.x, t.z)) continue;
    const rng = mulberry32(t.seed);
    const gy = surfaceY(t.x, t.z);
    const th = rand(rng, 5, 8.5), tr = rand(rng, 0.3, 0.55);
    const yaw = rng() * 6.28;
    acc.trunk.push(t.x, gy, t.z, 0, yaw, 0, tr * 2, th, tr * 2, null);
    if (t.kind === 'pine') {
      acc.pineCanopy.push(t.x, gy + th * 0.42, t.z, 0, yaw, 0, 1, 1, 1, null);
    } else if (t.kind === 'dead') {
      acc.deadCrown.push(t.x, gy + th * 0.5, t.z, 0, yaw, 0, 1, th / 7, 1, null);
    } else {
      const blobs = 4 + ((rng() * 3) | 0);
      const cy = gy + th * 0.92;
      for (let i = 0; i < blobs; i++) {
        const br = rand(rng, 1.6, 2.7);
        acc.blob.push(
          t.x + rand(rng, -1.3, 1.3), cy + rand(rng, -0.4, 1.9), t.z + rand(rng, -1.3, 1.3),
          rand(rng, 0, 3), rand(rng, 0, 6), rand(rng, 0, 3),
          br, br * rand(rng, 0.8, 1.1), br,
          hslToRgb(0.28 + rng() * 0.04, 0.4, 0.22 + rng() * 0.1),
        );
      }
    }
  }

  // ── rocks ──
  for (const r of s.rocks) {
    if (!inBounds(r.x, r.z)) continue;
    if (wg.inMountain(r.x, r.z) || wg.inForest(r.x, r.z)) continue; // zones dress themselves
    const rng = mulberry32(r.seed);
    const rr = rand(rng, 0.9, 2.6);
    acc.rock.push(r.x, surfaceY(r.x, r.z) + rr * 0.4, r.z,
      rand(rng, 0, 0.4), rand(rng, 0, 6), rand(rng, 0, 0.4), rr, rr, rr, null);
  }

  // ── bushes ──
  for (const b of s.bushes) {
    if (!inBounds(b.x, b.z)) continue;
    const rng = mulberry32(b.seed);
    const sc = rand(rng, 0.5, 1.1);
    acc.bush.push(b.x, surfaceY(b.x, b.z), b.z, 0, rng() * 6.28, 0, sc, sc, sc, null);
  }

  // ── ground details: fern / mushroom-tuft / flower by biome ──
  for (const d of s.details) {
    if (!inBounds(d.x, d.z)) continue;
    const rng = mulberry32(d.seed);
    const gy = surfaceY(d.x, d.z);
    const pick = rng();
    const sc = rand(rng, 0.6, 1.3);
    const bi = wg.config.biomes[d.biome];
    const gc = bi.grassCol;
    const col = { r: gc[0] + 0.1 * rng(), g: gc[1] + 0.14 * rng(), b: gc[2] + 0.05 * rng() };
    if (pick < 0.45) acc.fern.push(d.x, gy, d.z, 0, rng() * 6.28, 0, sc, sc * 0.85, sc, col);
    else if (pick < 0.8) acc.tuft.push(d.x, gy, d.z, 0, rng() * 6.28, 0, sc, sc, sc, col);
    else acc.flower.push(d.x, gy, d.z, 0, rng() * 6.28, 0, sc, sc, sc,
      [{ r: 0.78, g: 0.64, b: 0.24 }, { r: 0.85, g: 0.56, b: 0.69 }, { r: 0.71, g: 0.44, b: 0.69 }, { r: 0.85, g: 0.85, b: 0.78 }][(rng() * 4) | 0]);
  }

  // ── chests ──
  for (const c of s.chests) {
    if (!inBounds(c.x, c.z)) continue;
    const rng = mulberry32(c.seed);
    acc.chest.push(c.x, surfaceY(c.x, c.z), c.z, 0, rng() * 6.28, 0, 1, 1, 1, null);
  }

  // ── ruins: broken wall ring, columns, archway, rubble (spawnRuin) ──
  // Loot chests / monster guards from the prototype are server-side concerns
  // (the manifest already places chests); only the dressing renders here.
  const RUBBLE = { r: 0.49, g: 0.486, b: 0.467 };  // #7d7c77
  for (const u of s.ruins) {
    if (!inBounds(u.x, u.z)) continue;
    if (wg.inMountain(u.x, u.z)) continue;
    const rng = mulberry32(u.seed);
    const segs = 9, rr = rand(rng, 5.5, 7.5);
    for (let i = 0; i < segs; i++) {
      // draw every roll even for skipped gaps so layout is order-stable
      const gap = rng() < 0.32;
      const ang = (i / segs) * Math.PI * 2;
      const wx = u.x + Math.cos(ang) * rr, wz = u.z + Math.sin(ang) * rr;
      const wh = rand(rng, 1.0, 3.8), ww = rand(rng, 1.8, 3.0);
      const wyaw = ang + Math.PI / 2 + rand(rng, -0.15, 0.15);
      const cap = rng() < 0.5;
      if (gap) continue;
      const wy = surfaceY(wx, wz);
      acc.stoneBox.push(wx, wy + wh / 2, wz, 0, wyaw, 0, ww, wh, 0.6, null);
      if (cap) acc.stoneBox.push(wx, wy + wh + 0.45, wz, 0, wyaw, 0, ww * 0.5, 0.5, 0.7, null);
    }
    const ncol = 3 + ((rng() * 3) | 0);
    for (let i = 0; i < ncol; i++) {
      const a = rng() * 6.28, d = rand(rng, 1.5, 4.5);
      const px = u.x + Math.cos(a) * d, pz = u.z + Math.sin(a) * d;
      const pgy = surfaceY(px, pz);
      const ch = rand(rng, 1.5, 4.0), toppled = rng() < 0.4;
      if (toppled) acc.column.push(px, pgy + 0.42, pz, 0, rng() * 6.28, Math.PI / 2, 1, ch, 1, null);
      else acc.column.push(px, pgy + ch / 2, pz, 0, 0, 0, 1, ch, 1, null);
    }
    // archway: two legs + lintel near the center
    const aa = rng() * 6.28;
    const ax = u.x + Math.cos(aa) * 2.2, az = u.z + Math.sin(aa) * 2.2;
    for (const off of [-1, 1]) {
      const lx = ax + Math.cos(aa + Math.PI / 2) * off;
      const lz = az + Math.sin(aa + Math.PI / 2) * off;
      acc.stoneBox.push(lx, surfaceY(lx, lz) + 1.6, lz, 0, aa + Math.PI / 2, 0, 0.5, 3.2, 0.5, null);
    }
    acc.stoneBox.push(ax, surfaceY(ax, az) + 3.4, az, 0, aa + Math.PI / 2, 0, 2.8, 0.6, 0.6, null);
    for (let i = 0; i < 8; i++) {
      const a = rng() * 6.28, d = rng() * 6;
      const rx = u.x + Math.cos(a) * d, rz = u.z + Math.sin(a) * d;
      const sc = rand(rng, 0.3, 0.7);
      acc.boulder.push(rx, surfaceY(rx, rz) + 0.2, rz, 0, rng() * 6.28, 0, sc, sc, sc, RUBBLE);
    }
  }

  // ── caves: boulder horseshoe, void dome, stalagmites, crystals (spawnCave) ──
  const CAVE_RING = { r: 0.298, g: 0.298, b: 0.329 };  // #4c4c54
  const CAVE_ROOF = { r: 0.243, g: 0.243, b: 0.275 };  // #3e3e46
  for (const cv of s.caves) {
    if (!inBounds(cv.x, cv.z)) continue;
    if (wg.inMountain(cv.x, cv.z)) continue;
    const rng = mulberry32(cv.seed);
    const gy = surfaceY(cv.x, cv.z);
    const facing = rng() * 6.28;
    const ringR = 5.2;
    for (let i = 0; i < 11; i++) {
      const ang = (i / 11) * Math.PI * 2;
      const br = rand(rng, 2.2, 3.4);
      // keep a ~70° arc open at the entrance
      const da = Math.abs((((ang - facing + Math.PI) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) - Math.PI);
      if (da < 0.6) continue;
      const bx = cv.x + Math.cos(ang) * ringR, bz = cv.z + Math.sin(ang) * ringR;
      acc.boulder.push(bx, surfaceY(bx, bz) + br * 0.3, bz, 0, rng() * 6.28, 0, br, br * 1.4, br, CAVE_RING);
    }
    // back overhang slab
    const ox = cv.x - Math.cos(facing) * 2.4, oz = cv.z - Math.sin(facing) * 2.4;
    acc.boulder.push(ox, surfaceY(ox, oz) + 5.0, oz, 0, facing, 0, 4.2 * 1.4, 4.2 * 0.5, 4.2 * 1.4, CAVE_ROOF);
    // dark void dome under the slab
    acc.caveDome.push(cv.x, gy + 0.02, cv.z, 0, 0, 0, 3.8, 3.8 * 1.2, 3.8, null);
    // stalagmites framing the entrance
    for (let i = 0; i < 4; i++) {
      const sa = facing + rand(rng, -0.85, 0.85), sd = rand(rng, 3.4, 4.6);
      const sx = cv.x + Math.cos(sa) * sd, sz = cv.z + Math.sin(sa) * sd;
      acc.stalag.push(sx, surfaceY(sx, sz) + 0.2, sz,
        rand(rng, -0.12, 0.12), rng() * 6, rand(rng, -0.12, 0.12),
        rand(rng, 0.22, 0.4), rand(rng, 1.1, 2.3), rand(rng, 0.22, 0.4), null);
    }
    // eerie crystals + glowing mushrooms
    for (let i = 0; i < 5; i++) {
      const a = rng() * 6.28, d = rand(rng, 0.5, 3.5);
      const kx = cv.x + Math.cos(a) * d, kz = cv.z + Math.sin(a) * d;
      acc.crystal.push(kx, surfaceY(kx, kz) + 0.4, kz,
        rand(rng, -0.3, 0.3), rng() * 6, rand(rng, -0.3, 0.3),
        rand(rng, 0.12, 0.26), rand(rng, 0.6, 1.4), rand(rng, 0.12, 0.26), null);
    }
    for (let i = 0; i < 6; i++) {
      const a = rng() * 6.28, d = rand(rng, 0.5, 4);
      const mx = cv.x + Math.cos(a) * d, mz = cv.z + Math.sin(a) * d;
      acc.shroom.push(mx, surfaceY(mx, mz), mz, 0, rng() * 6.28, 0, 1, 1, 1, null);
    }
    if (opts.lights) {
      const light = new BABYLON.PointLight(
        `tile_${meta.id}_cavelight_${cv.seed}`,
        new BABYLON.Vector3(cv.x, gy + 1.6, cv.z), scene);
      light.diffuse = BABYLON.Color3.FromHexString('#66ccbb');
      light.intensity = 0.8;
      light.range = 16;
      container.lights.push(light);
    }
  }

  // ── Wildwood forest (prototype buildForest) ──
  for (const t of s.forestTrees) {
    if (!inBounds(t.x, t.z)) continue;
    const rng = mulberry32(t.seed);
    const y = surfaceY(t.x, t.z);
    acc.fTrunk.push(t.x, y, t.z, t.lean, t.yaw, t.lean * 0.6, t.w, t.h, t.w,
      hslToRgb(0.08 + rng() * 0.02, 0.34, 0.18 + rng() * 0.08));
    const cby = y + t.h * (0.72 + rng() * 0.08);
    const ch = t.h * (0.5 + rng() * 0.15);
    const cr = t.w * (2.6 + rng() * 1.8) + t.h * 0.12;
    for (let c = 0; c < 7; c++) {
      const layer = c / 7, ang = rng() * 6.28;
      const spread = cr * (0.2 + rng() * 0.9);
      const k = 0.45 + (1 - layer) * 0.45;
      const hue = t.arch === 0 ? 0.28 + rng() * 0.03 : t.arch === 1 ? 0.30 + rng() * 0.03 : 0.26 + rng() * 0.04;
      acc.fLeaf.push(
        t.x + Math.cos(ang) * spread * k,
        cby + (layer - 0.25) * ch + (rng() - 0.5) * ch * 0.2,
        t.z + Math.sin(ang) * spread * k,
        rng() * 0.3, rng() * 6.28, rng() * 0.3,
        cr * (0.65 + rng() * 0.55), cr * (0.45 + rng() * 0.45), cr * (0.65 + rng() * 0.55),
        hslToRgb(hue, 0.34 + rng() * 0.16, 0.24 + rng() * 0.14),
      );
    }
  }
  for (const b of s.forestBrush ?? []) {
    if (!inBounds(b.x, b.z)) continue;
    const rng = mulberry32(b.seed);
    acc.fBrush.push(b.x, surfaceY(b.x, b.z), b.z, 0, rng() * 6.28, 0,
      b.sc * (0.8 + rng() * 0.6), b.sc, b.sc * (0.8 + rng() * 0.6),
      hslToRgb(0.25 + rng() * 0.07, 0.4 + rng() * 0.2, 0.16 + rng() * 0.12));
  }
  for (const l of s.forestLogs ?? []) {
    if (!inBounds(l.x, l.z)) continue;
    acc.log.push(l.x, surfaceY(l.x, l.z) + 0.55, l.z, 0, l.yaw, Math.PI / 2, 1, l.len, 1, null);
  }

  // ── understory: dense decor scatter, deterministic per tile ──
  {
    const { col, row } = parseTileId(meta.id);
    const tileSeed = ((col * 73856093) ^ (row * 19349663)) >>> 0;
    const rng = mulberry32((wg.config.seed ^ tileSeed) >>> 0);
    const R2 = wg.config.radius * wg.config.radius;
    for (let i = 0; i < 260; i++) {
      const x = meta.min.x + rng() * (meta.max.x - meta.min.x);
      const z = meta.min.z + rng() * (meta.max.z - meta.min.z);
      if (x * x + z * z > R2 * 0.94) continue;
      if (wg.inMountain(x, z) || wg.inForest(x, z)) continue;
      if (wg.lakeWaterDepthAt(x, z) > 0.02) continue;
      const bi = wg.biomeAt(x, z);
      if (rng() > bi.grass * 0.85 + 0.08) continue;
      if (wg.trailDirtAt(x, z) > 0.1) continue;
      const sc = rand(rng, 0.5, 1.25);
      const gc = bi.grassCol;
      const col2 = { r: gc[0] * 1.3 + 0.08 * rng(), g: gc[1] * 1.3 + 0.1 * rng(), b: gc[2] * 1.2 };
      acc.tuft.push(x, surfaceY(x, z), z, 0, rng() * 6.28, 0, sc, sc * (0.8 + rng() * 0.7), sc, col2);
    }
  }

  acc.trunk.realize(`tile_${meta.id}_trunks`, templates.trunk, scene, container, castShadow);
  acc.blob.realize(`tile_${meta.id}_blobs`, templates.blob, scene, container, castShadow);
  acc.pineCanopy.realize(`tile_${meta.id}_pines`, templates.pineCanopy, scene, container, castShadow);
  acc.deadCrown.realize(`tile_${meta.id}_dead`, templates.deadCrown, scene, container, castShadow);
  acc.rock.realize(`tile_${meta.id}_rocks`, templates.rock, scene, container, castShadow);
  acc.bush.realize(`tile_${meta.id}_bushes`, templates.bush, scene, container, null);
  acc.tuft.realize(`tile_${meta.id}_tufts`, templates.tuft, scene, container, null);
  acc.fern.realize(`tile_${meta.id}_ferns`, templates.fern, scene, container, null);
  acc.flower.realize(`tile_${meta.id}_flowers`, templates.flower, scene, container, null);
  acc.chest.realize(`tile_${meta.id}_chests`, templates.chest, scene, container, castShadow);
  acc.stoneBox.realize(`tile_${meta.id}_ruinstone`, templates.stoneBox, scene, container, castShadow);
  acc.column.realize(`tile_${meta.id}_ruincols`, templates.column, scene, container, castShadow);
  acc.boulder.realize(`tile_${meta.id}_boulders`, templates.boulder, scene, container, castShadow);
  acc.stalag.realize(`tile_${meta.id}_stalags`, templates.stalag, scene, container, castShadow);
  acc.crystal.realize(`tile_${meta.id}_crystals`, templates.crystal, scene, container, null);
  acc.shroom.realize(`tile_${meta.id}_shrooms`, templates.shroom, scene, container, null);
  acc.caveDome.realize(`tile_${meta.id}_cavedomes`, templates.caveDome, scene, container, null);
  acc.fTrunk.realize(`tile_${meta.id}_ftrunks`, templates.fTrunk, scene, container, castShadow);
  acc.fLeaf.realize(`tile_${meta.id}_fleaves`, templates.fLeaf, scene, container, castShadow);
  acc.fBrush.realize(`tile_${meta.id}_fbrush`, templates.fBrush, scene, container, null);
  acc.log.realize(`tile_${meta.id}_logs`, templates.log, scene, container, castShadow);
}
