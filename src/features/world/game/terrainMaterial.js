/* global BABYLON */

/**
 * Cinematic splat-blended PBR terrain.
 *
 * terrainSplat is a vec4 vertex attribute containing dirt, sand/gravel, rock,
 * and field/organic-cover weights. The shader adds slope-aware rock, coupled
 * procedural albedo/relief, macro breakup, distance-faded detail normals and
 * environment-specific material identities.
 */

const TERRAIN_TIERS = {
  high:   { oct: 6, detail: 0.95, heightBlend: true,  detailNormal: true,  triplanar: true,  flowers: true  },
  low:    { oct: 4, detail: 0.72, heightBlend: true,  detailNormal: true,  triplanar: false, flowers: false },
  mobile: { oct: 3, detail: 0.0,  heightBlend: false, detailNormal: false, triplanar: false, flowers: false },
};

/**
 * Presets are deliberately numeric in the shader so one implementation can be
 * reused by overworld tiles, mountains, forests, castle courtyards and dungeon
 * floors without cloning shader code.
 */
export const TERRAIN_PRESETS = Object.freeze({
  overworld: 0,
  mountain: 1,
  forest: 2,
  castle: 3,
  dungeon: 4,
});

const PRESET_DEFAULTS = Object.freeze({
  overworld: { profile: 0, wetness: 0.08, scale: 1.0, roughness: 0.94, specular: 0.38 },
  mountain:  { profile: 1, wetness: 0.03, scale: 0.82, roughness: 0.91, specular: 0.46 },
  forest:    { profile: 2, wetness: 0.34, scale: 1.12, roughness: 0.97, specular: 0.28 },
  castle:    { profile: 3, wetness: 0.10, scale: 1.32, roughness: 0.89, specular: 0.52 },
  dungeon:   { profile: 4, wetness: 0.62, scale: 1.55, roughness: 0.84, specular: 0.62 },
});

class TerrainSplatPlugin extends BABYLON.MaterialPluginBase {
  constructor(material, tierCfg, presetCfg) {
    super(material, 'AshwoodTerrainSplat', 210, {
      TERR_ENABLED: false,
      TERR_HEIGHTBLEND: false,
      TERR_DETAILNORMAL: false,
      TERR_TRIPLANAR: false,
      TERR_FLOWERS: false,
    });
    this._cfg = tierCfg;
    this._preset = presetCfg;
    this._debug = 0;
    this._enable(true);
  }

  getClassName() { return 'AshwoodTerrainSplatPlugin'; }

  prepareDefines(defines) {
    defines.TERR_ENABLED = true;
    defines.TERR_HEIGHTBLEND = !!this._cfg.heightBlend;
    defines.TERR_DETAILNORMAL = !!this._cfg.detailNormal;
    defines.TERR_TRIPLANAR = !!this._cfg.triplanar;
    defines.TERR_FLOWERS = !!this._cfg.flowers;
  }

  getAttributes(attributes) { attributes.push('terrainSplat'); }

  getUniforms() {
    return {
      ubo: [
        { name: 'uTerrOct', size: 1, type: 'float' },
        { name: 'uTerrDetail', size: 1, type: 'float' },
        { name: 'uTerrDebug', size: 1, type: 'float' },
        { name: 'uTerrProfile', size: 1, type: 'float' },
        { name: 'uTerrWetness', size: 1, type: 'float' },
        { name: 'uTerrScale', size: 1, type: 'float' },
      ],
      fragment: `
uniform float uTerrOct;
uniform float uTerrDetail;
uniform float uTerrDebug;
uniform float uTerrProfile;
uniform float uTerrWetness;
uniform float uTerrScale;
`,
    };
  }

  bindForSubMesh(uniformBuffer) {
    uniformBuffer.updateFloat('uTerrOct', this._cfg.oct);
    uniformBuffer.updateFloat('uTerrDetail', this._cfg.detail);
    uniformBuffer.updateFloat('uTerrDebug', this._debug);
    uniformBuffer.updateFloat('uTerrProfile', this._preset.profile);
    uniformBuffer.updateFloat('uTerrWetness', this._preset.wetness);
    uniformBuffer.updateFloat('uTerrScale', this._preset.scale);
  }

  getCustomCode(shaderType) {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `
attribute vec4 terrainSplat;
varying vec4 vTerrainSplat;
`,
        CUSTOM_VERTEX_MAIN_END: `vTerrainSplat = terrainSplat;`,
      };
    }
    if (shaderType !== 'fragment') return null;

    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `
varying vec4 vTerrainSplat;
const mat2 TERR_R = mat2(0.8, -0.6, 0.6, 0.8);
float terrHash21(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float terrValueNoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(terrHash21(i), terrHash21(i + vec2(1.0, 0.0)), u.x),
             mix(terrHash21(i + vec2(0.0, 1.0)), terrHash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float terrFbm(vec2 p, int oct){
  float h = 0.0, amp = 0.5;
  for (int i = 0; i < 8; i++){
    if (i >= oct) break;
    h += amp * terrValueNoise(p);
    p = TERR_R * p * 2.03;
    amp *= 0.5;
  }
  return h;
}
float terrRidged(vec2 p, int oct){
  float h = 0.0, amp = 0.5;
  for (int i = 0; i < 8; i++){
    if (i >= oct) break;
    float n = terrValueNoise(p);
    h += amp * (1.0 - abs(n * 2.0 - 1.0));
    p = TERR_R * p * 2.03;
    amp *= 0.52;
  }
  return h;
}
#ifdef TERR_TRIPLANAR
float terrTriNoise(vec3 wp, vec3 n, float s, int oct){
  vec3 bw = pow(abs(n), vec3(4.0));
  bw /= max(dot(bw, vec3(1.0)), 0.0001);
  return terrFbm(wp.yz * s, oct) * bw.x + terrFbm(wp.xz * s, oct) * bw.y + terrFbm(wp.xy * s, oct) * bw.z;
}
#endif
#ifdef TERR_FLOWERS
vec2 terrHash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float terrVoronoi(vec2 p, out vec2 cell){
  vec2 g = floor(p), f = fract(p); float d = 8.0; cell = g;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 o = vec2(float(x), float(y));
    vec2 r = o + terrHash22(g + o) - f;
    float dd = dot(r, r);
    if (dd < d){ d = dd; cell = g + o; }
  }
  return sqrt(d);
}
#endif
`,
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: `
#ifdef TERR_ENABLED
{
  vec3 terrWP = vPositionW;
  vec2 terrP = terrWP.xz * uTerrScale;
  int terrOct = int(uTerrOct + 0.5);
  vec4 terrSplat = clamp(vTerrainSplat, 0.0, 1.0);
  float terrSlope = 1.0 - clamp(vNormalW.y, 0.0, 1.0);
  float terrJit = terrValueNoise(terrP * 0.05) - 0.5;
  float terrProfile = floor(uTerrProfile + 0.5);

  float isMountain = step(0.5, terrProfile) * (1.0 - step(1.5, terrProfile));
  float isForest = step(1.5, terrProfile) * (1.0 - step(2.5, terrProfile));
  float isCastle = step(2.5, terrProfile) * (1.0 - step(3.5, terrProfile));
  float isDungeon = step(3.5, terrProfile);

  float hGrass = terrFbm(terrP * 0.85 + 1.7, terrOct) * 0.62 + terrFbm(terrP * 0.20 - 5.3, terrOct) * 0.38;
  float hDirt = terrFbm(terrP * 0.64 + 3.1, terrOct);
  float hRock = terrRidged(terrP * 0.92, terrOct);
#ifdef TERR_TRIPLANAR
  hRock = mix(hRock, terrTriNoise(terrWP, vNormalW, 0.9 * uTerrScale, terrOct), smoothstep(0.38, 0.68, terrSlope));
#endif
  float gravelCell = terrValueNoise(floor(terrP * 5.5));
  float hSand = terrFbm(terrP * 2.7, terrOct) * 0.42 + (sin(dot(terrP, vec2(0.94, 0.34)) * 2.2) * 0.5 + 0.5) * 0.58;
  hSand = mix(hSand, gravelCell, max(isCastle, isDungeon));
  float terrPatch = terrValueNoise(terrP * 0.7);
  float hField = terrPatch * 0.70 + terrFbm(terrP * 2.0 + 7.7, terrOct) * 0.30;

  vec3 grassBase = surfaceAlbedo;
  vec3 aGrass = grassBase * (0.76 + 0.42 * hGrass);
  vec3 aDirt = mix(vec3(0.16, 0.105, 0.055), vec3(0.39, 0.275, 0.15), hDirt);
  vec3 aRock = mix(vec3(0.17, 0.18, 0.18), vec3(0.39, 0.39, 0.37), hRock);
  vec3 aSand = mix(vec3(0.52, 0.43, 0.27), vec3(0.76, 0.65, 0.43), hSand);
  vec3 aField = mix(vec3(0.29, 0.32, 0.12), vec3(0.60, 0.57, 0.25), terrPatch);
  aField = mix(aField, aGrass, 0.28);

  // Forest: dark moist loam, moss and leaf-litter breakup.
  float litter = smoothstep(0.48, 0.78, terrValueNoise(terrP * 3.8 + 19.0));
  aDirt = mix(aDirt, mix(vec3(0.075, 0.055, 0.032), vec3(0.22, 0.16, 0.075), hDirt), isForest);
  aRock = mix(aRock, mix(aRock * 0.62, vec3(0.18, 0.25, 0.12), litter * 0.55), isForest);
  aField = mix(aField, mix(vec3(0.16, 0.20, 0.07), vec3(0.33, 0.25, 0.10), litter), isForest);

  // Mountains: colder fractured stone, scree and sparse muted vegetation.
  aRock = mix(aRock, mix(vec3(0.16, 0.18, 0.21), vec3(0.48, 0.49, 0.48), hRock), isMountain);
  aDirt = mix(aDirt, mix(vec3(0.17, 0.14, 0.11), vec3(0.35, 0.29, 0.21), hDirt), isMountain);
  aGrass = mix(aGrass, aGrass * vec3(0.76, 0.82, 0.68), isMountain);

  // Castle: compacted earth plus pale crushed gravel and worn masonry fines.
  vec3 castleGravel = mix(vec3(0.26, 0.25, 0.22), vec3(0.63, 0.59, 0.49), gravelCell);
  aSand = mix(aSand, castleGravel, isCastle);
  aDirt = mix(aDirt, mix(vec3(0.18, 0.135, 0.09), vec3(0.42, 0.34, 0.23), hDirt), isCastle);
  aRock = mix(aRock, mix(vec3(0.24, 0.25, 0.25), vec3(0.52, 0.51, 0.47), hRock), isCastle);

  // Dungeon: near-black wet stone, mineral staining and irregular rubble.
  float mineral = terrFbm(terrP * 0.36 + 31.0, terrOct);
  vec3 dungeonRock = mix(vec3(0.055, 0.065, 0.065), vec3(0.24, 0.27, 0.25), hRock);
  dungeonRock = mix(dungeonRock, vec3(0.16, 0.20, 0.13), smoothstep(0.62, 0.84, mineral) * 0.38);
  aRock = mix(aRock, dungeonRock, isDungeon);
  aDirt = mix(aDirt, mix(vec3(0.045, 0.032, 0.022), vec3(0.16, 0.11, 0.065), hDirt), isDungeon);
  aSand = mix(aSand, mix(vec3(0.09, 0.095, 0.09), vec3(0.31, 0.30, 0.27), gravelCell), isDungeon);

#ifdef TERR_FLOWERS
  vec2 terrCell; float terrF1 = terrVoronoi(terrP * 5.5, terrCell);
  float terrFlower = smoothstep(0.16, 0.04, terrF1) * step(0.64, terrHash21(terrCell));
  terrFlower *= (1.0 - max(max(isMountain, isCastle), isDungeon));
  aField = mix(aField, vec3(0.90, 0.84, 0.40), terrFlower * 0.62);
#endif

  float wRock = max(terrSplat.z, smoothstep(0.32, 0.60, terrSlope + abs(terrJit) * 0.15));
  float wGrass = 1.0;
  float wDirt = terrSplat.x * 1.72;
  float wSand = terrSplat.y * 1.90;
  float wRockW = wRock * 1.82;
  float wField = terrSplat.w * 1.24;

  wRockW += isMountain * (0.52 + terrSlope * 0.95);
  wDirt += isForest * 0.40;
  wField += isForest * 0.24;
  wSand += isCastle * 0.78;
  wDirt += isCastle * 0.34;
  wRockW += isDungeon * 0.92;
  wSand += isDungeon * 0.46;
  wGrass *= 1.0 - isMountain * 0.46 - isCastle * 0.86 - isDungeon * 0.98;
  wField *= 1.0 - isCastle * 0.86 - isDungeon;

#ifdef TERR_HEIGHTBLEND
  float depth = mix(0.22, 0.16, max(isCastle, isDungeon));
  float s0 = wGrass + hGrass, s1 = wDirt + hDirt, s2 = wRockW + hRock, s3 = wSand + hSand, s4 = wField + hField;
  float m = max(max(max(s0, s1), max(s2, s3)), s4) - depth;
  float b0 = max(s0 - m, 0.0), b1 = max(s1 - m, 0.0), b2 = max(s2 - m, 0.0), b3 = max(s3 - m, 0.0), b4 = max(s4 - m, 0.0);
#else
  float b0 = wGrass, b1 = wDirt, b2 = wRockW, b3 = wSand, b4 = wField;
#endif
  float sum = b0 + b1 + b2 + b3 + b4 + 0.00001;
  b0 /= sum; b1 /= sum; b2 /= sum; b3 /= sum; b4 /= sum;

  vec3 terrAlb = b0 * aGrass + b1 * aDirt + b2 * aRock + b3 * aSand + b4 * aField;
  terrAlb *= 1.0 + (terrValueNoise(terrP * 0.11) - 0.5) * 0.30;

  float pore = terrValueNoise(terrP * 7.0 + 47.0);
  float wetMask = clamp(uTerrWetness * (0.34 + 0.66 * mineral) * (0.55 + 0.45 * pore), 0.0, 0.88);
  terrAlb *= 1.0 - wetMask * 0.38;

#ifdef TERR_DETAILNORMAL
  float terrH = b0 * hGrass + b1 * hDirt + b2 * hRock * 1.45 + b3 * hSand * 0.78 + b4 * hField;
  terrH += max(isCastle, isDungeon) * gravelCell * 0.22;
  vec3 dpx = dFdx(terrWP), dpy = dFdy(terrWP);
  vec3 r1 = cross(dpy, normalW), r2 = cross(normalW, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (dFdx(terrH) * r1 + dFdy(terrH) * r2);
  float camDist = length(vEyePosition.xyz - terrWP);
  float strength = uTerrDetail * (1.0 - smoothstep(13.0, 64.0, camDist));
  strength *= mix(0.62, 1.12, max(max(isMountain, isCastle), isDungeon));
  normalW = normalize(abs(det) * normalW - grad * strength);
#endif

  surfaceAlbedo = terrAlb;
  if (uTerrDebug > 0.5) {
    if (uTerrDebug < 1.5) surfaceAlbedo = vec3(b1, b2, b3);
    else if (uTerrDebug < 2.5) surfaceAlbedo = vec3(b4, b0, wetMask);
    else if (uTerrDebug < 3.5) surfaceAlbedo = vec3(terrSlope);
    else surfaceAlbedo = vec3(isMountain, isForest + isDungeon * 0.5, isCastle + isDungeon);
  }
}
#endif
`,
    };
  }
}

/**
 * Create a cinematic terrain material.
 *
 * @param {BABYLON.Scene} scene
 * @param {{tier?:'high'|'low'|'mobile', preset?:keyof typeof TERRAIN_PRESETS,
 *   wetness?:number, scale?:number}} opts
 */
export function createTerrainMaterial(scene, opts = {}) {
  const tier = opts.tier ?? scene.metadata?.ashwood?.qualityTier ?? 'high';
  const tierCfg = TERRAIN_TIERS[tier] ?? TERRAIN_TIERS.high;
  const presetName = Object.prototype.hasOwnProperty.call(PRESET_DEFAULTS, opts.preset)
    ? opts.preset : 'overworld';
  const presetCfg = {
    ...PRESET_DEFAULTS[presetName],
    wetness: opts.wetness ?? PRESET_DEFAULTS[presetName].wetness,
    scale: opts.scale ?? PRESET_DEFAULTS[presetName].scale,
  };

  const mat = new BABYLON.PBRMaterial(`ashwood_ground_${presetName}`, scene);
  mat.metallic = 0;
  mat.roughness = presetCfg.roughness;
  mat.specularIntensity = presetCfg.specular;
  mat.enableSpecularAntiAliasing = true;
  mat._terrainPreset = presetName;
  mat._terrainPlugin = new TerrainSplatPlugin(mat, tierCfg, presetCfg);
  return mat;
}

/** Build all environment identities once for scene-level reuse. */
export function createTerrainMaterialSet(scene, opts = {}) {
  return Object.fromEntries(Object.keys(TERRAIN_PRESETS).map((preset) => [
    preset,
    createTerrainMaterial(scene, { ...opts, preset }),
  ]));
}

/** QA hook: 0 final, 1 dirt/rock/gravel, 2 field/grass/wetness, 3 slope, 4 profile. */
export function setTerrainDebugMode(material, mode) {
  if (material?._terrainPlugin) {
    material._terrainPlugin._debug = mode;
    material.markDirty();
  }
}
