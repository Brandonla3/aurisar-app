import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const originalBabylon = globalThis.BABYLON;
let createTerrainMaterial;
let createTerrainMaterialSet;
let setTerrainDebugMode;

class FakeColor3 {
  constructor(r = 0, g = 0, b = 0) {
    this.r = r;
    this.g = g;
    this.b = b;
  }

  static FromHexString(hex) {
    const clean = hex.replace('#', '');
    const value = Number.parseInt(clean, 16);
    return new FakeColor3(
      ((value >> 16) & 255) / 255,
      ((value >> 8) & 255) / 255,
      (value & 255) / 255,
    );
  }
}

class FakeStandardMaterial {
  constructor(name, scene) {
    this.name = name;
    this.scene = scene;
    this.backFaceCulling = null;
    this.disableLighting = null;
  }
}

beforeEach(async () => {
  vi.resetModules();
  globalThis.BABYLON = {
    Color3: FakeColor3,
    StandardMaterial: FakeStandardMaterial,
  };
  ({
    createTerrainMaterial,
    createTerrainMaterialSet,
    setTerrainDebugMode,
  } = await import('./terrainMaterial.js'));
});

afterEach(() => {
  globalThis.BABYLON = originalBabylon;
  vi.restoreAllMocks();
});

describe('terrainMaterial desktop stability fallback', () => {
  it('creates a stock StandardMaterial without custom terrain plugin hooks', async () => {
    const scene = { metadata: { ashwood: { qualityTier: 'high' } } };
    const assetBinder = vi.fn();
    const material = createTerrainMaterial(scene, { assetBinder });

    expect(material).toBeInstanceOf(FakeStandardMaterial);
    expect(material.name).toBe('ashwood_ground_overworld');
    expect(material.scene).toBe(scene);
    expect(material.specularColor).toEqual(new FakeColor3(0, 0, 0));
    expect(material.backFaceCulling).toBe(true);
    expect(material.disableLighting).toBe(false);

    expect(material._terrainPreset).toBe('overworld');
    expect(material._terrainPlugin).toBeNull();
    await expect(material._terrainAssetPromise).resolves.toBeNull();
    expect(assetBinder).not.toHaveBeenCalled();
  });

  it('retains preset-specific material names for scene-level material sets', () => {
    const set = createTerrainMaterialSet({ metadata: {} });

    expect(Object.keys(set)).toEqual([
      'overworld',
      'mountain',
      'forest',
      'castle',
      'dungeon',
    ]);
    expect(set.overworld.name).toBe('ashwood_ground_overworld');
    expect(set.mountain.name).toBe('ashwood_ground_mountain');
    expect(set.forest.name).toBe('ashwood_ground_forest');
    expect(set.castle.name).toBe('ashwood_ground_castle');
    expect(set.dungeon.name).toBe('ashwood_ground_dungeon');
  });

  it('keeps the debug hook as a no-op compatibility field', () => {
    const material = createTerrainMaterial({ metadata: {} });

    setTerrainDebugMode(material, 3);

    expect(material._terrainDebugMode).toBe(3);
    expect(material._terrainPlugin).toBeNull();
  });
});
