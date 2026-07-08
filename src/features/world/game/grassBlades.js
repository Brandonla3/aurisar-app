/**
 * grassBlades — shared procedural blade-cluster geometry + material for every
 * grass layer (the player-following field in AshwoodGrass and the per-tile
 * tuft/fern understory in ashwoodPropMeshes).
 *
 * A cluster is a fan of vertical quad strips (a "tuft"), colored by a root→tip
 * ramp from the per-instance tint — no texture, no alpha cutout. Wind is a
 * circular-arc rooted bend applied in world space: the root is pinned (bend
 * angle is 0 at the blade base) while the tip rides a preserved-length arc,
 * driven by travelling gust fronts plus a per-blade chop and tip flutter.
 *
 * All materials created here register with a single per-scene uniform pump so
 * the field and the understory sway with identical wind and light.
 */

/* global BABYLON */

// ── geometry ────────────────────────────────────────────────────────────────

/**
 * Authored multi-plane blade cluster.
 * @param {object} o { planes, segments, height, width, lean }
 * @returns {{positions:number[], indices:number[], normals:number[], uvs:number[], maxH:number}}
 */
export function buildBladeClusterVertexData(o = {}) {
  const planes = o.planes ?? 4;
  const segments = o.segments ?? 5;
  const height = o.height ?? 0.7;
  const width = o.width ?? 0.09;
  const lean = o.lean ?? 0.16;

  const positions = [];
  const indices = [];
  const normals = [];
  const uvs = [];
  let vbase = 0;

  // Each plane is a near-rectangular textured "card" (the alpha-cutout grass
  // texture supplies the fine blade silhouette); the fan of cards gives the
  // tuft real 3D volume. This is the combination of the old flat textured
  // cards (realistic in bulk) with the newer cluster geometry (thickness).
  for (let pl = 0; pl < planes; pl++) {
    // Spread planes across the half-circle but nudge each by a per-plane offset
    // so they don't all pass through one axis (reads fuller from every angle).
    const ang = (pl + 0.5) / planes * Math.PI;
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const wx = ca, wz = -sa;            // card width axis (horizontal)
    const lx = sa, lz = ca;            // lean axis (card faces this way)
    let nx = sa, ny = 0.34, nz = ca;   // Y-biased normal → soft tuft lighting
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl; ny /= nl; nz /= nl;

    // Alternate which half of the 2-variant atlas each card samples, so a
    // single tuft shows both clump variants.
    const u0 = (pl % 2) * 0.5, u1 = u0 + 0.5;

    const rowStart = vbase;
    for (let s = 0; s <= segments; s++) {
      const t = s / segments;
      // Near-full width with only a slight top taper — the texture (not the
      // geometry) defines the blades, so the card stays card-like.
      const hw = width * (0.82 + 0.18 * (1 - t));
      const y = t * height;
      const z = Math.pow(t, 1.8) * lean;  // gentle forward lean toward the tip
      const cx = lx * z, cz = lz * z;
      positions.push(cx - wx * hw, y, cz - wz * hw);
      positions.push(cx + wx * hw, y, cz + wz * hw);
      normals.push(nx, ny, nz, nx, ny, nz);
      // v starts above the texture's dark dirt rows; v=1 is the alpha-cutout
      // tips. u spans one atlas half.
      const vt = 0.08 + t * 0.92;
      uvs.push(u0, vt, u1, vt);
    }
    for (let s = 0; s < segments; s++) {
      const a = rowStart + s * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    vbase += (segments + 1) * 2;
  }

  return { positions, indices, normals, uvs, maxH: height };
}

// ── shaders ─────────────────────────────────────────────────────────────────

const VERT = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
#include<instancesDeclaration>
// Thin-instance color binds to the auto-declared 'instanceColor' (rgb = tint,
// a = per-blade seed), NOT 'color'; declare it when the buffer isn't present.
#ifndef INSTANCESCOLOR
attribute vec4 instanceColor;
#endif
uniform mat4 viewProjection;
uniform float uTime;
uniform float uWind;
uniform float uWindSpeed;
uniform float uGustScale;
uniform float uMaxH;
uniform vec2 uWindDir;
varying float vBladeT;
varying float vWind;
varying vec2 vUV;
varying vec3 vTint;
varying vec3 vN;
varying vec3 vWp;
void main() {
  #include<instancesVertex>
  vec4 wp = finalWorld * vec4(position, 1.0);
  vec2 aOrigin = vec2(finalWorld[3].x, finalWorld[3].z);
  float bladeT = clamp(position.y / uMaxH, 0.0, 1.0);
  float seed = instanceColor.a;

  vec2 windDir = normalize(uWindDir);
  vec2 sideDir = vec2(-windDir.y, windDir.x);
  float along = dot(aOrigin, windDir);            // position along wind => fronts
  float jitter = fract(sin(dot(aOrigin, vec2(12.9898, 78.233))) * 43758.5453);
  float gust = pow(sin(along * uGustScale - uTime * uWindSpeed * 0.6 + jitter * 6.2831) * 0.5 + 0.5, 1.6);
  float chop = sin(along * uGustScale * 2.7 - uTime * uWindSpeed * 1.3 + seed * 6.2831) * 0.5 + 0.5;
  float ampVar = 0.65 + fract(seed * 7.0) * 0.7;
  float phi = clamp(uWind * (0.25 + gust * 0.85 + chop * 0.18) * ampVar * 0.9, 0.0, 1.45);

  // Circular-arc rooted bend: root pinned (a = 0 at bladeT 0), tip rides an
  // arc of preserved length so the blade folds instead of stretching.
  float yScale = length(vec3(finalWorld[1].x, finalWorld[1].y, finalWorld[1].z));
  float worldH = uMaxH * yScale;
  float a = phi * pow(bladeT, 1.5);
  float radius = worldH / max(phi, 1e-3);
  float arc = radius * (1.0 - cos(a));                 // horizontal, along wind
  float drop = radius * sin(a) - position.y * yScale;  // swap straight height for arc height
  float flutter = sin(uTime * 10.0 + seed * 18.0 + along * 0.8) * 0.05 * smoothstep(0.55, 1.0, bladeT);

  wp.x += windDir.x * arc + sideDir.x * flutter;
  wp.z += windDir.y * arc + sideDir.y * flutter;
  wp.y += drop;

  vWp = wp.xyz;
  vBladeT = bladeT;
  vWind = clamp(gust * 0.75 + chop * 0.25, 0.0, 1.0);
  vUV = uv;
  vTint = instanceColor.rgb;
  vN = normalize(mat3(finalWorld) * normal);
  gl_Position = viewProjection * wp;
}
`;

const FRAG = `
precision highp float;
varying float vBladeT;
varying float vWind;
varying vec2 vUV;
varying vec3 vTint;
varying vec3 vN;
varying vec3 vWp;
uniform sampler2D uCardTex;
uniform float uLight;
uniform float uBackStrength;   // 0 on low/mobile, >0 on high tier
uniform float fogDensity;
uniform float uDebugMode;      // 0 final, 1 height, 2 tex, 3 wind
uniform vec3 uSunDir;
uniform vec3 vFogColor;
uniform vec3 cameraPosition;
void main() {
  // Alpha-cutout the photographic grass texture — this is where the fine,
  // realistic blade detail comes from. Opaque grass below the alpha line,
  // discarded (transparent sky) above it. No blending/sorting: one draw call.
  vec4 tex = texture2D(uCardTex, vUV);
  if (tex.a < 0.5) discard;

  vec3 N = normalize(vN);
  vec3 L = normalize(uSunDir);
  vec3 V = normalize(cameraPosition - vWp);

  // The texture carries the color; the biome tint (instanceColor.rgb) only
  // nudges the hue at 35% strength — full-strength tinting reads neon. A gentle
  // vertical AO darkens the roots and lifts the tips.
  vec3 tint = mix(vec3(1.0), clamp(vTint * 2.2, 0.0, 1.6), 0.35);
  float ao = mix(0.7, 1.1, vBladeT);
  vec3 base = tex.rgb * tint * ao;

  // Wrapped diffuse so blades never read fully unlit when facing away.
  float wrap = clamp((dot(N, L) + 0.5) / 1.5, 0.0, 1.0);
  float lambert = mix(0.6, 1.0, wrap);
  // Translucency: thin tips glow when backlit (tier-gated, free no-op on low).
  float back = pow(clamp(dot(-V, L), 0.0, 1.0), 2.0) * uBackStrength * pow(vBladeT, 1.5);

  vec3 c = base * uLight * lambert + base * back;
  float dist = length(cameraPosition - vWp);
  float fog = exp(-pow(dist * fogDensity, 2.0));
  c = mix(vFogColor, c, clamp(fog, 0.0, 1.0));

  if (uDebugMode > 0.5) {
    if (uDebugMode < 1.5) c = vec3(vBladeT);
    else if (uDebugMode < 2.5) c = tex.rgb;
    else c = vec3(vWind, 1.0 - vWind, 0.25);
  }
  gl_FragColor = vec4(c, 1.0);
}
`;

// ── per-scene uniform pump ───────────────────────────────────────────────────

const _pumps = new WeakMap(); // scene -> { mats:Set, time:number, obs }

// Lazily-created shared scratch vectors. NOT constructed at module scope: this
// module can be evaluated (via the static import chain) before window.BABYLON
// is assigned, so any top-level `new BABYLON.*` would throw ReferenceError and
// white-screen the world. Every BABYLON access here happens at runtime instead.
function _ensureVecs() {
  if (!_windDir) _windDir = new BABYLON.Vector2(0.8, 0.6);
  if (!_sun) _sun = new BABYLON.Vector3(0, 1, 0);
}

function _tick(scene, e) {
  _ensureVecs();
  e.time += scene.getEngine().getDeltaTime() / 1000;
  const md = scene.metadata?.ashwood;
  const wind = Math.max(0.2, Math.min(3, md?.weather?.windStrength ?? 1));
  const lm = md?.lm;
  const back = md?.qualityTier === 'high' ? 0.25 : 0.0;
  const light = 0.35 + 0.65 * (lm?.dayFactor ?? 1);
  // A single coherent wind direction shared by every blade, drifting slowly so
  // gust fronts sweep the whole field the same way (weather only gives strength).
  const ang = 0.7 + Math.sin(e.time * 0.04) * 0.25;
  _windDir.set(Math.cos(ang), Math.sin(ang));
  if (lm?.key) {
    _sun.copyFrom(lm.key.direction).scaleInPlace(-1).normalize();
  } else {
    _sun.set(0, 1, 0);
  }
  const fog = scene.fogColor, fd = scene.fogDensity;
  for (const m of e.mats) {
    m.setFloat('uTime', e.time);
    m.setFloat('uWind', wind);
    m.setVector2('uWindDir', _windDir);
    m.setFloat('uLight', light);
    m.setFloat('uBackStrength', back);
    m.setVector3('uSunDir', _sun);
    m.setColor3('vFogColor', fog);
    m.setFloat('fogDensity', fd);
  }
}

let _windDir = null;
let _sun = null;

// Shared alpha-cutout grass texture (2 clump variants side by side), one per
// scene so the field + understory materials reuse the same GPU texture.
const _texCache = new WeakMap();
function _grassTexture(scene) {
  let t = _texCache.get(scene);
  if (!t) {
    t = new BABYLON.Texture('/assets/textures/grass-cards.png', scene);
    t.anisotropicFilteringLevel = 4;
    t.wrapU = BABYLON.Texture.CLAMP_ADDRESSMODE;
    t.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
    _texCache.set(scene, t);
  }
  return t;
}

function _ensurePump(scene) {
  let e = _pumps.get(scene);
  if (!e) {
    e = { mats: new Set(), time: 0, obs: null };
    e.obs = scene.onBeforeRenderObservable.add(() => _tick(scene, e));
    _pumps.set(scene, e);
  }
  return e;
}

/** Register a grass material so the shared pump drives its wind/light uniforms. */
export function registerGrassMaterial(scene, mat) {
  const e = _ensurePump(scene);
  e.mats.add(mat);
  mat.onDisposeObservable.add(() => e.mats.delete(mat));
}

/**
 * Build a grass blade ShaderMaterial. maxH must match the geometry's height so
 * the wind bladeT normalizes correctly. Registers with the per-scene pump.
 */
export function createGrassMaterial(scene, opts = {}) {
  const maxH = opts.maxH ?? 0.7;
  const name = opts.name ?? 'grassBladeMat';
  BABYLON.Effect.ShadersStore['grassBladeVertexShader'] = VERT;
  BABYLON.Effect.ShadersStore['grassBladeFragmentShader'] = FRAG;
  const mat = new BABYLON.ShaderMaterial(name, scene, 'grassBlade', {
    // world0-3 MUST be declared for thin instancing or the instancesVertex
    // include reads unbound attributes (blades stretch across the sky).
    attributes: ['position', 'normal', 'uv', 'instanceColor', 'world0', 'world1', 'world2', 'world3'],
    uniforms: ['viewProjection', 'world', 'cameraPosition',
               'uTime', 'uWind', 'uWindDir', 'uWindSpeed', 'uGustScale', 'uMaxH',
               'uLight', 'uSunDir', 'uBackStrength', 'vFogColor', 'fogDensity', 'uDebugMode'],
    samplers: ['uCardTex'],
  });
  mat.backFaceCulling = false;
  mat.setTexture('uCardTex', _grassTexture(scene));
  mat.setFloat('uMaxH', maxH);
  mat.setFloat('uWindSpeed', 1.0);
  mat.setFloat('uGustScale', 0.12);
  mat.setFloat('uDebugMode', 0);
  _ensureVecs();
  mat.setVector2('uWindDir', _windDir);
  registerGrassMaterial(scene, mat);
  return mat;
}
