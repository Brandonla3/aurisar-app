/**
 * ashwoodPropMeshes — template meshes + per-tile thin-instance builders for
 * all Ashwood props: overworld trees (broadleaf / pine / dead), rocks,
 * bushes, ground details, chests, the Wildwood forest (trunks, leaf blobs,
 * undergrowth, fallen logs) and per-tile understory.
 *
 * Recipes ported from the prototype (spawnTree ~2345, spawnRock ~2404,
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
 */
export function buildTileProps(meta, scene, wg, templates, container, inBounds, castShadow) {
  const surfaceY = wg.surfaceY;
  const s = wg.sites;
  const acc = {
    trunk: new Acc(), blob: new Acc(), pineCanopy: new Acc(), deadCrown: new Acc(),
    rock: new Acc(), bush: new Acc(), tuft: new Acc(), fern: new Acc(),
    flower: new Acc(), chest: new Acc(),
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
  acc.fTrunk.realize(`tile_${meta.id}_ftrunks`, templates.fTrunk, scene, container, castShadow);
  acc.fLeaf.realize(`tile_${meta.id}_fleaves`, templates.fLeaf, scene, container, castShadow);
  acc.fBrush.realize(`tile_${meta.id}_fbrush`, templates.fBrush, scene, container, null);
  acc.log.realize(`tile_${meta.id}_logs`, templates.log, scene, container, castShadow);
}
