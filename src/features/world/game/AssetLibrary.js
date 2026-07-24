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

import charactersManifest from '../../../../public/assets/manifest/characters.manifest.json';
import modelsManifest from '../../../../public/assets/manifest/models.manifest.json';

export const CHARACTER_ASSET_BASE = charactersManifest.base; // '/assets/characters/'
const BASE = CHARACTER_ASSET_BASE;

// Key → relative path under BASE, read from the generated manifest
// (scripts/assets_pipeline.mjs). Keys are `base_body`, `hair/<style>`,
// `clothing/<item>`, `species/<piece>`, and — once fit + processed — `gear/<key>`.
// Hair keys match `HAIR_STYLES` in src/features/avatar/panels/HairPanel.jsx;
// `hair_shaved` intentionally has no asset (renders no mesh). Missing files
// load silently (see _load); the manifest is the single source of truth,
// shared with AvatarPreview's PreviewAssets. See public/assets/characters/README.md.
export const MANIFEST = Object.fromEntries(
  Object.entries(charactersManifest.assets).map(([key, a]) => [key, a.file]),
);

// Standalone, self-contained character models — a full rigged+animated mesh in
// a single GLB, NOT part of the modular MPFB system (no shape keys, own
// skeleton). Used for authored hero/NPC appearances via `avatarConfig.model`.
// Built by scripts/build_gilded_sentinel.mjs; keyed by asset key in the
// generated models manifest. CharacterAvatar takes a distinct build path for
// these (no morphs, no modular hair/clothing/gear pieces).
export const MODEL_MANIFEST = Object.fromEntries(
  Object.entries(modelsManifest.assets).map(([key, a]) => [key, a.file]),
);

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

/**
 * Factory for standalone character-asset caches. The world's singleton
 * (below) can't be shared across Babylon scenes — AvatarPreview and
 * CharacterTurntable each spin up their own engine, so each needs its own
 * containers loaded from the SAME MANIFEST.
 */
export function createCharacterAssetCache() {
  const containers = new Map();
  let ready = false;
  const cache = {
    async init(scene) {
      const load = async (key, path) => {
        try {
          const parts = path.lastIndexOf('/');
          const dir   = parts >= 0 ? BASE + path.slice(0, parts + 1) : BASE;
          const file  = parts >= 0 ? path.slice(parts + 1) : path;
          const c = await BABYLON.SceneLoader.LoadAssetContainerAsync(dir, file, scene);
          containers.set(key, c);
        } catch {
          // Asset not yet present — skip silently
        }
      };
      await load('base_body', MANIFEST['base_body']);
      await Promise.all(
        Object.entries(MANIFEST)
          .filter(([k]) => k !== 'base_body')
          .map(([k, p]) => load(k, p))
      );
      ready = true;
    },
    getContainer(key) { return containers.get(key) ?? null; },
    hasBaseBody()     { return containers.has('base_body'); },
    isReady()         { return ready; },
    get _ready()      { return ready; },
    dispose() {
      containers.forEach(c => c.dispose());
      containers.clear();
      ready = false;
    },
  };
  return cache;
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
    // Standalone full-model characters (Gilded Sentinel etc.). Non-critical —
    // missing files fall back to the modular body in CharacterAvatar.
    await Promise.all(
      Object.entries(MODEL_MANIFEST).map(([k, p]) => _load(`model/${k}`, p, scene))
    );
    _ready = true;
    console.log('[AssetLibrary] Ready. Loaded:', [..._containers.keys()].join(', ') || '(none)');
  },

  /** Returns the AssetContainer for a key, or null if not loaded. */
  getContainer(key) {
    return _containers.get(key) ?? null;
  },

  /** Returns the AssetContainer for a standalone model key, or null. */
  getModelContainer(key) {
    return _containers.get(`model/${key}`) ?? null;
  },

  isReady() { return _ready; },

  hasBaseBody() { return _containers.has('base_body'); },

  dispose() {
    _containers.forEach(c => c.dispose());
    _containers.clear();
    _ready = false;
  },
};
