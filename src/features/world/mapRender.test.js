import { describe, it, expect } from 'vitest';
import { locationLabelAt } from './mapRender.js';

// Minimal worldgen stub: locationLabelAt only touches config + the
// inMountain/inForest/biomeAt predicates (no canvas), so it's pure-testable.
const baseWorldgen = () => ({
  config: {
    interiors: {
      ashwoodCastle:   { cx: 840,  cz: 0, name: 'Castle Ashwood' },
      hollowDeep:      { cx: 1000, cz: 0, name: 'The Hollow Crypt' },
      frostspireHalls: { cx: 1300, cz: 0, name: 'The Frostspire Halls' },
    },
    lake: { x: -92, z: 88, waterR: 27, name: 'Stillmere' },
  },
  inMountain: () => false,
  inForest: () => false,
  biomeAt: () => ({ name: 'Meadow' }),
});

describe('locationLabelAt — dungeon gate label', () => {
  // `inDungeon` is set ONLY by proximity to the north dungeon gate at (0,-37)
  // (BabylonWorldScene DUNGEON_ENTRANCE); the castle has its own isInside()
  // path before this. So the label must reflect that gate — NOT the nearest
  // interior anchor by x (Castle Ashwood at cx 840 is nearest to the gate's
  // x≈0, which is the regression this guards against).
  it('names the hub dungeon gate (0,-37) the Hollow Crypt, not Castle Ashwood', () => {
    const wg = baseWorldgen();
    const label = locationLabelAt(wg, 0, -37, { inDungeon: true });
    expect(label).toBe('The Hollow Crypt');
    expect(label).not.toBe('Castle Ashwood');
  });

  it('dungeon wins over overworld geography (even on the mountain)', () => {
    const wg = baseWorldgen();
    wg.inMountain = () => true;
    expect(locationLabelAt(wg, 0, -37, { inDungeon: true })).toBe('The Hollow Crypt');
  });

  it('falls back to "Dungeon" when hollowDeep is absent', () => {
    const wg = baseWorldgen();
    delete wg.config.interiors.hollowDeep;
    expect(locationLabelAt(wg, 0, -37, { inDungeon: true })).toBe('Dungeon');
  });
});

describe('locationLabelAt — geographic priority (lake > mountain > forest > biome)', () => {
  it('lake by proximity to the water', () => {
    const wg = baseWorldgen();
    expect(locationLabelAt(wg, -92, 88)).toBe('Stillmere');           // at the lake center
    expect(locationLabelAt(wg, 8, 88)).not.toBe('Stillmere');         // 100 m away
  });

  it('mountain, then forest, then biome, then the final fallback', () => {
    const wg = baseWorldgen();
    wg.inMountain = () => true;
    expect(locationLabelAt(wg, 0, 0)).toBe('The Mountain');
    wg.inMountain = () => false; wg.inForest = () => true;
    expect(locationLabelAt(wg, 0, 0)).toBe('Wildwood');
    wg.inForest = () => false;
    expect(locationLabelAt(wg, 0, 0)).toBe('Meadow');                 // biome name
    wg.biomeAt = () => null;
    expect(locationLabelAt(wg, 0, 0)).toBe('The Wilds');              // final fallback
  });

  it('an absent worldgen returns an empty string', () => {
    expect(locationLabelAt(null, 0, 0)).toBe('');
  });
});
