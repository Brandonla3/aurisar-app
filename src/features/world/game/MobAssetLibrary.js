/**
 * MobAssetLibrary — singleton GLB container cache for mobs.
 *
 * Mirrors `AssetLibrary.js` (characters) but loads from `/assets/mobs/`.
 * `BabylonWorldScene._spawnMob` consults `hasContainer(row.mobType)`; on a
 * hit it instantiates from the cached AssetContainer, on a miss it falls
 * back to the primitive composite already in `_spawnMob`. Missing GLB
 * files load silently so a new mob type can ship runtime-side before its
 * .glb has been authored.
 *
 * Usage:
 *   await MobAssetLibrary.init(scene);
 *   const container = MobAssetLibrary.getContainer('wolf');
 *   if (container) { const inst = container.instantiateModelsToScene(...); ... }
 *
 * See public/assets/mobs/README.md for the export contract.
 */

/* global BABYLON */

const BASE = '/assets/mobs/';

// Mob type (matches `mob.mob_type` in the SpacetimeDB module) → relative .glb
// path. Keys must align with the `mobType` string the server emits; missing
// files load silently and `_spawnMob` falls back to primitives.
const MANIFEST = {
  wolf: 'wolf.glb',
};

const _containers = new Map();
let   _ready      = false;

async function _load(key, path, scene) {
  try {
    const parts = path.lastIndexOf('/');
    const dir   = parts >= 0 ? BASE + path.slice(0, parts + 1) : BASE;
    const file  = parts >= 0 ? path.slice(parts + 1) : path;
    const c = await BABYLON.SceneLoader.LoadAssetContainerAsync(dir, file, scene);
    _containers.set(key, c);
  } catch {
    // Asset not yet present — skip silently. _spawnMob will use the
    // primitive fallback for this mobType.
  }
}

export const MobAssetLibrary = {
  /**
   * Load all known mob GLBs. Missing files are skipped — none are
   * load-critical, since `_spawnMob` falls back to primitives. Call once
   * during scene init, alongside `AssetLibrary.init`.
   */
  async init(scene) {
    await Promise.all(
      Object.entries(MANIFEST).map(([k, p]) => _load(k, p, scene))
    );
    _ready = true;
    console.log('[MobAssetLibrary] Ready. Loaded:', [..._containers.keys()].join(', ') || '(none)');
  },

  /** Returns the AssetContainer for a mob type, or null if not loaded. */
  getContainer(key) {
    return _containers.get(key) ?? null;
  },

  /** Whether a GLB is loaded for a given mob type. */
  hasContainer(key) {
    return _containers.has(key);
  },

  isReady() { return _ready; },

  dispose() {
    _containers.forEach(c => c.dispose());
    _containers.clear();
    _ready = false;
  },
};
