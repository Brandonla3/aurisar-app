import { describe, expect, it, vi } from 'vitest';
import {
  bindTerrainAssetProfile,
  getTerrainAssetLibraryForScene,
} from './TerrainMaterialAssetBinding.js';

function makeScene() {
  let disposeCallback = null;
  return {
    isDisposed: () => false,
    onDisposeObservable: {
      addOnce: vi.fn((callback) => {
        disposeCallback = callback;
      }),
    },
    disposeAssets: () => disposeCallback?.(),
  };
}

function makeMaterial() {
  return {
    isDisposed: () => false,
    markDirty: vi.fn(),
    _terrainPlugin: {
      setAssetProfile: vi.fn(() => true),
    },
  };
}

describe('TerrainMaterialAssetBinding', () => {
  it('shares one scene library and binds loaded profiles without blocking material creation', async () => {
    const scene = makeScene();
    const grass = { id: 'meadow' };
    const profile = { grass, dirt: null, sand: null, rock: null, field: null };
    const library = {
      loadProfile: vi.fn(async () => profile),
      dispose: vi.fn(),
    };
    const createLibrary = vi.fn(async () => library);
    const firstMaterial = makeMaterial();
    const secondMaterial = makeMaterial();

    const [first, second] = await Promise.all([
      bindTerrainAssetProfile(firstMaterial, scene, 'overworld', { createLibrary }),
      bindTerrainAssetProfile(secondMaterial, scene, 'overworld', { createLibrary }),
    ]);

    expect(first).toBe(profile);
    expect(second).toBe(profile);
    expect(createLibrary).toHaveBeenCalledTimes(1);
    expect(library.loadProfile).toHaveBeenCalledTimes(2);
    expect(firstMaterial._terrainPlugin.setAssetProfile).toHaveBeenCalledWith(profile);
    expect(secondMaterial._terrainPlugin.setAssetProfile).toHaveBeenCalledWith(profile);
    expect(firstMaterial.markDirty).toHaveBeenCalledTimes(1);
    expect(secondMaterial.markDirty).toHaveBeenCalledTimes(1);

    scene.disposeAssets();
    expect(library.dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps procedural terrain active when manifest or texture loading fails', async () => {
    const scene = makeScene();
    const material = makeMaterial();
    const error = new Error('network unavailable');
    const logger = { warn: vi.fn() };

    const result = await bindTerrainAssetProfile(material, scene, 'overworld', {
      createLibrary: vi.fn(async () => { throw error; }),
      logger,
    });

    expect(result).toBeNull();
    expect(material._terrainPlugin.setAssetProfile).not.toHaveBeenCalled();
    expect(material.markDirty).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/keeping procedural terrain/),
      error,
    );
  });

  it('rejects invalid library factories and clears the scene cache for a retry', async () => {
    const scene = makeScene();
    const invalidFactory = vi.fn(async () => ({}));

    await expect(getTerrainAssetLibraryForScene(scene, {
      createLibrary: invalidFactory,
    })).rejects.toThrow(/invalid terrain asset library/);

    const library = { loadProfile: vi.fn(), dispose: vi.fn() };
    const validFactory = vi.fn(async () => library);
    await expect(getTerrainAssetLibraryForScene(scene, {
      createLibrary: validFactory,
    })).resolves.toBe(library);
    expect(validFactory).toHaveBeenCalledTimes(1);
  });
});
