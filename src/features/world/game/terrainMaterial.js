/* global BABYLON */

/**
 * Desktop-stability terrain material fallback.
 *
 * PR #253 intentionally removes the custom terrain MaterialPlugin from the live
 * renderer. The current desktop blocker is WebGL context loss, so the world must
 * boot with Babylon's stock material path first. Scanned/PBR terrain work stays
 * in the asset pipeline and can be reintroduced behind a separate verified
 * shader rollout once the baseline preview is clean.
 */

export const TERRAIN_PRESETS = Object.freeze({
  overworld: 0,
  mountain: 1,
  forest: 2,
  castle: 3,
  dungeon: 4,
});

const PRESET_COLORS = Object.freeze({
  overworld: '#ffffff',
  mountain: '#e0e3dd',
  forest: '#d8e2c4',
  castle: '#d8c9aa',
  dungeon: '#8d9693',
});

function presetNameFromOptions(opts = {}) {
  return Object.prototype.hasOwnProperty.call(TERRAIN_PRESETS, opts.preset)
    ? opts.preset
    : 'overworld';
}

/**
 * Create the safest possible runtime terrain material.
 *
 * Mesh vertex colors still carry the biome/trail/shore/wetness information from
 * AshwoodTileProvider._buildGround(), but this avoids every custom GLSL hook,
 * sampler, render-target interaction and asynchronous texture bind while the
 * desktop WebGL baseline is being stabilized.
 *
 * @param {BABYLON.Scene} scene
 * @param {{preset?:keyof typeof TERRAIN_PRESETS}} opts
 */
export function createTerrainMaterial(scene, opts = {}) {
  const presetName = presetNameFromOptions(opts);
  const mat = new BABYLON.StandardMaterial(`ashwood_ground_${presetName}`, scene);

  mat.diffuseColor = BABYLON.Color3.FromHexString(PRESET_COLORS[presetName] ?? '#ffffff');
  mat.specularColor = new BABYLON.Color3(0, 0, 0);
  mat.emissiveColor = new BABYLON.Color3(0, 0, 0);
  mat.backFaceCulling = true;
  mat.disableLighting = false;

  // Preserve these fields so existing callers/tests can treat the fallback like
  // the previous terrain material without invoking any custom shader plugin.
  mat._terrainPreset = presetName;
  mat._terrainPlugin = null;
  mat._terrainAssetPromise = Promise.resolve(null);

  return mat;
}

/** Build all environment identities once for scene-level reuse. */
export function createTerrainMaterialSet(scene, opts = {}) {
  return Object.fromEntries(Object.keys(TERRAIN_PRESETS).map((preset) => [
    preset,
    createTerrainMaterial(scene, { ...opts, preset }),
  ]));
}

/** QA hook retained for compatibility; no-op while the safe fallback is active. */
export function setTerrainDebugMode(material, mode) {
  if (material) material._terrainDebugMode = mode;
}
