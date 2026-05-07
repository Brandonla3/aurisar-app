/**
 * AssetLibrary — singleton GLB container cache.
 *
 * Loads every character GLB once using LoadAssetContainerAsync, then
 * hands instantiateModelsToScene results to CharacterAvatar on demand.
 *
 * Usage:
 *   await AssetLibrary.init(scene);
 *   const container = AssetLibrary.getContainer('base_body');
 *   const container = AssetLibrary.getContainer('hair/hair_short');
 *
 * Falls back silently when a GLB file is missing — CharacterAvatar will
 * skip that piece rather than crashing.
 */

/* global BABYLON */

const BASE = '/assets/characters/';

// Keys → relative paths under BASE
const MANIFEST = {
  base_body:          'base_body.glb',
  'hair/hair_short':  'hair/hair_short.glb',
  'hair/hair_long':   'hair/hair_long.glb',
  'hair/hair_braids': 'hair/hair_braids.glb',
  'clothing/top_casual':    'clothing/top_casual.glb',
  'clothing/top_hoodie':    'clothing/top_hoodie.glb',
  'clothing/bottom_jeans':  'clothing/bottom_jeans.glb',
  'clothing/bottom_shorts': 'clothing/bottom_shorts.glb',
  'clothing/shoes_boots':   'clothing/shoes_boots.glb',
  'species/horns_small':    'species/horns_small.glb',
  'species/horns_large':    'species/horns_large.glb',
  'species/horns_curved':   'species/horns_curved.glb',
};

const _containers = new Map();
let   _scene      = null;
let   _ready      = false;

async function _load(key, path, scene) {
  try {
    const parts = path.lastIndexOf('/');
    const dir   = parts >= 0 ? BASE + path.slice(0, parts + 1) : BASE;
    const file  = parts >= 0 ? path.slice(parts + 1) : path;
    const c = await BABYLON.SceneLoader.LoadAssetContainerAsync(dir, file, scene);
    _containers.set(key, c);
  } catch {
    // Asset not yet present — skip silently
  }
}

export const AssetLibrary = {
  /**
   * Load all known GLBs.  Missing files are skipped; only base_body is required
   * for GLB characters.  Call once during scene init.
   */
  async init(scene) {
    _scene = scene;
    // base_body is load-critical — await it; everything else loads in parallel
    await _load('base_body', MANIFEST['base_body'], scene);
    await Promise.all(
      Object.entries(MANIFEST)
        .filter(([k]) => k !== 'base_body')
        .map(([k, p]) => _load(k, p, scene))
    );
    _ready = true;
    console.log('[AssetLibrary] Ready. Loaded:', [..._containers.keys()].join(', ') || '(none)');
  },

  /** Returns the AssetContainer for a key, or null if not loaded. */
  getContainer(key) {
    return _containers.get(key) ?? null;
  },

  isReady() { return _ready; },

  hasBaseBody() { return _containers.has('base_body'); },

  dispose() {
    _containers.forEach(c => c.dispose());
    _containers.clear();
    _ready = false;
  },
};
