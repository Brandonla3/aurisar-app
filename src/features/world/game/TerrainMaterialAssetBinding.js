import { TerrainAssetLibrary } from './TerrainAssetLibrary.js';

const sceneLibraryPromises = new WeakMap();

function isDisposed(value) {
  return typeof value?.isDisposed === 'function' && value.isDisposed();
}

/**
 * Return the scene-owned terrain asset library. Creation is shared so multiple
 * materials cannot fetch the manifest or allocate the same texture set twice.
 */
export function getTerrainAssetLibraryForScene(scene, {
  createLibrary = TerrainAssetLibrary.create,
  libraryOptions,
} = {}) {
  if (!scene || (typeof scene !== 'object' && typeof scene !== 'function')) {
    return Promise.reject(new TypeError('[TerrainMaterialAssetBinding] scene is required'));
  }

  const cached = sceneLibraryPromises.get(scene);
  if (cached) return cached;

  const promise = Promise.resolve()
    .then(() => createLibrary(scene, libraryOptions))
    .then((library) => {
      if (!library || typeof library.loadProfile !== 'function') {
        throw new TypeError('[TerrainMaterialAssetBinding] invalid terrain asset library');
      }

      if (isDisposed(scene)) {
        library.dispose?.();
        throw new Error('[TerrainMaterialAssetBinding] scene was disposed while terrain assets loaded');
      }

      scene.onDisposeObservable?.addOnce?.(() => {
        library.dispose?.();
        if (sceneLibraryPromises.get(scene) === promise) {
          sceneLibraryPromises.delete(scene);
        }
      });

      return library;
    })
    .catch((error) => {
      if (sceneLibraryPromises.get(scene) === promise) {
        sceneLibraryPromises.delete(scene);
      }
      throw error;
    });

  sceneLibraryPromises.set(scene, promise);
  return promise;
}

/**
 * Load and hot-bind one terrain profile without delaying tile construction.
 * Any manifest or texture failure is contained so the procedural shader stays
 * active and the world remains playable.
 */
export async function bindTerrainAssetProfile(material, scene, profileName = 'overworld', {
  createLibrary = TerrainAssetLibrary.create,
  libraryOptions,
  logger = console,
} = {}) {
  try {
    const library = await getTerrainAssetLibraryForScene(scene, {
      createLibrary,
      libraryOptions,
    });

    if (isDisposed(scene) || isDisposed(material)) return null;

    const profile = await library.loadProfile(profileName);
    if (!profile || isDisposed(scene) || isDisposed(material)) return null;

    const applied = material?._terrainPlugin?.setAssetProfile?.(profile) ?? false;
    if (!applied) return null;

    material.markDirty?.();
    return profile;
  } catch (error) {
    logger?.warn?.(
      `[terrain-assets] ${profileName} profile unavailable; keeping procedural terrain`,
      error,
    );
    return null;
  }
}
