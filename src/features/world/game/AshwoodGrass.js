/**
 * AshwoodGrass — wind-animated instanced grass that follows the player.
 *
 * Port of the prototype's buildGrass/rebuildGrass/updateGrass (lines
 * ~747-841): a deterministic hash2 cell grid (cell 0.6 m, radius 30 m)
 * rebuilt whenever the player crosses a cell, rendered as thin instances of
 * a crossed-blade template with a vertex-shader wind sway. One draw call.
 *
 * Placement is pure hash2 math — identical on every client, no manifest.
 */

/* global BABYLON */

import { hash2 } from '../worldgen/index.js';

const CELL = 0.6;
const RADIUS = 30;

const VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec4 color;
#include<instancesDeclaration>
uniform mat4 viewProjection;
uniform float uTime;
uniform float uWind;
varying vec4 vCol;
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

  // Vertical AO: darken the base (ground contact), brighten the tip — reads
  // as ambient occlusion for one extra multiply, no extra draw/pass.
  float ao = mix(0.55, 1.15, clamp(position.y / 0.55, 0.0, 1.0));
  vCol = vec4(color.rgb * ao, color.a);

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
varying vec3 vWp;
varying vec3 vN;
uniform float uLight;
uniform vec3 cameraPosition;
uniform vec3 vFogColor;
uniform float fogDensity;
uniform vec3 uSunDir;        // world-space direction toward the sun
uniform float uBackStrength; // 0 on low/mobile tier, >0 on high tier
void main() {
  vec3 N = normalize(vN);
  vec3 L = normalize(uSunDir);
  float ndl = dot(N, L);
  // Wrapped diffuse: lets blades catch light even when N faces mostly away
  // from the sun — real grass never reads as flat-shaded/fully unlit.
  float wrap = clamp((ndl + 0.5) / 1.5, 0.0, 1.0);
  float lambert = mix(0.55, 1.0, wrap);

  vec3 V = normalize(cameraPosition - vWp);
  // Translucency / backlight: blades glow when the sun sits behind them from
  // the camera's viewpoint — the "glowing grass" look at golden hour. Zero
  // on low/mobile tier (uBackStrength), so this is a free no-op there.
  float back = pow(clamp(dot(-V, L), 0.0, 1.0), 2.0) * uBackStrength;

  vec3 c = vCol.rgb * uLight * lambert + vCol.rgb * back;
  float dist = length(cameraPosition - vWp);
  float fog = exp(-pow(dist * fogDensity, 2.0));
  c = mix(vFogColor, c, clamp(fog, 0.0, 1.0));
  gl_FragColor = vec4(c, 1.0);
}
`;

// Crossed pair of three-triangle blade fans (prototype buildGrass), with the
// per-vertex shade ramp baked into the instance-color multiplier instead.
function bladeGeometry() {
  const w = 0.06, hh = 0.55, d = 0.13;
  const blade = [
    -w, 0, 0,  w, 0, 0,  -w * 0.6, hh * 0.5, d,
    -w * 0.6, hh * 0.5, d,  w, 0, 0,  w * 0.6, hh * 0.5, d,
    -w * 0.6, hh * 0.5, d,  w * 0.6, hh * 0.5, d,  0, hh, d * 1.5,
  ];
  const positions = [];
  const ROT = 1.36, ca = Math.cos(ROT), sa = Math.sin(ROT), ys = 0.88;
  for (let i = 0; i < blade.length; i += 3) positions.push(blade[i], blade[i + 1], blade[i + 2]);
  for (let i = 0; i < blade.length; i += 3) {
    const x = blade[i], y = blade[i + 1], z = blade[i + 2];
    positions.push(x * ca - z * sa + 0.03, y * ys, x * sa + z * ca - 0.02);
  }
  const indices = [];
  for (let i = 0; i < positions.length / 3; i++) indices.push(i);

  // Flat per-triangle normals (cross of two edges). No vertices are shared
  // between triangles here, so each triangle's 3 unique vertices simply take
  // that triangle's face normal — real geometric lighting for the blade with
  // no averaging pass needed.
  const normals = new Array(positions.length).fill(0);
  for (let t = 0; t < indices.length; t += 3) {
    const i0 = indices[t] * 3, i1 = indices[t + 1] * 3, i2 = indices[t + 2] * 3;
    const ax = positions[i0], ay = positions[i0 + 1], az = positions[i0 + 2];
    const bx = positions[i1], by = positions[i1 + 1], bz = positions[i1 + 2];
    const cx = positions[i2], cy = positions[i2 + 1], cz = positions[i2 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (const idx of [i0, i1, i2]) { normals[idx] = nx; normals[idx + 1] = ny; normals[idx + 2] = nz; }
  }
  return { positions, indices, normals };
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

    this.material = new BABYLON.ShaderMaterial('ashwoodGrassMat', scene, 'ashwoodGrass', {
      // world0-3 MUST be declared for (thin) instancing — without them the
      // instancesVertex include reads unbound attributes and instance
      // matrices come out as garbage (blades stretched across the sky).
      attributes: ['position', 'normal', 'color', 'world0', 'world1', 'world2', 'world3'],
      uniforms: ['viewProjection', 'world', 'cameraPosition',
                 'uTime', 'uWind', 'uLight', 'vFogColor', 'fogDensity',
                 'uSunDir', 'uBackStrength'],
    });
    this.material.backFaceCulling = false;

    const { positions, indices, normals } = bladeGeometry();
    this.mesh = new BABYLON.Mesh('ashwoodGrass', scene);
    const vd = new BABYLON.VertexData();
    vd.positions = positions;
    vd.indices = indices;
    vd.normals = normals;
    vd.applyToMesh(this.mesh);
    this.mesh.material = this.material;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true; // skip culling: it surrounds the camera

    const n = Math.ceil(RADIUS / CELL);
    this.cap = (2 * n + 1) * (2 * n + 1);
    this._mats = new Float32Array(this.cap * 16);
    this._cols = new Float32Array(this.cap * 4);

    this._observer = scene.onBeforeRenderObservable.add(() => this._update());
  }

  _update() {
    const p = this.getPlayerPos?.();
    if (!p) return;
    this.time += this.scene.getEngine().getDeltaTime() / 1000;
    const m = this.material;
    m.setFloat('uTime', this.time);
    // storm-swept blades: the weather system publishes wind strength
    const wind = this.scene.metadata?.ashwood?.weather?.windStrength ?? 1;
    m.setFloat('uWind', Math.max(0.2, Math.min(3, wind)));
    const lm = this.scene.metadata?.ashwood?.lm;
    m.setFloat('uLight', 0.35 + 0.65 * (lm?.dayFactor ?? 1));
    m.setColor3('vFogColor', this.scene.fogColor);
    m.setFloat('fogDensity', this.scene.fogDensity);

    if (lm?.key) {
      this._sunDir.copyFrom(lm.key.direction).scaleInPlace(-1);
      this._sunDir.normalize();
    }
    m.setVector3('uSunDir', this._sunDir);
    // High tier only — cheap to always set, the shader multiplies by 0 on
    // low/mobile so the term is a free no-op there.
    const tier = this.scene.metadata?.ashwood?.qualityTier;
    m.setFloat('uBackStrength', tier === 'high' ? 0.5 : 0.0);
    if (Math.abs(p.x - this.lastX) + Math.abs(p.z - this.lastZ) > CELL) this._rebuild(p.x, p.z);
  }

  _rebuild(px, pz) {
    const wg = this.wg;
    const n = Math.ceil(RADIUS / CELL);
    const R2 = RADIUS * RADIUS;
    const worldR2 = wg.config.radius * wg.config.radius;
    const cx = Math.round(px / CELL), cz = Math.round(pz / CELL);
    const mat = BABYLON.Matrix.Identity();
    const q = new BABYLON.Quaternion();
    const sVec = new BABYLON.Vector3();
    const pVec = new BABYLON.Vector3();
    let i = 0;
    for (let gz = cz - n; gz <= cz + n && i < this.cap; gz++) {
      for (let gx = cx - n; gx <= cx + n && i < this.cap; gx++) {
        const h1 = hash2(gx, gz);
        if (h1 < 0.16) continue;
        const wx = gx * CELL + (hash2(gx * 1.3, gz * 0.7) - 0.5) * CELL * 0.95;
        const wz = gz * CELL + (hash2(gx * 0.7, gz * 1.3) - 0.5) * CELL * 0.95;
        const dx = wx - px, dz = wz - pz;
        if (dx * dx + dz * dz > R2) continue;
        if (wx * wx + wz * wz > worldR2) continue;
        const bi = wg.biomeAt(wx, wz);
        if (bi.grass <= 0 || hash2(gx + 3, gz + 9) > bi.grass) continue;
        if (wg.trailDirtAt(wx, wz) > 0.22) continue;
        if (wg.lakeWaterDepthAt(wx, wz) > 0.02) continue;
        if (wg.lakeShoreAt(wx, wz) > 0.4) continue; // bare beach sand strip
        if (wg.inForest(wx, wz)) continue; // forest floor has its own brush
        if (wg.inSettlement?.(wx, wz)) continue; // village plate has its own lawns
        const sc = 0.7 + hash2(gx + 5, gz - 3) * 0.95;
        BABYLON.Quaternion.FromEulerAnglesToRef(0, h1 * 6.28, 0, q);
        sVec.set(sc, sc * (0.8 + hash2(gx, gz + 2) * 0.7), sc);
        pVec.set(wx, wg.surfaceY(wx, wz), wz);
        BABYLON.Matrix.ComposeToRef(sVec, q, pVec, mat);
        this._mats.set(mat.m, i * 16);
        const tnt = hash2(gx + 7, gz + 11);
        const gc = bi.grassCol;
        this._cols[i * 4]     = gc[0] + 0.10 * tnt;
        this._cols[i * 4 + 1] = gc[1] + 0.14 * tnt;
        this._cols[i * 4 + 2] = gc[2] + 0.05 * tnt;
        this._cols[i * 4 + 3] = 1;
        i++;
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
