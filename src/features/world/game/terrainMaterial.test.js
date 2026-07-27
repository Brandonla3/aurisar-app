import { beforeAll, describe, expect, it } from 'vitest';

/**
 * terrainMaterial.js declares `class TerrainSplatPlugin extends
 * BABYLON.MaterialPluginBase` at module scope, so the global has to exist before
 * the module is even evaluated. A stub base class is enough — these tests only
 * exercise the pure row-resolution logic, never the plugin itself.
 */
let resolveTerrainTierKey;

beforeAll(async () => {
  globalThis.BABYLON = { MaterialPluginBase: class {} };
  ({ resolveTerrainTierKey } = await import('./terrainMaterial.js'));
});

const scene = (ashwood) => ({ metadata: { ashwood } });

describe('resolveTerrainTierKey', () => {
  // Regression. ashwoodTileProvider is the ONLY production caller, and it used
  // to pass `tier: qualityTier`, which won the precedence chain and made the
  // "Terrain detail" control dead on every streamed tile — saveable, stageable,
  // Appliable, and completely ignored. These call it the way production does.
  it('honours the player setting when called with no opts, as the tile provider does', () => {
    expect(resolveTerrainTierKey(scene({ qualityTier: 'high', gfx: { terrainDetail: 'low' } })))
      .toBe('mobile');
    expect(resolveTerrainTierKey(scene({ qualityTier: 'high', gfx: { terrainDetail: 'medium' } })))
      .toBe('low');
    expect(resolveTerrainTierKey(scene({ qualityTier: 'high', gfx: { terrainDetail: 'high' } })))
      .toBe('high');
  });

  it('lets the setting pick a HEAVIER row than the tier only because clamping already ran', () => {
    // gfx.terrainDetail is the resolved, already-clamped value — resolveGraphicsSettings
    // guarantees it can never exceed the tier ceiling, so this function does not
    // re-check it and must not second-guess what it is handed.
    expect(resolveTerrainTierKey(scene({ qualityTier: 'mobile', gfx: { terrainDetail: 'high' } })))
      .toBe('high');
  });

  it('falls back to the scene tier when no setting is resolved', () => {
    expect(resolveTerrainTierKey(scene({ qualityTier: 'low' }))).toBe('low');
    expect(resolveTerrainTierKey(scene({ qualityTier: 'mobile' }))).toBe('mobile');
  });

  it('falls back to high with no metadata at all', () => {
    expect(resolveTerrainTierKey(scene({}))).toBe('high');
    expect(resolveTerrainTierKey(null)).toBe('high');
    expect(resolveTerrainTierKey(undefined, {})).toBe('high');
  });

  it('still lets an explicit opts.tier win, for the dev viewer', () => {
    const s = scene({ qualityTier: 'high', gfx: { terrainDetail: 'low' } });
    expect(resolveTerrainTierKey(s, { tier: 'high' })).toBe('high');
    expect(resolveTerrainTierKey(s, { tier: 'low' })).toBe('low');
  });

  it('rejects an unknown row rather than returning an undefined shader config', () => {
    expect(resolveTerrainTierKey(scene({ qualityTier: 'nonsense' }))).toBe('high');
    expect(resolveTerrainTierKey(scene({}), { tier: 'ultra' })).toBe('high');
  });
});
