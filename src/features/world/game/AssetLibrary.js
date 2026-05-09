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

// Keys → relative paths under BASE.
// Hair keys must match `HAIR_STYLES` keys in src/features/avatar/panels/HairPanel.jsx.
// `hair_shaved` intentionally has no entry — selecting it should render no mesh.
// Missing files load silently (see _load below); a Blender-authored .glb can land
// later with no other code change. See public/assets/characters/README.md for the
// export contract.
const MANIFEST = {
  // Base bodies — neutral default + gendered variants. Selected via
  // CharacterAvatar._resolveBaseBody based on config.body.gender.
  base_body:            'base_body.glb',
  base_body_male:       'base_body_male.glb',
  base_body_female:     'base_body_female.glb',

  // Hair (8 styles + 'hair_shaved' renders as nothing — intentionally absent)
  'hair/hair_short':    'hair/hair_short.glb',
  'hair/hair_long':     'hair/hair_long.glb',
  'hair/hair_braids':   'hair/hair_braids.glb',
  'hair/hair_ponytail': 'hair/hair_ponytail.glb',
  'hair/hair_bun':      'hair/hair_bun.glb',
  'hair/hair_wavy':     'hair/hair_wavy.glb',
  'hair/hair_afro':     'hair/hair_afro.glb',
  'hair/hair_mohawk':   'hair/hair_mohawk.glb',

  // Clothing — fantasy RPG only (no modern items).
  'clothing/top_tunic':           'clothing/top_tunic.glb',
  'clothing/top_robe':            'clothing/top_robe.glb',
  'clothing/top_cloth_shirt':     'clothing/top_cloth_shirt.glb',
  'clothing/top_gambeson':        'clothing/top_gambeson.glb',
  'clothing/top_leather_vest':    'clothing/top_leather_vest.glb',
  'clothing/top_chainmail':       'clothing/top_chainmail.glb',
  'clothing/bottom_trousers':     'clothing/bottom_trousers.glb',
  'clothing/bottom_kilt':         'clothing/bottom_kilt.glb',
  'clothing/bottom_leather_pants':'clothing/bottom_leather_pants.glb',
  'clothing/bottom_breeches':     'clothing/bottom_breeches.glb',
  'clothing/bottom_cloth_skirt':  'clothing/bottom_cloth_skirt.glb',
  'clothing/bottom_leggings':     'clothing/bottom_leggings.glb',
  'clothing/shoes_boots':         'clothing/shoes_boots.glb',
  'clothing/shoes_sandals':       'clothing/shoes_sandals.glb',
  'clothing/shoes_greaves':       'clothing/shoes_greaves.glb',
  'clothing/shoes_leather_wraps': 'clothing/shoes_leather_wraps.glb',

  // Species — horns (head-attached) and tails (hip-attached).
  'species/horns_small':    'species/horns_small.glb',
  'species/horns_large':    'species/horns_large.glb',
  'species/horns_curved':   'species/horns_curved.glb',
  'species/tail_short':     'species/tail_short.glb',
  'species/tail_long':      'species/tail_long.glb',
  'species/tail_fluffy':    'species/tail_fluffy.glb',

  // Gear — auto-skinned via scripts/blender/04_import_armor.py. Each piece
  // ships skin weights bound to the shared MPFB rig so it deforms with the
  // body. Add new entries here as `gear/<key>: 'gear/<key>.glb'`.
  'gear/legs_fantasy1': 'gear/legs_fantasy1.glb',
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
