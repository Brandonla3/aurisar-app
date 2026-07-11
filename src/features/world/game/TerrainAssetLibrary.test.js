import { describe, expect, it } from 'vitest';
import { validateTerrainAssetManifest } from './TerrainAssetLibrary.js';

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
