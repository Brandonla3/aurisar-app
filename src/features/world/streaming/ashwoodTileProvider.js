/**
 * AshwoodTileProvider — renders the Ashwood analytic heightfield through the
 * existing tile streaming system.
 *
 * Terrain comes from worldgen/surfaceY (pure math), so any tile can be built
 * on demand: a displaced ground grid with biome vertex colors, the
 * packed-dirt trail halo and lakebed silt baked in (ported from the
 * prototype's buildWorld() ground pass), plus flat placeholder water discs
 * for Mirrormere and the ponds (Phase 3 replaces these with shader water).
 *
 * Determinism: everything derives from the worldgen instance handed in —
 * no RNG is consumed here, so tile load order can never desync clients.
 *
 * Contract (see tileLoader.js): load(meta, scene) → BABYLON.AssetContainer.
 */

/* global BABYLON */

import { streamingParams, tileBounds } from './tileMath.js';

// 96 → ~2.7m vertex spacing on a 256m tile (97² = 9.4k verts). The mountain
// switchbacks (12-24u wide) and the lake rim read correctly at this density.
const DEFAULT_SUBDIVISIONS = 96;

// Grass texture repeats per tile. Integer ⇒ the world-aligned UVs stay
// continuous across tile borders. 256m / 9 ≈ 28.4m period — matches the
// prototype's repeat 44 over a 1248m ground plane.
const GRASS_REPEATS_PER_TILE = 9;

export class AshwoodTileProvider {
  /**
   * @param {object} config    world_build_config.json (tiling/streaming)
   * @param {object} worldgen  createWorldgen(ashwood_world.json) instance
   */
  constructor(config, worldgen, options = {}) {
    this.params = streamingParams(config);
    this.wg = worldgen;
    this.subdivisions = options.subdivisions ?? DEFAULT_SUBDIVISIONS;
    this._shared = null;
  }

  _ensureShared(scene) {
    if (this._shared && this._shared.scene === scene) return this._shared;

    const ground = new BABYLON.StandardMaterial('ashwood_ground', scene);
    const grassTex = new BABYLON.Texture('/assets/textures/grasslight-big.jpg', scene);
    grassTex.uScale = GRASS_REPEATS_PER_TILE;
    grassTex.vScale = GRASS_REPEATS_PER_TILE;
    ground.diffuseTexture = grassTex;          // modulated by biome vertex colors
    ground.specularColor = new BABYLON.Color3(0, 0, 0);

    const water = new BABYLON.StandardMaterial('ashwood_water', scene);
    water.diffuseColor  = new BABYLON.Color3(0.10, 0.25, 0.27);
    water.emissiveColor = new BABYLON.Color3(0.03, 0.10, 0.12);
    water.specularColor = new BABYLON.Color3(0.4, 0.45, 0.5);
    water.alpha = 0.84;
    water.backFaceCulling = false;

    const bed = new BABYLON.StandardMaterial('ashwood_pondbed', scene);
    bed.diffuseColor  = new BABYLON.Color3(0.043, 0.10, 0.114);
    bed.specularColor = new BABYLON.Color3(0, 0, 0);
    bed.backFaceCulling = false;

    this._shared = { scene, ground, water, bed };
    return this._shared;
  }

  load(meta, scene) {
    const shared = this._ensureShared(scene);
    const container = new BABYLON.AssetContainer(scene);
    const bounds = tileBounds(meta.id, this.params);

    this._buildGround(meta, bounds, scene, shared, container);
    this._buildWater(meta, bounds, scene, shared, container);

    return container;
  }

  // ── terrain grid: surfaceY heights, analytic normals, biome colors ────────
  _buildGround(meta, bounds, scene, shared, container) {
    const wg = this.wg;
    const size = this.params.tileSize;
    const cx = bounds.center.x;
    const cz = bounds.center.z;
    const n = this.subdivisions;
    const step = size / n;

    const ground = BABYLON.MeshBuilder.CreateGround(`tile_${meta.id}_ground`, {
      width: size,
      height: size,
      subdivisions: n,
      updatable: false,
    }, scene);

    const positions = ground.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const normals = ground.getVerticesData(BABYLON.VertexBuffer.NormalKind);
    const count = positions.length / 3;
    const colors = new Float32Array(count * 4);

    // Scratch objects reused across vertices (worldgen colors are engine-free
    // {r,g,b} mutables).
    const bc = { r: 0, g: 0, b: 0 };
    const silt = wgHexToRgb(wg.config.colors.lakebedSilt);
    const dirt = wgHexToRgb(wg.config.colors.trailDirt);

    for (let i = 0; i < count; i++) {
      const wx = cx + positions[i * 3];
      const wz = cz + positions[i * 3 + 2];

      positions[i * 3 + 1] = wg.surfaceY(wx, wz);

      // Analytic central-difference normal — identical math on both sides of
      // every tile border, so lighting is seam-free without shared edges.
      const dhdx = (wg.surfaceY(wx + step, wz) - wg.surfaceY(wx - step, wz)) / (2 * step);
      const dhdz = (wg.surfaceY(wx, wz + step) - wg.surfaceY(wx, wz - step)) / (2 * step);
      const inv = 1 / Math.hypot(dhdx, 1, dhdz);
      normals[i * 3]     = -dhdx * inv;
      normals[i * 3 + 1] = inv;
      normals[i * 3 + 2] = -dhdz * inv;

      // Ported ground-color pass: biome IDW blend → lakebed silt → trail dirt.
      wg.biomeColorAt(wx, wz, bc);
      const wd = wg.lakeWaterDepthAt(wx, wz);
      if (wd > 0) {
        const k = Math.min(1, wd / 1.8);
        lerpRgb(bc, silt, 0.35 + 0.45 * k);
      }
      const td = wg.trailDirtAt(wx, wz);
      if (td > 0) lerpRgb(bc, dirt, td * 0.85);

      colors[i * 4]     = bc.r;
      colors[i * 4 + 1] = bc.g;
      colors[i * 4 + 2] = bc.b;
      colors[i * 4 + 3] = 1;
    }

    ground.updateVerticesData(BABYLON.VertexBuffer.PositionKind, positions);
    ground.updateVerticesData(BABYLON.VertexBuffer.NormalKind, normals);
    ground.setVerticesData(BABYLON.VertexBuffer.ColorKind, colors, false, 4);
    ground.refreshBoundingInfo();

    ground.position.x = cx;
    ground.position.z = cz;
    ground.material = shared.ground;
    ground.receiveShadows = true;
    container.meshes.push(ground);
  }

  // ── placeholder water: Mirrormere + pond discs (owned by the tile that
  //    contains their center, so streaming adds each exactly once) ───────────
  _buildWater(meta, bounds, scene, shared, container) {
    const wg = this.wg;
    const L = wg.config.lake;

    const owns = (x, z) =>
      x >= bounds.min.x && x < bounds.max.x && z >= bounds.min.z && z < bounds.max.z;

    if (owns(L.x, L.z)) {
      const surf = this._disc(`tile_${meta.id}_lake`, L.waterR, scene, shared.water);
      surf.position.set(L.x, L.level, L.z);
      container.meshes.push(surf);
    }

    for (let i = 0; i < wg.sites.ponds.length; i++) {
      const p = wg.sites.ponds[i];
      if (!owns(p.x, p.z)) continue;
      const lvl = wg.groundHeight(p.x, p.z) - 0.12;

      const bedMesh = this._disc(`tile_${meta.id}_pondbed${i}`, p.r * 0.99, scene, shared.bed);
      bedMesh.position.set(p.x, lvl - 0.18, p.z);
      container.meshes.push(bedMesh);

      const surf = this._disc(`tile_${meta.id}_pond${i}`, p.r, scene, shared.water);
      surf.position.set(p.x, lvl, p.z);
      container.meshes.push(surf);
    }
  }

  _disc(name, radius, scene, material) {
    const d = BABYLON.MeshBuilder.CreateDisc(name, {
      radius,
      tessellation: 48,
      sideOrientation: BABYLON.Mesh.DOUBLESIDE,
    }, scene);
    d.rotation.x = Math.PI / 2; // XY plane → XZ (horizontal)
    d.material = material;
    return d;
  }
}

function wgHexToRgb(hex) {
  const v = parseInt(hex.replace('#', ''), 16);
  return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
}

function lerpRgb(a, b, t) {
  a.r += (b.r - a.r) * t;
  a.g += (b.g - a.g) * t;
  a.b += (b.b - a.b) * t;
}
