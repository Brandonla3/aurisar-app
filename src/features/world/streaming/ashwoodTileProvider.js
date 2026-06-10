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

    const ground = new BABYLON.StandardMaterial('ashwood_ground', scene);
    ground.specularColor = new BABYLON.Color3(0, 0, 0);
    if (!this.bake) {
      const grassTex = new BABYLON.Texture('/assets/textures/grasslight-big.jpg', scene);
      grassTex.uScale = GRASS_REPEATS_PER_TILE;
      grassTex.vScale = GRASS_REPEATS_PER_TILE;
      ground.diffuseTexture = grassTex;        // modulated by biome vertex colors
      const grassNm = new BABYLON.Texture('/assets/textures/grasslight-big-nm.jpg', scene);
      grassNm.uScale = GRASS_REPEATS_PER_TILE;
      grassNm.vScale = GRASS_REPEATS_PER_TILE;
      grassNm.level = 0.85;
      ground.bumpTexture = grassNm;
    }

    let water;
    if (this.bake) {
      water = new BABYLON.StandardMaterial('ashwood_water', scene);
      water.diffuseColor = BABYLON.Color3.FromHexString('#29646a');
      water.alpha = 0.84;
      water.backFaceCulling = false;
    } else {
      water = buildWaterMaterial(scene);
    }

    const bed = new BABYLON.StandardMaterial('ashwood_pondbed', scene);
    bed.diffuseColor  = new BABYLON.Color3(0.043, 0.10, 0.114);
    bed.specularColor = new BABYLON.Color3(0, 0, 0);
    bed.backFaceCulling = false;

    this._shared = { scene, ground, water, bed };
    return this._shared;
  }

  _ensureTemplates(scene) {
    if (this._templates && this._templatesScene === scene) return this._templates;
    this._templates = buildPropTemplates(scene);
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

// ── Ashwood water — dual-scrolled normal map, fresnel sky blend, sun glint.
// Ported from the prototype's makeWaterMaterial() (lines ~869-912). Scene
// EXP2 fog is applied manually (ShaderMaterial bypasses Babylon's fog).
// Lighting state is read per-frame from scene.metadata.ashwood.lm.

const WATER_VERT = `
precision highp float;
attribute vec3 position;
uniform mat4 world;
uniform mat4 worldViewProjection;
varying vec3 vWp;
void main() {
  vec4 wp = world * vec4(position, 1.0);
  vWp = wp.xyz;
  gl_Position = worldViewProjection * vec4(position, 1.0);
}
`;

const WATER_FRAG = `
precision highp float;
varying vec3 vWp;
uniform sampler2D uN;
uniform float t;
uniform vec3 sunDir; uniform vec3 sunCol;
uniform vec3 deep; uniform vec3 shallow; uniform vec3 skyCol;
uniform float night; uniform float alphaV;
uniform vec3 cameraPosition;
uniform vec3 vFogColor; uniform float fogDensity;
vec2 nm(vec2 uv){ return texture2D(uN, uv).rg * 2.0 - 1.0; }
void main() {
  vec2 uv = vWp.xz * 0.055;
  vec2 n1 = nm(uv + vec2(t * 0.020, t * 0.0125));
  vec2 n2 = nm(uv * 1.73 - vec2(t * 0.016, t * 0.021));
  vec3 n = normalize(vec3(n1.x + n2.x, 5.2, n1.y + n2.y));
  vec3 V = normalize(cameraPosition - vWp);
  float fres = pow(1.0 - max(dot(V, n), 0.0), 3.0);
  vec3 col = mix(deep, shallow, clamp(0.4 + 0.35 * (n.x + n.z), 0.0, 1.0));
  col = mix(col, skyCol, fres * 0.7);
  vec3 R = reflect(-normalize(sunDir), n);
  col += sunCol * pow(max(dot(R, V), 0.0), 130.0) * (2.0 * (1.0 - night) + 0.35);
  col *= mix(1.0, 0.22, night * 0.9);
  float dist = length(cameraPosition - vWp);
  float fog = exp(-pow(dist * fogDensity, 2.0));
  col = mix(vFogColor, col, clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(col, clamp(alphaV + fres * 0.13, 0.0, 0.97));
}
`;

function buildWaterMaterial(scene) {
  BABYLON.Effect.ShadersStore['ashwoodWaterVertexShader'] = WATER_VERT;
  BABYLON.Effect.ShadersStore['ashwoodWaterFragmentShader'] = WATER_FRAG;

  const mat = new BABYLON.ShaderMaterial('ashwood_water', scene, 'ashwoodWater', {
    attributes: ['position'],
    uniforms: ['world', 'worldViewProjection', 'cameraPosition',
               't', 'sunDir', 'sunCol', 'deep', 'shallow', 'skyCol',
               'night', 'alphaV', 'vFogColor', 'fogDensity'],
    samplers: ['uN'],
    needAlphaBlending: true,
  });
  mat.backFaceCulling = false;

  const normals = new BABYLON.Texture('/assets/textures/waternormals.jpg', scene);
  normals.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
  normals.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
  mat.setTexture('uN', normals);

  mat.setColor3('deep',    BABYLON.Color3.FromHexString('#0b2128'));
  mat.setColor3('shallow', BABYLON.Color3.FromHexString('#29646a'));
  mat.setColor3('skyCol',  BABYLON.Color3.FromHexString('#9db8c8'));
  mat.setFloat('alphaV', 0.84);
  mat.setFloat('night', 0);
  mat.setFloat('t', 0);

  const sunDir = new BABYLON.Vector3(0.4, 0.8, 0.3);
  const sunCol = new BABYLON.Color3(1.0, 0.93, 0.8);
  mat.setVector3('sunDir', sunDir);
  mat.setColor3('sunCol', sunCol);

  let t = 0;
  scene.onBeforeRenderObservable.add(() => {
    t += scene.getEngine().getDeltaTime() / 1000;
    mat.setFloat('t', t);
    mat.setColor3('vFogColor', scene.fogColor);
    mat.setFloat('fogDensity', scene.fogDensity);
    const lm = scene.metadata?.ashwood?.lm;
    if (lm?.key) {
      sunDir.copyFrom(lm.key.direction).scaleInPlace(-1);
      mat.setVector3('sunDir', sunDir);
      mat.setFloat('night', Math.max(0, Math.min(1, 1 - (lm.dayFactor ?? 1) * 1.5)));
    }
  });

  return mat;
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
