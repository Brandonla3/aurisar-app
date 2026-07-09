/**
 * AshwoodGrass — wind-animated instanced grass that follows the player.
 *
 * A deterministic hash2 cell grid (tier-scaled) is rebuilt whenever the player
 * crosses a cell. Each accepted cell scatters MANY thin blades (perCell), so
 * the field reads as dense real grass — tens of thousands of blades near the
 * player — rendered as thin instances of a single pointed-blade template with a
 * circular-arc rooted wind shader. One draw call.
 *
 * Blades are textureless (grassBlades.js): a root→tip color ramp from the
 * per-instance tint, with coherent per-clump height/color from a CPU Voronoi
 * pass baked into the instance matrix + color buffers. Distant ground is
 * covered by the tiled grass texture on the terrain, so the blade ring can stay
 * tight while still reading as continuous grass.
 *
 * Placement is pure hash2 math — identical on every client, no manifest.
 */

/* global BABYLON */

import { hash2 } from '../worldgen/index.js';
import { buildBladeClusterVertexData, createGrassMaterial } from './grassBlades.js';

// Tier-scaled geometry, ring, and per-cell blade count. perCell is the density
// multiplier — the lever that turns a sparse card field into real grass.
const TIERS = {
  high:   { planes: 2, segments: 3, cell: 0.5, radius: 22, perCell: 11 },
  mobile: { planes: 1, segments: 3, cell: 0.7, radius: 13, perCell: 5 },
  low:    { planes: 1, segments: 3, cell: 0.7, radius: 13, perCell: 5 },
};

const BLADE_HEIGHT = 0.42;
const BLADE_WIDTH = 0.032; // half-width — substantial blades, not thin wisps
const BLADE_LEAN = 0.05;   // near-upright at rest; wind supplies the sway

function smoothstep(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0 || 1)));
  return t * t * (3 - 2 * t);
}

export class AshwoodGrass {
  constructor(scene, worldgen, getPlayerPos) {
    this.scene = scene;
    this.wg = worldgen;
    this.getPlayerPos = getPlayerPos;
    this.lastX = 1e9;
    this.lastZ = 1e9;

    const tier = scene.metadata?.ashwood?.qualityTier;
    const cfg = TIERS[tier] ?? TIERS.high;
    this.CELL = cfg.cell;
    this.RADIUS = cfg.radius;
    this.PER_CELL = cfg.perCell;
    // Voronoi clump grid: several cells wide, so neighbouring blades share
    // height/color and the field clumps like real grass instead of a uniform.
    this.CLUMP = cfg.cell * 4.0;

    const geo = buildBladeClusterVertexData({
      planes: cfg.planes,
      segments: cfg.segments,
      height: BLADE_HEIGHT,
      width: BLADE_WIDTH,
      lean: BLADE_LEAN,
    });
    this.material = createGrassMaterial(scene, { maxH: geo.maxH, name: 'ashwoodGrassMat' });

    this.mesh = new BABYLON.Mesh('ashwoodGrass', scene);
    const vd = new BABYLON.VertexData();
    vd.positions = geo.positions;
    vd.indices = geo.indices;
    vd.normals = geo.normals;
    vd.uvs = geo.uvs;
    vd.applyToMesh(this.mesh);
    this.mesh.material = this.material;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true; // it surrounds the camera; skip culling

    const n = Math.ceil(this.RADIUS / this.CELL);
    this.cap = (2 * n + 1) * (2 * n + 1) * this.PER_CELL;
    this._mats = new Float32Array(this.cap * 16);
    this._cols = new Float32Array(this.cap * 4);

    this._observer = scene.onBeforeRenderObservable.add(() => this._update());
  }

  _update() {
    const p = this.getPlayerPos?.();
    if (!p) return;
    // Wind/light uniforms are driven by the shared pump in grassBlades.js; this
    // observer only rebuilds the scatter when the player crosses a cell.
    if (Math.abs(p.x - this.lastX) + Math.abs(p.z - this.lastZ) > this.CELL) this._rebuild(p.x, p.z);
  }

  // Voronoi clump lookup: nearest jittered cell center in a 3x3 neighborhood.
  // Returns a coherent per-clump seed (0..1) and a center→edge presence falloff.
  _clumpAt(wx, wz) {
    const cc = this.CLUMP;
    const cgx = Math.floor(wx / cc), cgz = Math.floor(wz / cc);
    let best = 1e9, seed = 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const nx = cgx + di, nz = cgz + dj;
        const jx = (nx + hash2(nx * 1.7, nz * 0.3)) * cc;
        const jz = (nz + hash2(nx * 0.3, nz * 1.7)) * cc;
        const dx = wx - jx, dz = wz - jz;
        const d2 = dx * dx + dz * dz;
        if (d2 < best) { best = d2; seed = hash2(nx + 3.3, nz + 7.7); }
      }
    }
    const dist = Math.sqrt(best);
    const radius = cc * 0.7;
    const presence = 1 - smoothstep(radius * 0.5, radius, dist);
    return { seed, presence };
  }

  _rebuild(px, pz) {
    const wg = this.wg;
    const cell = this.CELL, radius = this.RADIUS, perCell = this.PER_CELL;
    const n = Math.ceil(radius / cell);
    const R2 = radius * radius;
    const worldR2 = wg.config.radius * wg.config.radius;
    const cx = Math.round(px / cell), cz = Math.round(pz / cell);
    const mat = BABYLON.Matrix.Identity();
    const q = new BABYLON.Quaternion();
    const sVec = new BABYLON.Vector3();
    const pVec = new BABYLON.Vector3();
    const mats = this._mats, cols = this._cols, cap = this.cap;
    let i = 0;

    for (let gz = cz - n; gz <= cz + n && i < cap; gz++) {
      for (let gx = cx - n; gx <= cx + n && i < cap; gx++) {
        if (hash2(gx, gz) < 0.08) continue; // occasional bare patch
        // Gate once per cell at its center (biome / trail / lake / forest).
        const ccx = gx * cell, ccz = gz * cell;
        if (ccx * ccx + ccz * ccz > worldR2) continue;
        const bi = wg.biomeAt(ccx, ccz);
        if (bi.grass <= 0) continue;
        if (wg.trailDirtAt(ccx, ccz) > 0.22) continue;
        if (wg.lakeWaterDepthAt(ccx, ccz) > 0.02) continue;
        if (wg.lakeShoreAt(ccx, ccz) > 0.4) continue; // bare beach sand strip
        if (wg.inForest(ccx, ccz)) continue; // forest floor has its own brush
        const cellY = wg.surfaceY(ccx, ccz); // one height sample per cell (blades are short)
        const gc = bi.grassCol;
        // Blade count scales with the biome's grass density.
        const nb = Math.max(1, Math.round(perCell * bi.grass));

        for (let b = 0; b < nb && i < cap; b++) {
          const hb = hash2(gx * 3.1 + b * 7.7, gz * 2.3 - b * 4.1);
          const hb2 = hash2(gx * 1.7 - b * 5.3, gz * 4.9 + b * 2.1);
          const wx = ccx + (hb - 0.5) * cell;
          const wz = ccz + (hb2 - 0.5) * cell;
          const dx = wx - px, dz = wz - pz;
          if (dx * dx + dz * dz > R2) continue;

          const clump = this._clumpAt(wx, wz);
          const clumpH = 0.85 + clump.seed * 0.3;
          const edge = 0.6 + 0.4 * clump.presence; // shorter at clump edges
          // Width and height scale independently so tall blades don't also get
          // wide (and a tight height range keeps blades upright, not floppy).
          const wsc = 0.9 + hb * 0.35;                    // width 0.9–1.25×
          const hsc = (0.8 + hb2 * 0.5) * clumpH * edge;  // height ≈ 0.18–0.62 m
          BABYLON.Quaternion.FromEulerAnglesToRef(0, hb2 * 6.283, 0, q);
          sVec.set(wsc, hsc, wsc);
          pVec.set(wx, cellY, wz);
          BABYLON.Matrix.ComposeToRef(sVec, q, pVec, mat);
          mats.set(mat.m, i * 16);

          const tnt = hash2(gx + 7 + b, gz + 11 - b);
          const ct = 0.9 + clump.seed * 0.22; // per-clump tint
          cols[i * 4]     = (gc[0] + 0.10 * tnt) * ct;
          cols[i * 4 + 1] = (gc[1] + 0.14 * tnt) * ct;
          cols[i * 4 + 2] = (gc[2] + 0.05 * tnt) * ct;
          cols[i * 4 + 3] = hash2(gx + 13 + b, gz + 17 - b); // per-blade wind/color seed
          i++;
        }
      }
    }

    this.mesh.thinInstanceSetBuffer('matrix', this._mats.subarray(0, Math.max(1, i) * 16), 16, false);
    this.mesh.thinInstanceSetBuffer('color', this._cols.subarray(0, Math.max(1, i) * 4), 4, false);
    this.mesh.thinInstanceCount = i;
    this.lastX = px;
    this.lastZ = pz;
  }

  dispose() {
    if (this._observer) this.scene.onBeforeRenderObservable.remove(this._observer);
    this.mesh?.dispose();
    this.material?.dispose();
  }
}
