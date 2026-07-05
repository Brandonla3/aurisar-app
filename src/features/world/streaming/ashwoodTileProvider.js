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

import { hash2 } from '../worldgen/index.js';
import { streamingParams, tileBounds } from './tileMath.js';
import { buildPropTemplates, buildTileProps } from './ashwoodPropMeshes.js';

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
   * @param {object} options   { subdivisions?, bake? } — bake mode swaps the
   *   textured/shader materials for plain vertex-color materials and skips
   *   per-frame observables, so the provider runs under a Node NullEngine
   *   and exports clean GLBs (scripts/bake_ashwood_tiles.mjs).
   */
  constructor(config, worldgen, options = {}) {
    this.params = streamingParams(config);
    this.wg = worldgen;
    this.subdivisions = options.subdivisions ?? DEFAULT_SUBDIVISIONS;
    this.bake = options.bake ?? false;
    this._shared = null;
  }

  _ensureShared(scene) {
    if (this._shared && this._shared.scene === scene) return this._shared;

    // Runtime terrain is PBR: real energy-conserving light response, picks up
    // the IBL .env reflections the moment those assets land, and specular AA
    // (Kaplanyan roughness widening) kills the vertex-normal shimmer on
    // distant slopes. Rough dielectric (metallic 0) so grass reads matte;
    // specularIntensity is pulled down since there is no authored roughness
    // map to break up the sheen. Bake mode keeps the plain vertex-color
    // StandardMaterial — the GLB export contract.
    let ground;
    if (this.bake) {
      ground = new BABYLON.StandardMaterial('ashwood_ground', scene);
      ground.specularColor = new BABYLON.Color3(0, 0, 0);
    } else {
      ground = new BABYLON.PBRMaterial('ashwood_ground', scene);
      ground.metallic = 0;
      ground.roughness = 0.95;
      ground.specularIntensity = 0.4;
      ground.enableSpecularAntiAliasing = true;
      const grassTex = new BABYLON.Texture('/assets/textures/grasslight-big.jpg', scene);
      grassTex.uScale = GRASS_REPEATS_PER_TILE;
      grassTex.vScale = GRASS_REPEATS_PER_TILE;
      ground.albedoTexture = grassTex;        // modulated by biome vertex colors
      const grassNm = new BABYLON.Texture('/assets/textures/grasslight-big-nm.jpg', scene);
      grassNm.uScale = GRASS_REPEATS_PER_TILE;
      grassNm.vScale = GRASS_REPEATS_PER_TILE;
      grassNm.level = 0.85;
      ground.bumpTexture = grassNm;
    }

    let water, lakeWater, streamWater;
    if (this.bake) {
      water = new BABYLON.StandardMaterial('ashwood_water', scene);
      water.diffuseColor = BABYLON.Color3.FromHexString('#29646a');
      water.alpha = 0.84;
      water.backFaceCulling = false;
      lakeWater = water;
      streamWater = water;
    } else {
      water = buildWaterMaterial(scene, {});
      streamWater = buildWaterMaterial(scene, { name: 'ashwood_streamwater', alpha: 0.58 });
      // Lake material adds a planar reflection at its surface level — but the
      // MirrorTexture is a second render of the whole scene, so it's gated to
      // the high tier. Low/mobile lakes keep the waves + fresnel sky blend.
      const reflect = (scene.metadata?.ashwood?.qualityTier ?? 'high') === 'high';
      lakeWater = buildWaterMaterial(scene, { reflect, level: this.wg.config.lake.level });
    }

    const bed = new BABYLON.StandardMaterial('ashwood_pondbed', scene);
    bed.diffuseColor  = new BABYLON.Color3(0.043, 0.10, 0.114);
    bed.specularColor = new BABYLON.Color3(0, 0, 0);
    bed.backFaceCulling = false;

    // Beach decal material. The terrain's sand vertex tint alone can't read
    // as sand — vertex colors MULTIPLY the green grass albedo texture, so a
    // bright tan tint lands on olive. The visible beach is this untextured
    // sand ring draped over the shore instead (vertex alpha fades it into
    // the grass); the vertex tint still colors the lakebed shallows under
    // the water. Runtime-only: bake keeps plain vertex-color terrain.
    let beach = null;
    if (!this.bake) {
      beach = new BABYLON.StandardMaterial('ashwood_beach', scene);
      beach.diffuseColor  = BABYLON.Color3.FromHexString(
        this.wg.config.colors.beachSand ?? '#d8bf8c');
      beach.specularColor = new BABYLON.Color3(0, 0, 0);
    }

    this._shared = { scene, ground, water, lakeWater, streamWater, bed, beach };
    return this._shared;
  }

  _ensureTemplates(scene) {
    if (this._templates && this._templatesScene === scene) return this._templates;
    this._templates = buildPropTemplates(scene, { bake: this.bake });
    this._templatesScene = scene;
    return this._templates;
  }

  load(meta, scene) {
    const shared = this._ensureShared(scene);
    const templates = this._ensureTemplates(scene);
    const container = new BABYLON.AssetContainer(scene);
    const bounds = tileBounds(meta.id, this.params);

    this._buildGround(meta, bounds, scene, shared, container);
    this._buildWater(meta, bounds, scene, shared, container);

    const inBounds = (x, z) =>
      x >= bounds.min.x && x < bounds.max.x && z >= bounds.min.z && z < bounds.max.z;
    const castShadow = this.bake ? null : scene.metadata?.ashwood?.castShadow ?? null;
    buildTileProps(
      { ...meta, min: bounds.min, max: bounds.max },
      scene, this.wg, templates, container, inBounds, castShadow,
      { lights: !this.bake },
    );

    // MeshBuilder already added everything to the scene at creation; the
    // loader calls addAllToScene() next. Detach first so each mesh ends up
    // in scene.meshes exactly once (double entries = double render).
    container.removeAllFromScene();
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
    const sand = wgHexToRgb(wg.config.colors.beachSand ?? '#d8bf8c');
    const wet = wgHexToRgb(wg.config.colors.streamWet ?? '#263733');

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

      // Ported ground-color pass: biome IDW blend → beach sand → lakebed
      // silt → trail dirt → mountain stream wet stone. Sand goes on before
      // silt so the beach band rings the waterline and stays visible through
      // the shallows, while deeper water still darkens to silt. A touch of
      // hash mottling keeps the strip from reading as a flat painted ring.
      wg.biomeColorAt(wx, wz, bc);
      const sh = wg.lakeShoreAt(wx, wz);
      if (sh > 0) {
        lerpRgb(bc, sand, sh * (0.78 + 0.16 * hash2(wx * 0.9, wz * 0.9)));
      }
      const wd = wg.lakeWaterDepthAt(wx, wz);
      if (wd > 0) {
        const k = Math.min(1, wd / 1.8);
        lerpRgb(bc, silt, 0.35 + 0.45 * k);
      }
      const td = wg.trailDirtAt(wx, wz);
      if (td > 0) lerpRgb(bc, dirt, td * 0.85);
      const sm = wg.mtnStreamMask?.(wx, wz) ?? 0;
      if (sm > 0) {
        lerpRgb(bc, wet, sm * (0.38 + 0.18 * hash2(wx * 0.48, wz * 0.48)));
      }

      colors[i * 4]     = bc.r;
      colors[i * 4 + 1] = bc.g;
      colors[i * 4 + 2] = bc.b;
      colors[i * 4 + 3] = 1;
    }

    // setVerticesData replaces the GPU buffer outright — CreateGround's
    // default buffers are non-updatable, so updateVerticesData would no-op
    // and leave every tile flat.
    ground.setVerticesData(BABYLON.VertexBuffer.PositionKind, positions, false);
    ground.setVerticesData(BABYLON.VertexBuffer.NormalKind, normals, false);
    ground.setVerticesData(BABYLON.VertexBuffer.ColorKind, colors, false, 4);
    ground.refreshBoundingInfo();

    ground.position.x = cx;
    ground.position.z = cz;
    ground.material = shared.ground;
    ground.receiveShadows = true;
    container.meshes.push(ground);
  }

  // ── water: Mirrormere + ponds + mountain stream ribbons. Water bodies are
  //    owned by one tile so streaming adds each exactly once. Stream segments
  //    are owned by the tile containing the segment midpoint; because each
  //    authored segment is short relative to a tile, that keeps the mesh visible
  //    in the player's tile ring without duplicate z-fighting.
  _buildWater(meta, bounds, scene, shared, container) {
    const wg = this.wg;
    const L = wg.config.lake;

    const owns = (x, z) =>
      x >= bounds.min.x && x < bounds.max.x && z >= bounds.min.z && z < bounds.max.z;

    if (owns(L.x, L.z)) {
      // Dense surface (~3.8k verts) so waves ripple across the whole lake.
      const surf = this._radialDisc(`tile_${meta.id}_lake`, L.waterR, scene,
        shared.lakeWater ?? shared.water, 40, 96);
      surf.position.set(L.x, L.level, L.z);
      // Depth-based shore factor: the lakebed is carved into the terrain
      // heightfield, so water depth under each vertex comes straight from
      // surfaceY — foam hugs the real (irregular) shoreline, not the disc rim.
      if (!this.bake) {
        this._applyShore(surf, (lx, lz) =>
          1 - clamp01((L.level - wg.surfaceY(L.x + lx, L.z + lz)) / 1.2));
        container.meshes.push(this._beachRing(`tile_${meta.id}_beach`, L, scene, shared.beach));
      }
      container.meshes.push(surf);
    }

    for (let i = 0; i < wg.sites.ponds.length; i++) {
      const p = wg.sites.ponds[i];
      if (!owns(p.x, p.z)) continue;
      const gh = wg.groundHeight(p.x, p.z);
      const lvl = gh - 0.12;

      // Carved bowl bed: rim at ground height, smootherstep down to the centre,
      // so the pond reads as a real basin under the translucent surface
      // (lake beds are already carved into the terrain heightfield).
      const bedMesh = this._bowl(`tile_${meta.id}_pondbed${i}`, p.r * 0.99, 0.7, scene, shared.bed);
      bedMesh.position.set(p.x, gh, p.z);
      container.meshes.push(bedMesh);

      const surf = this._radialDisc(`tile_${meta.id}_pond${i}`, p.r, scene, shared.water, 12, 48);
      surf.position.set(p.x, lvl, p.z);
      // Ponds are NOT carved into the heightfield (the bowl above fakes the
      // basin), so shore depth uses the same analytic bowl profile instead
      // of surfaceY: depth(r) = bowlDepth·(1 − smootherstep) − 0.12.
      if (!this.bake) {
        const bowlR = p.r * 0.99;
        this._applyShore(surf, (lx, lz) => {
          const r = Math.min(1, Math.hypot(lx, lz) / bowlR);
          const ss = r * r * r * (r * (r * 6 - 15) + 10);
          return 1 - clamp01((0.7 * (1 - ss) - 0.12) / 0.45);
        });
      }
      container.meshes.push(surf);
    }

    this._buildMountainStreams(meta, bounds, scene, shared, container, owns);
  }

  _buildMountainStreams(meta, bounds, scene, shared, container, owns) {
    const streams = this.wg.config.mountainStreams ?? [];
    if (!streams.length) return;
    for (let si = 0; si < streams.length; si++) {
      const stream = streams[si];
      const pts = stream.pts ?? [];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const mx = (a[0] + b[0]) * 0.5;
        const mz = (a[1] + b[1]) * 0.5;
        if (!owns(mx, mz)) continue;
        const ribbon = this._streamRibbon(
          `tile_${meta.id}_stream${si}_${i}`,
          stream,
          i,
          scene,
          shared.streamWater ?? shared.water,
        );
        if (ribbon) container.meshes.push(ribbon);
      }
    }
  }

  _streamRibbon(name, stream, segIndex, scene, material) {
    const pts = stream.pts ?? [];
    const a = pts[segIndex], b = pts[segIndex + 1];
    if (!a || !b) return null;

    const ax = a[0], az = a[1], bx = b[0], bz = b[1];
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1) return null;

    const tx = dx / len, tz = dz / len;
    const nx = -tz, nz = tx;
    const half = (stream.w ?? 6) * 0.42;
    const steps = Math.max(4, Math.ceil(len / 4.5));
    const positions = [];
    const indices = [];
    const shore = [];

    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = ax + dx * t;
      const cz = az + dz * t;
      const braid = (hash2(cx * 0.19 + 4.7, cz * 0.19 - 1.3) - 0.5) * half * 0.22;
      const width = half * (0.72 + 0.22 * Math.sin(t * Math.PI) + 0.08 * hash2(cx * 0.31, cz * 0.31));
      const ox = nx * width + tx * braid;
      const oz = nz * width + tz * braid;
      const y = this.wg.surfaceY(cx, cz) + 0.055;

      // Three vertices per cross-section: left edge, center flow, right edge.
      // The water shader uses shore=1 near contacts and shore≈0 in the middle,
      // giving narrow edge ripples instead of foaming the whole ribbon.
      positions.push(cx + ox, y, cz + oz);
      positions.push(cx, y + 0.018, cz);
      positions.push(cx - ox, y, cz - oz);
      shore.push(0.92, 0.18, 0.92);
    }

    for (let s = 0; s < steps; s++) {
      const c = s * 3, n = (s + 1) * 3;
      indices.push(c, n, c + 1, c + 1, n, n + 1);
      indices.push(c + 1, n + 1, c + 2, c + 2, n + 1, n + 2);
    }

    const mesh = new BABYLON.Mesh(name, scene);
    const vd = new BABYLON.VertexData();
    vd.positions = positions;
    vd.indices = indices;
    const normals = [];
    BABYLON.VertexData.ComputeNormals(positions, indices, normals);
    vd.normals = normals;
    vd.applyToMesh(mesh, false);
    mesh.setVerticesData('shore', new Float32Array(shore), false, 1);
    mesh.alphaIndex = 2;
    mesh.material = material;
    mesh.isPickable = false;
    return mesh;
  }

  // Sandy beach: an annulus draped over the terrain around the lake
  // waterline, from just under the water's edge out to where lakeShoreAt
  // fades to 0. Vertex alpha IS the shore factor, so the sand dissolves into
  // the grass at its outer edge and follows the height-based band on its
  // way there; hash mottling keeps the strip from reading flat. Sits 5cm
  // above the terrain to avoid z-fighting; the inner rings continue under
  // the water surface so the glassy shallows reveal a wet sand shelf.
  // A damp contact band darkens the sand at and just above the waterline —
  // wet soil/mud that dries out by ~+0.4m, broken up by a second hash so
  // the drying edge reads as patchy erosion, not a painted stripe.
  _beachRing(name, L, scene, material, rings = 24, segs = 96) {
    const wg = this.wg;
    const rIn = L.waterR - 4;
    const rOut = L.bowlR + 10;
    const positions = [];
    const colors = [];
    const indices = [];
    for (let r = 0; r <= rings; r++) {
      const rr = rIn + (r / rings) * (rOut - rIn);
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        const lx = Math.cos(a) * rr, lz = Math.sin(a) * rr;
        const wx = L.x + lx, wz = L.z + lz;
        const sy = wg.surfaceY(wx, wz);
        positions.push(lx, sy + 0.05, lz);
        const damp = clamp01(1 - (sy - L.level - 0.04) / 0.35);
        const wet = 1 - 0.42 * damp * (0.7 + 0.3 * hash2(wx * 3.3, wz * 3.3));
        const m = (0.9 + 0.14 * hash2(wx * 1.7, wz * 1.7)) * wet;
        // Inner edge fades over 2.5m so the submerged shelf has no hard rim.
        colors.push(m, m, m, wg.lakeShoreAt(wx, wz) * clamp01((rr - rIn) / 2.5));
      }
    }
    for (let r = 0; r < rings; r++) {
      const cur = r * segs, nxt = (r + 1) * segs;
      for (let s = 0; s < segs; s++) {
        const s1 = (s + 1) % segs;
        indices.push(cur + s, nxt + s, cur + s1, cur + s1, nxt + s, nxt + s1);
      }
    }
    const mesh = new BABYLON.Mesh(name, scene);
    const vd = new BABYLON.VertexData();
    vd.positions = positions;
    vd.indices = indices;
    const normals = [];
    BABYLON.VertexData.ComputeNormals(positions, indices, normals);
    vd.normals = normals;
    vd.colors = colors;
    vd.applyToMesh(mesh, false);
    mesh.hasVertexAlpha = true;   // alpha-blend the fade-out edge
    // Both this ring and the water disc are centered on the lake, so
    // Babylon's distance sort between the two transparent meshes is
    // ambiguous and flips with the camera. Explicit alphaIndex pins the
    // order: sand first, water (and its foam) always composited on top.
    mesh.alphaIndex = 1;
    mesh.position.set(L.x, 0, L.z);
    mesh.material = material;
    mesh.isPickable = false;
    mesh.receiveShadows = true;
    return mesh;
  }

  // Per-vertex 'shore' attribute for the water shader's foam band: 0 in deep
  // water rising to 1 where the surface meets land. shoreAt takes LOCAL disc
  // coordinates (the mesh is translated to the water body's center).
  _applyShore(mesh, shoreAt) {
    const pos = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    const shore = new Float32Array(pos.length / 3);
    for (let i = 0; i < shore.length; i++) {
      shore[i] = shoreAt(pos[i * 3], pos[i * 3 + 2]);
    }
    mesh.setVerticesData('shore', shore, false, 1);
  }

  // Horizontal radial-grid disc with interior vertices (center + concentric
  // rings). Material is double-sided (no back-face culling) so winding is moot.
  // alphaIndex 2 keeps translucent water above the alphaIndex-1 beach ring.
  _radialDisc(name, radius, scene, material, rings = 24, segs = 64) {
    const positions = [0, 0, 0];
    const indices = [];
    for (let r = 1; r <= rings; r++) {
      const rr = (r / rings) * radius;
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2;
        positions.push(Math.cos(a) * rr, 0, Math.sin(a) * rr);
      }
    }
    for (let s = 0; s < segs; s++) {       // inner cap (center → ring 1)
      indices.push(0, 1 + s, 1 + ((s + 1) % segs));
    }
    for (let r = 1; r < rings; r++) {      // ring quads
      const cur = 1 + (r - 1) * segs, nxt = 1 + r * segs;
      for (let s = 0; s < segs; s++) {
        const s1 = (s + 1) % segs;
        indices.push(cur + s, nxt + s, cur + s1, cur + s1, nxt + s, nxt + s1);
      }
    }
    const mesh = new BABYLON.Mesh(name, scene);
    const vd = new BABYLON.VertexData();
    vd.positions = positions;
    vd.indices = indices;
    const normals = [];
    BABYLON.VertexData.ComputeNormals(positions, indices, normals);
    vd.normals = normals;
    vd.applyToMesh(mesh, false);
    mesh.alphaIndex = 2;
    mesh.material = material;
    mesh.isPickable = false;
    return mesh;
  }

  // Carved basin: a radial disc displaced downward toward the center via a
  // smootherstep (flat rim, deepest middle).
  _bowl(name, radius, depth, scene, material, rings = 16, segs = 48) {
    const mesh = this._radialDisc(name, radius, scene, material, rings, segs);
    const pos = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind);
    for (let i = 0; i < pos.length; i += 3) {
      const r = Math.min(1, Math.hypot(pos[i], pos[i + 2]) / radius);
      const ss = r * r * r * (r * (r * 6 - 15) + 10); // smootherstep, 0→1
      pos[i + 1] = -depth * (1 - ss);                  // center deepest, rim flat
    }
    mesh.setVerticesData(BABYLON.VertexBuffer.PositionKind, pos, false);
    const normals = [];
    BABYLON.VertexData.ComputeNormals(pos, mesh.getIndices(), normals);
    mesh.setVerticesData(BABYLON.VertexBuffer.NormalKind, normals, false);
    mesh.refreshBoundingInfo();
    return mesh;
  }
}

// ── Ashwood water — dual-scrolled normal map, fresnel sky blend, sun glint.
// Ported from the prototype's makeWaterMaterial() (lines ~869-912). Scene
// EXP2 fog is applied manually (ShaderMaterial bypasses Babylon's fog).
// Lighting state is read per-frame from scene.metadata.ashwood.lm.

const WATER_VERT = `
precision highp float;
attribute vec3 position;
attribute float shore;
uniform mat4 world;
uniform mat4 viewProjection;
uniform float t;
varying vec3 vWp;
varying vec3 vN;
varying vec4 vClip;
varying float vShore;
// Three directional sine waves (a cheap Gerstner-style sum). Height is
// accumulated along with its analytic slope so the surface normal is exact —
// no finite differencing, no extra vertex passes.
void main() {
  vec4 wp = world * vec4(position, 1.0);
  vec2 P = wp.xz;
  float h = 0.0, dhdx = 0.0, dhdz = 0.0;
  vec2 dirs[3];  float amp[3];  float len[3];  float spd[3];
  dirs[0] = normalize(vec2( 1.0,  0.35)); amp[0] = 0.18; len[0] = 9.0; spd[0] = 1.1;
  dirs[1] = normalize(vec2(-0.6,  1.0 )); amp[1] = 0.11; len[1] = 5.5; spd[1] = 1.6;
  dirs[2] = normalize(vec2( 0.3, -1.0 )); amp[2] = 0.05; len[2] = 3.0; spd[2] = 2.3;
  for (int i = 0; i < 3; i++) {
    float k = 6.2831853 / len[i];
    float ph = dot(dirs[i], P) * k + t * spd[i];
    h += amp[i] * sin(ph);
    float c = amp[i] * k * cos(ph);
    dhdx += c * dirs[i].x; dhdz += c * dirs[i].y;
  }
  wp.y += h;
  vWp = wp.xyz;
  vN = normalize(vec3(-dhdx, 1.0, -dhdz));
  vShore = shore;
  vClip = viewProjection * wp;
  gl_Position = vClip;
}
`;

const WATER_FRAG = `
precision highp float;
varying vec3 vWp;
varying vec3 vN;
varying vec4 vClip;
varying float vShore;
uniform sampler2D uN;
#ifdef REFLECT
uniform sampler2D uReflection;
#endif
uniform float t;
uniform vec3 sunDir; uniform vec3 sunCol;
uniform vec3 deep; uniform vec3 shallow; uniform vec3 skyCol;
uniform float night; uniform float alphaV;
uniform vec3 cameraPosition;
uniform vec3 vFogColor; uniform float fogDensity;
vec2 nm(vec2 uv){ return texture2D(uN, uv).rg * 2.0 - 1.0; }
void main() {
  vec2 uv = vWp.xz * 0.055;
  vec2 d1 = nm(uv + vec2(t * 0.020, t * 0.0125));
  vec2 d2 = nm(uv * 1.73 - vec2(t * 0.016, t * 0.021));
  // Steeper ripple detail (constant was 5.2) layered onto the geometric wave
  // normal from the vertex stage.
  vec3 detail = normalize(vec3(d1.x + d2.x, 3.0, d1.y + d2.y));
  vec3 n = normalize(vN + vec3(detail.x, 0.0, detail.z) * 0.5);
  vec3 V = normalize(cameraPosition - vWp);
  float fres = pow(1.0 - max(dot(V, n), 0.0), 3.0);
  vec3 col = mix(deep, shallow, clamp(0.4 + 0.35 * (n.x + n.z), 0.0, 1.0));
  vec3 skyRefl = skyCol;
#ifdef REFLECT
  // Planar reflection: project the fragment to screen space, nudge by the
  // wave normal for a rippled mirror, fade out at night.
  vec2 ruv = (vClip.xy / vClip.w) * 0.5 + 0.5;
  ruv += n.xz * 0.04;
  vec3 mir = texture2D(uReflection, clamp(ruv, 0.001, 0.999)).rgb;
  skyRefl = mix(skyCol, mir, 0.85 * (1.0 - night));
#endif
  col = mix(col, skyRefl, clamp(fres, 0.0, 1.0) * 0.75);
  vec3 R = reflect(-normalize(sunDir), n);
  col += sunCol * pow(max(dot(R, V), 0.0), 130.0) * (2.0 * (1.0 - night) + 0.35);
  col *= mix(1.0, 0.22, night * 0.9);
  // Shore contact — deliberately foamless. vShore (0 deep → 1 at the
  // waterline, baked per vertex from real water depth) is roughened by the
  // scrolling normal map so the transition wanders organically instead of
  // tracing a clean circle. Two effects replace the old white foam crest:
  //  - low soft ripple bands travelling shoreward (two incommensurate
  //    phases so the laps feel irregular, faded out again just before the
  //    waterline so the contact itself stays gentle);
  //  - a transparency ramp: over the last ~half meter of depth the water
  //    thins to glass, revealing the wet sand shelf, pebbles and reeds
  //    beneath instead of ending in a hard edge.
  float shoreN = nm(vWp.xz * 0.13 + vec2(t * 0.03, -t * 0.022)).x * 0.5 + 0.5;
  float sEdge = clamp(vShore + (shoreN - 0.5) * 0.3, 0.0, 1.0);
  float lap = max(sin(sEdge * 24.0 - t * 1.6), 0.0) * 0.6
            + max(sin(sEdge * 11.0 - t * 0.9 + shoreN * 4.0), 0.0) * 0.4;
  lap *= smoothstep(0.55, 0.85, sEdge) * (1.0 - smoothstep(0.92, 1.0, sEdge));
  col += vec3(0.07, 0.085, 0.09) * lap * (1.0 - night * 0.7);
  float dist = length(cameraPosition - vWp);
  float fog = exp(-pow(dist * fogDensity, 2.0));
  col = mix(vFogColor, col, clamp(fog, 0.0, 1.0));
  float shallow = smoothstep(0.6, 0.96, sEdge);
  float a = mix(clamp(alphaV + fres * 0.13, 0.0, 0.97), 0.05, shallow);
  gl_FragColor = vec4(col, clamp(a + lap * 0.06, 0.0, 0.97));
}
`;

// Base water colors (modulated toward night / dusk per frame on the CPU).
const W_DEEP    = wgHexToRgb('#0b2128');
const W_SHALLOW = wgHexToRgb('#29646a');
const W_SKY     = wgHexToRgb('#9db8c8');
const W_DUSK    = wgHexToRgb('#caa06a');  // golden cast pulled in at sunset

function buildWaterMaterial(scene, opts = {}) {
  BABYLON.Effect.ShadersStore['ashwoodWaterVertexShader'] = WATER_VERT;
  BABYLON.Effect.ShadersStore['ashwoodWaterFragmentShader'] = WATER_FRAG;

  const reflect = !!opts.reflect;
  const mat = new BABYLON.ShaderMaterial(opts.name ?? (reflect ? 'ashwood_lakewater' : 'ashwood_water'), scene, 'ashwoodWater', {
    attributes: ['position', 'shore'],
    uniforms: ['world', 'viewProjection', 'cameraPosition',
               't', 'sunDir', 'sunCol', 'deep', 'shallow', 'skyCol',
               'night', 'alphaV', 'vFogColor', 'fogDensity'],
    samplers: reflect ? ['uN', 'uReflection'] : ['uN'],
    defines: reflect ? ['#define REFLECT'] : [],
    needAlphaBlending: true,
  });
  mat.backFaceCulling = false;

  const normals = new BABYLON.Texture('/assets/textures/waternormals.jpg', scene);
  normals.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
  normals.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  mat.setTexture('uN', normals);

  if (reflect) {
    // Planar reflection of the world above the water. renderList = null reflects
    // the whole scene; MirrorTexture's clip plane drops sub-surface geometry, so
    // the lake surface never reflects itself and streamed tiles need no syncing.
    const mirror = new BABYLON.MirrorTexture('ashwoodWaterMirror', { ratio: 0.5 }, scene, true);
    mirror.mirrorPlane = new BABYLON.Plane(0, -1, 0, opts.level ?? 0);
    mirror.renderList = null;
    mirror.level = 1.0;
    mat.setTexture('uReflection', mirror);
    if (!scene.customRenderTargets.includes(mirror)) scene.customRenderTargets.push(mirror);
    scene.metadata = scene.metadata || {};
    scene.metadata.ashwood = scene.metadata.ashwood || {};
    scene.metadata.ashwood.waterMirror = mirror;
  }

  mat.setColor3('deep',    BABYLON.Color3.FromHexString('#0b2128'));
  mat.setColor3('shallow', BABYLON.Color3.FromHexString('#29646a'));
  mat.setColor3('skyCol',  BABYLON.Color3.FromHexString('#9db8c8'));
  mat.setFloat('alphaV', opts.alpha ?? 0.84);
  mat.setFloat('night', 0);
  mat.setFloat('t', 0);

  const sunDir = new BABYLON.Vector3(0.4, 0.8, 0.3);
  const sunCol = new BABYLON.Color3(1.0, 0.93, 0.8);
  mat.setVector3('sunDir', sunDir);
  mat.setColor3('sunCol', sunCol);

  // Scratch colors so the per-frame day/night tint allocates nothing.
  const cDeep = new BABYLON.Color3(), cShallow = new BABYLON.Color3(), cSky = new BABYLON.Color3();

  let t = 0;
  scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() / 1000;
    mat.setFloat('t', t);
    mat.setColor3('vFogColor', scene.fogColor);
    mat.setFloat('fogDensity', scene.fogDensity);
    const lm = scene.metadata?.ashwood?.lm;
    let dayF = 1, dusk = 0;
    if (lm?.key) {
      sunDir.copyFrom(lm.key.direction).scaleInPlace(-1);
      mat.setVector3('sunDir', sunDir);
      dayF = lm.dayFactor ?? 1;
      dusk = lm.duskFactor ?? 0;
      mat.setFloat('night', Math.max(0, Math.min(1, 1 - dayF * 1.5)));
    }
    // Day/night tint: darken toward night, warm the sky/shallow toward dusk.
    const k = 0.30 + 0.70 * dayF;
    cDeep.set(W_DEEP.r * k, W_DEEP.g * k, W_DEEP.b * k);
    cShallow.set(W_SHALLOW.r * k, W_SHALLOW.g * k, W_SHALLOW.b * k);
    cSky.set(
      (W_SKY.r + (W_DUSK.r - W_SKY.r) * dusk * 0.6) * k,
      (W_SKY.g + (W_DUSK.g - W_SKY.g) * dusk * 0.6) * k,
      (W_SKY.b + (W_DUSK.b - W_SKY.b) * dusk * 0.6) * k,
    );
    mat.setColor3('deep', cDeep);
    mat.setColor3('shallow', cShallow);
    mat.setColor3('skyCol', cSky);
  });

  return mat;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
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
