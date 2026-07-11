/**
 * terrainMaterial — splat-blended PBR ground for the streamed Ashwood terrain.
 *
 * The overworld used to be a single grass texture tinted per-vertex by biome
 * colour, so every surface (trails, lakebed, highlands) read as "grass with a
 * colour wash". This replaces that with real, distinct ground materials —
 * grass, DIRT, ROCK, SAND and dry/wildflower FIELD — blended per fragment by
 * per-vertex splat weights (baked from the worldgen fields in the tile
 * provider) plus in-shader slope.
 *
 * It is implemented as a BABYLON.MaterialPluginBase on a normal PBRMaterial, so
 * the terrain keeps all of Babylon's lighting: the directional key light,
 * cascaded shadows, IBL reflections, EXP2 fog and the day/night grade all apply
 * automatically. The plugin only overrides the albedo (and perturbs the normal
 * for procedural relief) inside CUSTOM_FRAGMENT_BEFORE_LIGHTS — which runs
 * after the biome vertex-colour multiply and before the light loop.
 *
 * All five surfaces — grass, DIRT, ROCK, SAND, dry/wildflower FIELD — are
 * fully procedural (value-noise FBM + ridged strata): no ground textures ship
 * at all. Albedo, relief height and the detail normal for each surface derive
 * from the SAME noise cause (the coupling rule from the procedural-materials
 * skill), so nothing here can read as a static repeating photo — grass is no
 * exception, built from the per-vertex biome tint plus its own clump/macro
 * noise instead of a tiled image (the old grass-meshy.jpg, removed: a single
 * fixed photo repeating on a grid always reads as an obviously pasted-down
 * static image once more than a couple of repeats are on screen).
 *
 * Determinism: every field is a pure function of world (x,z)/normal, identical
 * on every client and seam-free across tile borders (same math both sides of an
 * edge), so nothing here can desync multiplayer.
 */

/* global BABYLON */

// Per-tier shader budget. `oct` caps the FBM/ridged octave loop (a single knob,
// read as a uniform so no shader recompile per tier). The booleans compile
// whole feature blocks in/out via #defines.
const TERRAIN_TIERS = {
  high:   { oct: 6, detail: 0.95, heightBlend: true,  detailNormal: true,  triplanar: true,  flowers: true  },
  low:    { oct: 4, detail: 0.75, heightBlend: true,  detailNormal: true,  triplanar: false, flowers: false },
  mobile: { oct: 3, detail: 0.0,  heightBlend: false, detailNormal: false, triplanar: false, flowers: false },
};

// ── the plugin ───────────────────────────────────────────────────────────────

class TerrainSplatPlugin extends BABYLON.MaterialPluginBase {
  constructor(material, tierCfg) {
    // Priority 210: after AshwoodLeafSway (200); arbitrary but stable.
    super(material, 'AshwoodTerrainSplat', 210, {
      TERR_ENABLED: false,
      TERR_HEIGHTBLEND: false,
      TERR_DETAILNORMAL: false,
      TERR_TRIPLANAR: false,
      TERR_FLOWERS: false,
    });
    this._cfg = tierCfg;
    this._debug = 0;
    this._enable(true);
  }

  getClassName() { return 'AshwoodTerrainSplatPlugin'; }

  // Feature permutation is fixed per material (per quality tier), so the defines
  // never change after creation — cheap, one compile.
  prepareDefines(defines) {
    defines.TERR_ENABLED = true;
    defines.TERR_HEIGHTBLEND = !!this._cfg.heightBlend;
    defines.TERR_DETAILNORMAL = !!this._cfg.detailNormal;
    defines.TERR_TRIPLANAR = !!this._cfg.triplanar;
    defines.TERR_FLOWERS = !!this._cfg.flowers;
  }

  getAttributes(attributes) {
    // vec4 per vertex: (dirt, sand, rock, field) authored weights, baked in the
    // tile provider from the worldgen trail/lake/biome fields.
    attributes.push('terrainSplat');
  }

  getUniforms() {
    return {
      ubo: [
        { name: 'uTerrOct',    size: 1, type: 'float' },
        { name: 'uTerrDetail', size: 1, type: 'float' },
        { name: 'uTerrDebug',  size: 1, type: 'float' },
      ],
      fragment:
        'uniform float uTerrOct;\nuniform float uTerrDetail;\nuniform float uTerrDebug;\n',
    };
  }

  bindForSubMesh(uniformBuffer) {
    uniformBuffer.updateFloat('uTerrOct', this._cfg.oct);
    uniformBuffer.updateFloat('uTerrDetail', this._cfg.detail);
    uniformBuffer.updateFloat('uTerrDebug', this._debug);
  }

  getCustomCode(shaderType) {
    if (shaderType === 'vertex') {
      return {
        CUSTOM_VERTEX_DEFINITIONS: `
attribute vec4 terrainSplat;
varying vec4 vTerrainSplat;
`,
        CUSTOM_VERTEX_MAIN_END: `
vTerrainSplat = terrainSplat;
`,
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
  return mix(mix(terrHash21(i),               terrHash21(i + vec2(1.0, 0.0)), u.x),
             mix(terrHash21(i + vec2(0.0,1.0)), terrHash21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float terrFbm(vec2 p, int oct){
  float h = 0.0, amp = 0.5;
  for (int i = 0; i < 8; i++){ if (i >= oct) break; h += amp * terrValueNoise(p); p = TERR_R * p * 2.03; amp *= 0.5; }
  return h;
}
float terrRidged(vec2 p, int oct){
  float h = 0.0, amp = 0.5;
  for (int i = 0; i < 8; i++){ if (i >= oct) break; float n = terrValueNoise(p); h += amp * (1.0 - abs(n * 2.0 - 1.0)); p = TERR_R * p * 2.03; amp *= 0.52; }
  return h;
}
#ifdef TERR_TRIPLANAR
float terrTriNoise(vec3 wp, vec3 n, float s, int oct){
  vec3 bw = pow(abs(n), vec3(4.0)); bw /= dot(bw, vec3(1.0));
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
      // BEFORE_LIGHTS (not UPDATE_ALBEDO): by this point surfaceAlbedo still
      // holds grass × biome tint AND the working normal `normalW` is declared
      // (the bump block runs after albedo in this engine build), so we can both
      // set the blended albedo and perturb the normal for real shading. Both
      // are consumed downstream (final colour composition multiplies
      // surfaceAlbedo; the light loop reads normalW).
      CUSTOM_FRAGMENT_BEFORE_LIGHTS: `
#ifdef TERR_ENABLED
{
  vec3  terrWP = vPositionW;
  vec2  terrP  = terrWP.xz;
  int   terrOct = int(uTerrOct + 0.5);
  vec4  terrSplat = clamp(vTerrainSplat, 0.0, 1.0);   // x=dirt y=sand z=rock w=field

  // Slope from the geometric normal (Y-up), jittered so the rock band is a
  // material edge, not a clean isoline.
  float terrJit   = terrValueNoise(terrP * 0.05) - 0.5;
  float terrSlope = 1.0 - clamp(vNormalW.y, 0.0, 1.0);
  float terrRockSlope = smoothstep(0.34, 0.62, terrSlope + abs(terrJit) * 0.14);
  float wRock = max(terrSplat.z, terrRockSlope);

  // Per-surface relief heights (each surface's single noise cause). Grass has
  // no baseline texture, so its own clump/macro noise IS its cause — reused
  // below for both the relief height and the albedo mottling.
  float grassClump = terrFbm(terrP * 0.85 + 1.70, terrOct);   // per-clump patchiness
  float grassMacro = terrFbm(terrP * 0.20 - 5.30, terrOct);   // broad meadow variation
  float hGrass = grassClump * 0.6 + grassMacro * 0.4;
  float hDirt  = terrFbm(terrP * 0.60 + 3.10, terrOct);
  float hRock  = terrRidged(terrP * 0.90, terrOct);
#ifdef TERR_TRIPLANAR
  hRock = mix(hRock, terrTriNoise(terrWP, vNormalW, 0.9, terrOct), smoothstep(0.42, 0.70, terrSlope));
#endif
  vec2  terrWind = vec2(0.94, 0.34);
  float terrU = dot(terrP, terrWind);
  float hSand = (sin(terrU * 2.2 + terrFbm(terrP * 0.4, terrOct) * 3.0) * 0.5 + 0.5) * 0.6
              + terrFbm(terrP * 3.0, terrOct) * 0.4;
  float terrPatch = clamp(terrValueNoise(terrP * 0.7) * 0.5 + 0.5, 0.0, 1.0);
  float hField = terrPatch * 0.7 + terrFbm(terrP * 2.0 + 7.70, terrOct) * 0.3;

  // Per-surface albedo. Grass has no albedo texture, so surfaceAlbedo here is
  // still the pure per-vertex biome tint (flat white albedoColor × vColor) —
  // modulated by the SAME grassClump/grassMacro noise that drives hGrass
  // above, so grass's colour and relief share one cause like every other
  // surface instead of coming from a static image.
  vec3 grassBase = surfaceAlbedo;
  vec3 aGrass = grassBase * (0.78 + 0.34 * grassClump) * (0.88 + 0.24 * grassMacro);
  aGrass = mix(aGrass, min(grassBase * 1.22, vec3(1.0)), smoothstep(0.6, 0.9, grassClump) * 0.4);
  vec3 aDirt  = mix(vec3(0.19, 0.13, 0.08), vec3(0.37, 0.26, 0.15), hDirt);
  vec3 aRock  = mix(vec3(0.21, 0.21, 0.20), vec3(0.35, 0.34, 0.32), hRock);
  vec3 aSand  = mix(vec3(0.56, 0.46, 0.29), vec3(0.75, 0.64, 0.42), hSand);
  vec3 aField = mix(vec3(0.32, 0.35, 0.14), vec3(0.58, 0.55, 0.24), terrPatch);
  aField = mix(aField, aGrass, 0.30);                 // field follows the biome grass tint
#ifdef TERR_FLOWERS
  vec2 terrCell; float terrF1 = terrVoronoi(terrP * 5.5, terrCell);
  float terrFlower = smoothstep(0.16, 0.04, terrF1) * step(0.62, terrHash21(terrCell));
  aField = mix(aField, vec3(0.90, 0.85, 0.42), terrFlower * 0.65);
#endif

  // Control weights. Grass is the baseline (1.0) everywhere; the masks are
  // scaled so a full mask beats grass in the height blend.
  float wGrass = 1.0;
  float wDirt  = terrSplat.x * 1.70;
  float wSand  = terrSplat.y * 1.90;
  float wRockW = wRock * 1.80;
  float wField = terrSplat.w * 1.25;

#ifdef TERR_HEIGHTBLEND
  float terrDepth = 0.22;
  float s0 = wGrass + hGrass, s1 = wDirt + hDirt, s2 = wRockW + hRock, s3 = wSand + hSand, s4 = wField + hField;
  float terrM = max(max(max(s0, s1), max(s2, s3)), s4) - terrDepth;
  float b0 = max(s0 - terrM, 0.0), b1 = max(s1 - terrM, 0.0), b2 = max(s2 - terrM, 0.0), b3 = max(s3 - terrM, 0.0), b4 = max(s4 - terrM, 0.0);
#else
  float b0 = wGrass, b1 = wDirt, b2 = wRockW, b3 = wSand, b4 = wField;
#endif
  float terrSum = b0 + b1 + b2 + b3 + b4 + 1e-5;
  b0 /= terrSum; b1 /= terrSum; b2 /= terrSum; b3 /= terrSum; b4 /= terrSum;

  vec3 terrAlb = b0 * aGrass + b1 * aDirt + b2 * aRock + b3 * aSand + b4 * aField;
  // Low-frequency macro variation breaks obvious tiling.
  terrAlb *= 1.0 + (terrValueNoise(terrP * 0.11) - 0.5) * 0.34;

#ifdef TERR_DETAILNORMAL
  // Screen-space height -> world normal (Mikkelsen unparametrised-surface
  // gradient), faded out with camera distance so distant slopes don't shimmer.
  float terrH = b0 * hGrass + b1 * hDirt + b2 * hRock * 1.4 + b3 * hSand * 0.6 + b4 * hField;
  vec3  terrDpx = dFdx(terrWP), terrDpy = dFdy(terrWP);
  vec3  terrR1 = cross(terrDpy, normalW), terrR2 = cross(normalW, terrDpx);
  float terrDet = dot(terrDpx, terrR1);
  vec3  terrGrad = sign(terrDet) * (dFdx(terrH) * terrR1 + dFdy(terrH) * terrR2);
  float terrCam = length(vEyePosition.xyz - terrWP);
  float terrStr = uTerrDetail * (1.0 - smoothstep(12.0, 60.0, terrCam)) * (1.0 - b0 * 0.45);
  normalW = normalize(abs(terrDet) * normalW - terrGrad * terrStr);
#endif

  surfaceAlbedo = terrAlb;

  if (uTerrDebug > 0.5) {
    if (uTerrDebug < 1.5)      surfaceAlbedo = vec3(b1, b2, b3);   // dirt / rock / sand
    else if (uTerrDebug < 2.5) surfaceAlbedo = vec3(b4, b0, 0.0);  // field / grass
    else                       surfaceAlbedo = vec3(terrSlope);    // slope
  }
}
#endif
`,
    };
  }
}

// ── public API ───────────────────────────────────────────────────────────────

/**
 * Build the shared runtime terrain material (one per scene). Untextured PBR
 * base (flat white albedo × per-vertex biome tint); the TerrainSplatPlugin
 * supplies every visible surface — grass included — procedurally, so there is
 * no ground image asset for it to load at all.
 *
 * @param {BABYLON.Scene} scene
 * @param {object} opts { tier?: 'high'|'low'|'mobile' }
 * @returns {BABYLON.PBRMaterial} with `._terrainPlugin` attached.
 */
export function createTerrainMaterial(scene, opts = {}) {
  const tier = opts.tier ?? scene.metadata?.ashwood?.qualityTier ?? 'high';
  const cfg = TERRAIN_TIERS[tier] ?? TERRAIN_TIERS.high;

  const mat = new BABYLON.PBRMaterial('ashwood_ground', scene);
  mat.metallic = 0;
  mat.roughness = 0.95;
  mat.specularIntensity = 0.4;
  mat.enableSpecularAntiAliasing = true;

  mat._terrainPlugin = new TerrainSplatPlugin(mat, cfg);
  return mat;
}

/** QA hook: 0 final, 1 dirt/rock/sand weights, 2 field/grass weights, 3 slope. */
export function setTerrainDebugMode(material, mode) {
  if (material?._terrainPlugin) {
    material._terrainPlugin._debug = mode;
    material.markDirty();
  }
}
