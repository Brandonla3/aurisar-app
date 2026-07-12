import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalBabylon = globalThis.BABYLON;
let createTerrainMaterial;

class FakeMaterialPluginBase {
  constructor(material) {
    this._material = material;
    this.markAllDefinesAsDirty = vi.fn();
  }

  _enable() {}
}

class FakePBRMaterial {
  constructor(name, scene) {
    this.name = name;
    this.scene = scene;
    this.markDirty = vi.fn();
  }
}

beforeEach(async () => {
  vi.resetModules();
  globalThis.BABYLON = {
    MaterialPluginBase: FakeMaterialPluginBase,
    PBRMaterial: FakePBRMaterial,
  };
  ({ createTerrainMaterial } = await import('./terrainMaterial.js'));
});

afterEach(() => {
  globalThis.BABYLON = originalBabylon;
  vi.restoreAllMocks();
});

function makeGrassSet() {
  return {
    id: 'overworld-meadow-grass-01',
    definition: { tileMeters: 2.1 },
    baseColor: { name: 'baseColor' },
    normal: { name: 'normal' },
    orm: { name: 'orm' },
    height: null,
  };
}

describe('terrainMaterial scanned grass integration', () => {
  it('enables scanned samplers and binds world-scale PBR maps after a profile loads', () => {
    const material = createTerrainMaterial({ metadata: {} }, { loadAssets: false });
    const grass = makeGrassSet();

    expect(material._terrainPlugin.setAssetProfile({ grass })).toBe(true);
    expect(material._terrainPlugin.markAllDefinesAsDirty).toHaveBeenCalledTimes(1);

    const defines = {};
    material._terrainPlugin.prepareDefines(defines);
    expect(defines.TERR_SCANNED_GRASS).toBe(true);

    const samplers = [];
    material._terrainPlugin.getSamplers(samplers);
    expect(samplers).toEqual([
      'uTerrGrassBaseColor',
      'uTerrGrassNormal',
      'uTerrGrassOrm',
    ]);

    const activeTextures = [];
    material._terrainPlugin.getActiveTextures(activeTextures);
    expect(activeTextures).toEqual([grass.baseColor, grass.normal, grass.orm]);
    expect(material._terrainPlugin.hasTexture(grass.normal)).toBe(true);

    const uniformBuffer = {
      updateFloat: vi.fn(),
      setTexture: vi.fn(),
    };
    material._terrainPlugin.bindForSubMesh(uniformBuffer);
    expect(uniformBuffer.updateFloat).toHaveBeenCalledWith('uTerrGrassTileMeters', 2.1);
    expect(uniformBuffer.setTexture).toHaveBeenCalledWith('uTerrGrassBaseColor', grass.baseColor);
    expect(uniformBuffer.setTexture).toHaveBeenCalledWith('uTerrGrassNormal', grass.normal);
    expect(uniformBuffer.setTexture).toHaveBeenCalledWith('uTerrGrassOrm', grass.orm);

    const fragmentCode = material._terrainPlugin.getCustomCode('fragment');
    expect(fragmentCode.CUSTOM_FRAGMENT_BEFORE_LIGHTS).toContain('terrScannedGrassNormalW');
    const pbrHook = Object.keys(fragmentCode).find((key) => key.startsWith('!g!'));
    expect(pbrHook).toMatch(/reflectivityOut/);
    expect(fragmentCode[pbrHook]).toContain('aoOut.ambientOcclusionColor');
  });

  it('starts asset binding asynchronously on high tier and hot-enables the loaded profile', async () => {
    const grass = makeGrassSet();
    const profile = { grass, dirt: null, sand: null, rock: null, field: null };
    const assetBinder = vi.fn(async (material, _scene, profileName) => {
      material._terrainPlugin.setAssetProfile(profile);
      return profile;
    });

    const material = createTerrainMaterial({ metadata: {} }, { assetBinder });
    expect(assetBinder).toHaveBeenCalledWith(material, material.scene, 'overworld', undefined);
    await expect(material._terrainAssetPromise).resolves.toBe(profile);

    const defines = {};
    material._terrainPlugin.prepareDefines(defines);
    expect(defines.TERR_SCANNED_GRASS).toBe(true);
  });

  it('keeps mobile terrain procedural and skips texture acquisition', async () => {
    const assetBinder = vi.fn();
    const material = createTerrainMaterial({ metadata: {} }, {
      tier: 'mobile',
      assetBinder,
    });

    await expect(material._terrainAssetPromise).resolves.toBeNull();
    expect(assetBinder).not.toHaveBeenCalled();

    material._terrainPlugin.setAssetProfile({ grass: makeGrassSet() });
    const defines = {};
    material._terrainPlugin.prepareDefines(defines);
    expect(defines.TERR_SCANNED_GRASS).toBe(false);
  });
});
