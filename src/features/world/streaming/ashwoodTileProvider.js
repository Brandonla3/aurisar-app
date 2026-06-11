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

    let water, lakeWater;
    if (this.bake) {
      water = new BABYLON.StandardMaterial('ashwood_water', scene);
      water.diffuseColor = BABYLON.Color3.FromHexString('#29646a');
      water.alpha = 0.84;
      water.backFaceCulling = false;
      lakeWater = water;
    } else {
      water = buildWaterMaterial(scene, {});
      // Lake gets its own material with a planar reflection at its surface level.
      lakeWater = buildWaterMaterial(scene, { reflect: true, level: this.wg.config.lake.level });
    }

    const bed = new BABYLON.StandardMaterial('ashwood_pondbed', scene);
    bed.diffuseColor  = new BABYLON.Color3(0.043, 0.10, 0.114);
    bed.specularColor = new BABYLON.Color3(0, 0, 0);
    bed.backFaceCulling = false;

    this._shared = { scene, ground, water, lakeWater, bed };
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

  // ── water: Mirrormere + ponds (owned by the tile that contains their center,
  //    so streaming adds each exactly once). Surfaces are dense radial grids so
  //    the Gerstner vertex waves move the whole interior (a fan disc only has
  //    rim + center verts). The lake gets a planar reflection; ponds keep the
  //    upgraded waves + fresnel sky but no per-pond mirror. ──────────────────
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
      container.meshes.push(surf);
    }
  }

  // Horizontal radial-grid disc with interior vertices (center + concentric
  // rings). Material is double-sided (no back-face culling) so winding is moot.
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
uniform mat4 world;
uniform mat4 viewProjection;
uniform float t;
varying vec3 vWp;
varying vec3 vN;
varying vec4 vClip;
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
  vClip = viewProjection * wp;
  gl_Position = vClip;
}
`;

const WATER_FRAG = `
precision highp float;
varying vec3 vWp;
varying vec3 vN;
varying vec4 vClip;
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
  float dist = length(cameraPosition - vWp);
  float fog = exp(-pow(dist * fogDensity, 2.0));
  col = mix(vFogColor, col, clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(col, clamp(alphaV + fres * 0.13, 0.0, 0.97));
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
  const mat = new BABYLON.ShaderMaterial(reflect ? 'ashwood_lakewater' : 'ashwood_water', scene, 'ashwoodWater', {
    attributes: ['position'],
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
  mat.setFloat('alphaV', 0.84);
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

function wgHexToRgb(hex) {
  const v = parseInt(hex.replace('#', ''), 16);
  return { r: ((v >> 16) & 255) / 255, g: ((v >> 8) & 255) / 255, b: (v & 255) / 255 };
}

function lerpRgb(a, b, t) {
  a.r += (b.r - a.r) * t;
  a.g += (b.g - a.g) * t;
  a.b += (b.b - a.b) * t;
}
