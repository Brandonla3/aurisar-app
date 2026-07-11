import { describe, expect, it, vi } from 'vitest';
import { TerrainAssetLibrary, validateTerrainAssetManifest } from './TerrainAssetLibrary.js';

function emptyManifest() {
  return {
    version: 1,
    sets: {},
    profiles: {
      overworld: {
        grass: null,
        dirt: null,
        sand: null,
        rock: null,
        field: null,
      },
    },
  };
}

function manifestWithLoam() {
  const manifest = emptyManifest();
  manifest.sets.loam = {
    maps: {
      baseColor: '/assets/terrain/loam/basecolor.jpg',
      normal: '/assets/terrain/loam/normal.png',
      orm: '/assets/terrain/loam/orm.png',
    },
  };
  manifest.profiles.overworld.dirt = 'loam';
  return manifest;
}

describe('validateTerrainAssetManifest', () => {
  it('accepts an empty procedural-fallback manifest', () => {
    const manifest = emptyManifest();
    expect(validateTerrainAssetManifest(manifest)).toBe(manifest);
  });

  it('rejects a profile that references a missing set', () => {
    const manifest = emptyManifest();
    manifest.profiles.overworld.rock = 'missing-rock';
    expect(() => validateTerrainAssetManifest(manifest)).toThrow(/unknown rock set/);
  });

  it('requires base color, normal, and ORM maps', () => {
    const manifest = emptyManifest();
    manifest.sets.loam = {
      maps: {
        baseColor: '/assets/terrain/loam/basecolor.jpg',
        normal: '/assets/terrain/loam/normal.png',
      },
    };
    manifest.profiles.overworld.dirt = 'loam';
    expect(() => validateTerrainAssetManifest(manifest)).toThrow(/maps\.orm/);
  });
});

describe('TerrainAssetLibrary', () => {
  it('disposes textures that finish loading after the library is disposed', async () => {
    const originalBabylon = globalThis.BABYLON;
    const pending = [];
    const disposed = [];

    class FakeTexture {
      static TRILINEAR_SAMPLINGMODE = 0;
      static WRAP_ADDRESSMODE = 1;

      constructor(url, _scene, _noMipmap, _invertY, _samplingMode, onLoad) {
        this.url = url;
        this.dispose = vi.fn(() => disposed.push(url));
        pending.push(onLoad);
      }
    }

    globalThis.BABYLON = { Texture: FakeTexture };

    try {
      const library = new TerrainAssetLibrary({}, manifestWithLoam());
      const promise = library.loadSet('loam');

      library.dispose();
      for (const onLoad of pending) onLoad();

      await expect(promise).resolves.toBeNull();
      expect(library.getLoadedSet('loam')).toBeNull();
      expect(disposed).toEqual([
        '/assets/terrain/loam/basecolor.jpg',
        '/assets/terrain/loam/normal.png',
        '/assets/terrain/loam/orm.png',
      ]);
    } finally {
      globalThis.BABYLON = originalBabylon;
    }
  });
});