/**
 * AshwoodGrass — wind-animated instanced grass that follows the player.
 *
 * A deterministic hash2 cell grid (cell 0.6 m, radius 30 m) rebuilt whenever
 * the player crosses a cell, rendered as thin instances of a crossed-quad
 * "card" template with a vertex-shader wind sway. One draw call.
 *
 * Each card samples an alpha-cutout clump texture (grass-cards.png, two
 * 512px variants side by side, extracted from Meshy AI renders) — the
 * instance color's alpha channel selects the variant, its rgb carries the
 * biome tint that hue-shifts the texture per biome.
 *
 * A second, sparser layer of "hero" clumps (real 3D blade geometry lifted
 * from the Meshy GLB, grassClump.json, ~1.3k tris) surrounds the player on
 * the high quality tier — same shader with uTextured=0, so the blades take
 * the biome tint + AO gradient instead of the card texture. Two draw calls
 * total, second one gated to tier 'high'.
 *
 * Placement is pure hash2 math — identical on every client, no manifest.
 */

/* global BABYLON */

import { hash2 } from '../worldgen/index.js';
import clumpData from './grassClump.json' with { type: 'json' };

const CELL = 0.6;
const RADIUS = 30;
const HERO_CELL = 2.2;
const HERO_RADIUS = 12;

const VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
#include<instancesDeclaration>
// Thin-instance color arrives as the auto-declared 'instanceColor' attribute
// (inside instancesDeclaration when the mesh has a color buffer), NOT as
// 'color' — binding 'color' silently reads zeros and every card goes black.
#ifndef INSTANCESCOLOR
attribute vec4 instanceColor;
#endif
uniform mat4 viewProjection;
uniform float uTime;
uniform float uWind;
varying vec4 vCol;
varying vec2 vUV;
varying vec3 vWp;
varying vec3 vN;
void main() {
  #include<instancesVertex>
  vec3 p = position;
  float ph = finalWorld[3].x * 0.25 + finalWorld[3].z * 0.25;
  float b = sin(uTime * 1.6 + ph) * 0.5 + sin(uTime * 3.1 + ph * 1.7) * 0.2;
  float hq = position.y * position.y;
  p.x += b * 0.7 * hq * uWind;
  p.z += cos(uTime * 1.3 + ph) * 0.35 * hq * uWind;
  vec4 wp = finalWorld * vec4(p, 1.0);
  vWp = wp.xyz;

  // Atlas holds two clump variants side by side; the instance color's alpha
  // channel (0 or 1) picks which half this card samples.
  vUV = vec2(uv.x * 0.5 + instanceColor.a * 0.5, uv.y);

  // Vertical AO: darken the base (ground contact), brighten the tip — reads
  // as ambient occlusion for one extra multiply, no extra draw/pass.
  float ao = mix(0.6, 1.1, clamp(position.y / 0.7, 0.0, 1.0));
  vCol = vec4(instanceColor.rgb * ao, 1.0);

  // Approximate world-space normal: baked per-triangle flat normals (computed
  // once in JS at blade-geometry build time) rotated by the instance's world
  // matrix. Instance scale is mildly non-uniform (y differs from x/z), so
  // this 3x3 rotation isn't a true inverse-transpose normal matrix, but at
  // blade scale the skew is imperceptible and far cheaper per-instance.
  vN = normalize(mat3(finalWorld) * normal);

  gl_Position = viewProjection * wp;
}
`;

const FRAG = `
precision highp float;
varying vec4 vCol;
varying vec2 vUV;
varying vec3 vWp;
varying vec3 vN;
uniform sampler2D uCardTex;
uniform float uTextured;     // 1 = card atlas cutout, 0 = untextured geometry
uniform float uLight;
uniform vec3 cameraPosition;
uniform vec3 vFogColor;
uniform float fogDensity;
uniform vec3 uSunDir;        // world-space direction toward the sun
uniform float uBackStrength; // 0 on low/mobile tier, >0 on high tier
void main() {
  // Untextured (hero clump) fragments use a flat 0.55 in place of the card
  // texture so both layers land at the same average brightness.
  vec4 tex = vec4(0.55);
  if (uTextured > 0.5) {
    tex = texture2D(uCardTex, vUV);
    // Alpha cutout — no sorting/blending needed, cards stay one draw call.
    if (tex.a < 0.35) discard;
  }

  vec3 N = normalize(vN);
  vec3 L = normalize(uSunDir);
  float ndl = dot(N, L);
  // Wrapped diffuse: lets blades catch light even when N faces mostly away
  // from the sun — real grass never reads as flat-shaded/fully unlit.
  float wrap = clamp((ndl + 0.5) / 1.5, 0.0, 1.0);
  float lambert = mix(0.55, 1.0, wrap);

  // The texture carries the blade detail; the instance rgb (biome grassCol,
  // ~0.15-0.5) hue-shifts it per biome. 1.7 renormalizes the tint so a
  // mid-green biome keeps the texture a touch deeper than neutral.
  vec3 base = tex.rgb * clamp(vCol.rgb * 1.7, 0.0, 1.5);

  vec3 V = normalize(cameraPosition - vWp);
  // Translucency / backlight: blades glow when the sun sits behind them from
  // the camera's viewpoint — the "glowing grass" look at golden hour. Zero
  // on low/mobile tier (uBackStrength), so this is a free no-op there.
  float back = pow(clamp(dot(-V, L), 0.0, 1.0), 2.0) * uBackStrength;

  vec3 c = base * uLight * lambert + base * back;
  float dist = length(cameraPosition - vWp);
  float fog = exp(-pow(dist * fogDensity, 2.0));
  c = mix(vFogColor, c, clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(c, 1.0);
}
`;

// Crossed pair of textured quads ("grass cards"). Each quad maps the full
// clump texture (variant half is selected in the vertex shader); the second
// quad is rotated 90° so the clump reads from every camera angle.
function cardGeometry() {
  const w = 0.45, h = 0.7;
  const positions = [
    // quad A — faces ±Z
    -w, 0, 0,   w, 0, 0,   w, h, 0,   -w, h, 0,
    // quad B — faces ±X
    0, 0, -w,   0, 0, w,   0, h, w,   0, h, -w,
  ];
  // v=0 samples the image bottom (opaque grass roots) at ground level, v=1
  // the transparent sky at the card top (Texture default invertY).
  const uvs = [
    0, 0,  1, 0,  1, 1,  0, 1,
    0, 0,  1, 0,  1, 1,  0, 1,
  ];
  const normals = [
    0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
    1, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 0,
  ];
  const indices = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  return { positions, indices, normals, uvs };
}

// Real blade geometry extracted from the Meshy AI grass GLB (13 blades,
// ~1.3k tris), normalized to a 0.75 m clump rooted at the origin. Smooth
// normals are computed here; UVs are dummy zeros (uTextured=0 path).
function clumpGeometry() {
  const positions = clumpData.positions;
  const indices = clumpData.indices;
  const normals = new Array(positions.length).fill(0);
  BABYLON.VertexData.ComputeNormals(positions, indices, normals);
  const uvs = new Array((positions.length / 3) * 2).fill(0);
  return { positions, indices, normals, uvs };
}

export class AshwoodGrass {
  constructor(scene, worldgen, getPlayerPos) {
    this.scene = scene;
    this.wg = worldgen;
    this.getPlayerPos = getPlayerPos;
    this.lastX = 1e9;
    this.lastZ = 1e9;
    this.time = 0;
    this._sunDir = new BABYLON.Vector3(0, 1, 0); // safe default before lm.key is read

    BABYLON.Effect.ShadersStore['ashwoodGrassVertexShader'] = VERT;
    BABYLON.Effect.ShadersStore['ashwoodGrassFragmentShader'] = FRAG;

    this._cardTex = new BABYLON.Texture('/assets/textures/grass-cards.png', scene);
    this._cardTex.anisotropicFilteringLevel = 4;

    const makeMaterial = (name, textured) => {
      const mat = new BABYLON.ShaderMaterial(name, scene, 'ashwoodGrass', {
        // world0-3 MUST be declared for (thin) instancing — without them the
        // instancesVertex include reads unbound attributes and instance
        // matrices come out as garbage (blades stretched across the sky).
        attributes: ['position', 'normal', 'uv', 'instanceColor', 'world0', 'world1', 'world2', 'world3'],
        uniforms: ['viewProjection', 'world', 'cameraPosition',
                   'uTime', 'uWind', 'uTextured', 'uLight', 'vFogColor', 'fogDensity',
                   'uSunDir', 'uBackStrength'],
        samplers: ['uCardTex'],
      });
      mat.backFaceCulling = false;
      mat.setTexture('uCardTex', this._cardTex);
      mat.setFloat('uTextured', textured ? 1 : 0);
      return mat;
    };
    this.material = makeMaterial('ashwoodGrassMat', true);
    this.heroMaterial = makeMaterial('ashwoodGrassHeroMat', false);

    const makeMesh = (name, geo, mat) => {
      const mesh = new BABYLON.Mesh(name, scene);
      const vd = new BABYLON.VertexData();
      vd.positions = geo.positions;
      vd.indices = geo.indices;
      vd.normals = geo.normals;
      vd.uvs = geo.uvs;
      vd.applyToMesh(mesh);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.alwaysSelectAsActiveMesh = true; // skip culling: it surrounds the camera
      return mesh;
    };
    this.mesh = makeMesh('ashwoodGrass', cardGeometry(), this.material);
    this.heroMesh = makeMesh('ashwoodGrassHero', clumpGeometry(), this.heroMaterial);

    const n = Math.ceil(RADIUS / CELL);
    this.cap = (2 * n + 1) * (2 * n + 1);
    this._mats = new Float32Array(this.cap * 16);
    this._cols = new Float32Array(this.cap * 4);
    const hn = Math.ceil(HERO_RADIUS / HERO_CELL);
    this.heroCap = (2 * hn + 1) * (2 * hn + 1);
    this._heroMats = new Float32Array(this.heroCap * 16);
    this._heroCols = new Float32Array(this.heroCap * 4);

    this._observer = scene.onBeforeRenderObservable.add(() => this._update());
  }

  _update() {
    const p = this.getPlayerPos?.();
    if (!p) return;
    this.time += this.scene.getEngine().getDeltaTime() / 1000;
    // storm-swept blades: the weather system publishes wind strength
    const wind = this.scene.metadata?.ashwood?.weather?.windStrength ?? 1;
    const lm = this.scene.metadata?.ashwood?.lm;
    const tier = this.scene.metadata?.ashwood?.qualityTier;
    if (lm?.key) {
      this._sunDir.copyFrom(lm.key.direction).scaleInPlace(-1);
      this._sunDir.normalize();
    }
    for (const m of [this.material, this.heroMaterial]) {
      m.setFloat('uTime', this.time);
      m.setFloat('uWind', Math.max(0.2, Math.min(3, wind)));
      m.setFloat('uLight', 0.35 + 0.65 * (lm?.dayFactor ?? 1));
      m.setColor3('vFogColor', this.scene.fogColor);
      m.setFloat('fogDensity', this.scene.fogDensity);
      m.setVector3('uSunDir', this._sunDir);
      // High tier only — cheap to always set, the shader multiplies by 0 on
      // low/mobile so the term is a free no-op there.
      m.setFloat('uBackStrength', tier === 'high' ? 0.5 : 0.0);
    }
    // The 3D hero clumps are ~1.3k tris each — high tier only.
    this.heroMesh.setEnabled(tier !== 'low' && tier !== 'mobile');
    if (Math.abs(p.x - this.lastX) + Math.abs(p.z - this.lastZ) > CELL) this._rebuild(p.x, p.z);
  }

  // Scatter one layer onto the hash grid. Both layers share the same biome /
  // trail / lake / forest filters so hero clumps only appear where cards do.
  _scatter(px, pz, cell, radius, keep, mats, cols, cap) {
    const wg = this.wg;
    const n = Math.ceil(radius / cell);
    const R2 = radius * radius;
    const worldR2 = wg.config.radius * wg.config.radius;
    const cx = Math.round(px / cell), cz = Math.round(pz / cell);
    const mat = BABYLON.Matrix.Identity();
    const q = new BABYLON.Quaternion();
    const sVec = new BABYLON.Vector3();
    const pVec = new BABYLON.Vector3();
    let i = 0;
    for (let gz = cz - n; gz <= cz + n && i < cap; gz++) {
      for (let gx = cx - n; gx <= cx + n && i < cap; gx++) {
        const h1 = hash2(gx, gz);
        if (h1 < keep) continue;
        const wx = gx * cell + (hash2(gx * 1.3, gz * 0.7) - 0.5) * cell * 0.95;
        const wz = gz * cell + (hash2(gx * 0.7, gz * 1.3) - 0.5) * cell * 0.95;
        const dx = wx - px, dz = wz - pz;
        if (dx * dx + dz * dz > R2) continue;
        if (wx * wx + wz * wz > worldR2) continue;
        const bi = wg.biomeAt(wx, wz);
        if (bi.grass <= 0 || hash2(gx + 3, gz + 9) > bi.grass) continue;
        if (wg.trailDirtAt(wx, wz) > 0.22) continue;
        if (wg.lakeWaterDepthAt(wx, wz) > 0.02) continue;
        if (wg.lakeShoreAt(wx, wz) > 0.4) continue; // bare beach sand strip
        if (wg.inForest(wx, wz)) continue; // forest floor has its own brush
        const sc = 0.7 + hash2(gx + 5, gz - 3) * 0.95;
        BABYLON.Quaternion.FromEulerAnglesToRef(0, h1 * 6.28, 0, q);
        sVec.set(sc, sc * (0.8 + hash2(gx, gz + 2) * 0.7), sc);
        pVec.set(wx, wg.surfaceY(wx, wz), wz);
        BABYLON.Matrix.ComposeToRef(sVec, q, pVec, mat);
        mats.set(mat.m, i * 16);
        const tnt = hash2(gx + 7, gz + 11);
        const gc = bi.grassCol;
        cols[i * 4]     = gc[0] + 0.10 * tnt;
        cols[i * 4 + 1] = gc[1] + 0.14 * tnt;
        cols[i * 4 + 2] = gc[2] + 0.05 * tnt;
        // alpha = clump-texture variant (left/right atlas half), not opacity
        cols[i * 4 + 3] = hash2(gx + 13, gz + 17) > 0.5 ? 1 : 0;
        i++;
      }
    }
    return i;
  }

  _rebuild(px, pz) {
    const i = this._scatter(px, pz, CELL, RADIUS, 0.16, this._mats, this._cols, this.cap);
    this.mesh.thinInstanceSetBuffer('matrix', this._mats.subarray(0, Math.max(1, i) * 16), 16, false);
    this.mesh.thinInstanceSetBuffer('color', this._cols.subarray(0, Math.max(1, i) * 4), 4, false);
    this.mesh.thinInstanceCount = i;

    // Hero clumps: sparser grid, tighter ring, higher keep threshold.
    const h = this._scatter(px, pz, HERO_CELL, HERO_RADIUS, 0.35,
                            this._heroMats, this._heroCols, this.heroCap);
    this.heroMesh.thinInstanceSetBuffer('matrix', this._heroMats.subarray(0, Math.max(1, h) * 16), 16, false);
    this.heroMesh.thinInstanceSetBuffer('color', this._heroCols.subarray(0, Math.max(1, h) * 4), 4, false);
    this.heroMesh.thinInstanceCount = h;

    this.lastX = px;
    this.lastZ = pz;
  }

  dispose() {
    if (this._observer) this.scene.onBeforeRenderObservable.remove(this._observer);
    this.mesh?.dispose();
    this.heroMesh?.dispose();
    this.material?.dispose();
    this.heroMaterial?.dispose();
    this._cardTex?.dispose();
  }
}
