/* global BABYLON */

export const TERRAIN_ASSET_MANIFEST_URL = '/assets/terrain/manifest.json';
const TERRAIN_SLOTS = Object.freeze(['grass', 'dirt', 'sand', 'rock', 'field']);

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`[TerrainAssetLibrary] ${label} must be an object`);
  }
  return value;
}

function disposeLoadedSet(set) {
  set?.baseColor?.dispose?.();
  set?.normal?.dispose?.();
  set?.orm?.dispose?.();
  set?.height?.dispose?.();
}

export function validateTerrainAssetManifest(manifest) {
  assertObject(manifest, 'manifest');
  if (manifest.version !== 1) {
    throw new Error(`[TerrainAssetLibrary] Unsupported manifest version: ${manifest.version}`);
  }
  assertObject(manifest.sets, 'manifest.sets');
  assertObject(manifest.profiles, 'manifest.profiles');

  for (const [id, set] of Object.entries(manifest.sets)) {
    assertObject(set, `set "${id}"`);
    assertObject(set.maps, `set "${id}".maps`);
    for (const required of ['baseColor', 'normal', 'orm']) {
      if (typeof set.maps[required] !== 'string' || !set.maps[required]) {
        throw new Error(`[TerrainAssetLibrary] set "${id}" is missing maps.${required}`);
      }
    }
  }

  for (const [name, profile] of Object.entries(manifest.profiles)) {
    assertObject(profile, `profile "${name}"`);
    for (const slot of TERRAIN_SLOTS) {
      const id = profile[slot] ?? null;
      if (id !== null && !Object.hasOwn(manifest.sets, id)) {
        throw new Error(`[TerrainAssetLibrary] profile "${name}" references unknown ${slot} set "${id}"`);
      }
    }
  }

  return manifest;
}

export async function fetchTerrainAssetManifest({
  url = TERRAIN_ASSET_MANIFEST_URL,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('[TerrainAssetLibrary] fetch implementation is unavailable');
  }
  const response = await fetchImpl(url, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`[TerrainAssetLibrary] Failed to load ${url}: HTTP ${response.status}`);
  }
  return validateTerrainAssetManifest(await response.json());
}

function loadTexture(scene, url, { gammaSpace, anisotropy, name }) {
  return new Promise((resolve, reject) => {
    const texture = new BABYLON.Texture(
      url,
      scene,
      false,
      false,
      BABYLON.Texture.TRILINEAR_SAMPLINGMODE,
      () => {
        texture.name = name;
        texture.gammaSpace = gammaSpace;
        texture.wrapU = BABYLON.Texture.WRAP_ADDRESSMODE;
        texture.wrapV = BABYLON.Texture.WRAP_ADDRESSMODE;
        texture.anisotropicFilteringLevel = anisotropy;
        resolve(texture);
      },
      (_message, exception) => {
        texture.dispose();
        reject(exception ?? new Error(`[TerrainAssetLibrary] Failed to load ${url}`));
      },
    );
  });
}

/**
 * Lazy, scene-owned terrain texture cache.
 *
 * The current procedural terrain material remains the fallback. A later shader
 * integration can request a profile here and bind its returned textures without
 * changing asset URLs, licensing metadata, or cache behavior.
 */
export class TerrainAssetLibrary {
  constructor(scene, manifest) {
    this.scene = scene;
    this.manifest = validateTerrainAssetManifest(manifest);
    this._sets = new Map();
    this._inflight = new Map();
    this._disposed = false;
    this._disposeGeneration = 0;
  }

  static async create(scene, options) {
    const manifest = await fetchTerrainAssetManifest(options);
    return new TerrainAssetLibrary(scene, manifest);
  }

  getProfileDefinition(name) {
    return this.manifest.profiles[name] ?? this.manifest.profiles.overworld ?? null;
  }

  async loadSet(id) {
    if (!id || this._disposed) return null;
    if (this._sets.has(id)) return this._sets.get(id);
    if (this._inflight.has(id)) return this._inflight.get(id);

    const definition = this.manifest.sets[id];
    if (!definition) return null;

    const generation = this._disposeGeneration;
    const promise = (async () => {
      const anisotropy = Math.max(1, Math.min(16, definition.anisotropy ?? 8));
      const [baseColor, normal, orm, height] = await Promise.all([
        loadTexture(this.scene, definition.maps.baseColor, {
          gammaSpace: true,
          anisotropy,
          name: `terrain:${id}:baseColor`,
        }),
        loadTexture(this.scene, definition.maps.normal, {
          gammaSpace: false,
          anisotropy,
          name: `terrain:${id}:normal`,
        }),
        loadTexture(this.scene, definition.maps.orm, {
          gammaSpace: false,
          anisotropy,
          name: `terrain:${id}:orm`,
        }),
        definition.maps.height
          ? loadTexture(this.scene, definition.maps.height, {
              gammaSpace: false,
              anisotropy,
              name: `terrain:${id}:height`,
            })
          : Promise.resolve(null),
      ]);

      const loaded = Object.freeze({
        id,
        definition,
        baseColor,
        normal,
        orm,
        height,
      });

      if (this._disposed || this._disposeGeneration !== generation) {
        disposeLoadedSet(loaded);
        return null;
      }

      this._sets.set(id, loaded);
      return loaded;
    })();

    this._inflight.set(id, promise);
    try {
      return await promise;
    } finally {
      if (this._inflight.get(id) === promise) {
        this._inflight.delete(id);
      }
    }
  }

  async loadProfile(name) {
    if (this._disposed) return null;
    const profile = this.getProfileDefinition(name);
    if (!profile) return null;

    const entries = await Promise.all(
      TERRAIN_SLOTS.map(async (slot) => [slot, await this.loadSet(profile[slot])]),
    );

    if (this._disposed) return null;
    return Object.freeze(Object.fromEntries(entries));
  }

  getLoadedSet(id) {
    return this._sets.get(id) ?? null;
  }

  dispose() {
    if (this._disposed && this._sets.size === 0 && this._inflight.size === 0) return;
    this._disposed = true;
    this._disposeGeneration++;

    for (const set of this._sets.values()) {
      disposeLoadedSet(set);
    }
    this._sets.clear();
    this._inflight.clear();
  }
}