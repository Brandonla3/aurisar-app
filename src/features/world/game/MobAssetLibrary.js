/**
 * MobAssetLibrary — singleton GLB container cache for mobs.
 *
 * The key→file table is no longer hand-maintained here: it is read from the
 * generated `public/assets/manifest/mobs.manifest.json` (emitted by
 * scripts/assets_pipeline.mjs), keyed by each mob GLB's asset key — the same
 * string `MobDef.glbKey` carries in the content graph (wolf, bull, spider,
 * glubevolved, goblin, tribal, skeleton_minion, orcenemy). The scene resolves
 * a row's `mobType` → `MOBS[mobType].glbKey` → this cache; several mob types
 * share one asset key (forest_wolf + old_greyjaw → wolf). Missing files load
 * silently and `_spawnMob` falls back to family-shaped primitives.
 *
 * See public/assets/mobs/README.md for the export contract.
 */

/* global BABYLON */

import mobsManifest from '../../../../public/assets/manifest/mobs.manifest.json';

const BASE = mobsManifest.base; // '/assets/mobs/'

// assetKey (== MobDef.glbKey) → file, straight from the generated manifest.
const ASSETS = Object.fromEntries(
  Object.entries(mobsManifest.assets).map(([key, a]) => [key, a.file]),
);

const _containers = new Map();
let   _ready      = false;

async function _load(key, path, scene) {
  try {
    const parts = path.lastIndexOf('/');
    const dir   = parts >= 0 ? BASE + path.slice(0, parts + 1) : BASE;
    const file  = parts >= 0 ? path.slice(parts + 1) : path;
    const c = await BABYLON.SceneLoader.LoadAssetContainerAsync(dir, file, scene);
    _containers.set(key, c);
  } catch (err) {
    // Non-fatal — _spawnMob falls back to the primitive composite for this
    // asset key. Warn so a bad export during an asset swap is debuggable
    // instead of silently shipping shape-primitive mobs.
    console.warn(`[MobAssetLibrary] ${key} (${path}) failed to load; using primitive fallback:`, err?.message ?? err);
  }
}

export const MobAssetLibrary = {
  /**
   * Load every mob GLB named in the manifest. Missing files are skipped —
   * none are load-critical, since `_spawnMob` falls back to primitives. Call
   * once during scene init, alongside `AssetLibrary.init`.
   */
  async init(scene) {
    await Promise.all(
      Object.entries(ASSETS).map(([k, p]) => _load(k, p, scene))
    );
    _ready = true;
    console.log('[MobAssetLibrary] Ready. Loaded:', [..._containers.keys()].join(', ') || '(none)');
  },

  /** Returns the AssetContainer for an asset key (== glbKey), or null. */
  getContainer(key) {
    return _containers.get(key) ?? null;
  },

  /** Whether a GLB is loaded for a given asset key. */
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
