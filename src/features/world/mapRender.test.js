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

describe('locationLabelAt — dungeon resolves to the nearest interior (the label bug)', () => {
  it('names the actual dungeon by nearest interior x, not always Hollow Deep', () => {
    const wg = baseWorldgen();
    expect(locationLabelAt(wg, 1000, 0, { inDungeon: true })).toBe('The Hollow Crypt');
    expect(locationLabelAt(wg, 1300, 0, { inDungeon: true })).toBe('The Frostspire Halls');
    expect(locationLabelAt(wg, 840, 0, { inDungeon: true })).toBe('Castle Ashwood');
    // a small offset from the anchor still resolves the same dungeon
    expect(locationLabelAt(wg, 1290, 4, { inDungeon: true })).toBe('The Frostspire Halls');
  });

  it('falls back to "Dungeon" when no interiors are configured', () => {
    const wg = baseWorldgen();
    wg.config.interiors = {};
    expect(locationLabelAt(wg, 1000, 0, { inDungeon: true })).toBe('Dungeon');
  });
});

describe('locationLabelAt — geographic priority (dungeon > lake > mountain > forest > biome)', () => {
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

  it('dungeon wins over everything when inDungeon is set', () => {
    const wg = baseWorldgen();
    wg.inMountain = () => true; // even on the mountain, inDungeon short-circuits
    expect(locationLabelAt(wg, 1000, 0, { inDungeon: true })).toBe('The Hollow Crypt');
  });

  it('an absent worldgen returns an empty string', () => {
    expect(locationLabelAt(null, 0, 0)).toBe('');
  });
});
