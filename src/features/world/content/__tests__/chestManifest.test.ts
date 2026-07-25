import { describe, expect, it } from 'vitest';
import { WORLD_CHESTS } from '../world/chestManifest.generated';
// eslint-disable-next-line -- JS module without types
import { chestKey } from '../../worldgen/sites.js';

describe('world chest manifest', () => {
  it('has well-formed entries', () => {
    expect(WORLD_CHESTS.length).toBeGreaterThan(0);
    for (const chest of WORLD_CHESTS) {
      expect(typeof chest.seed).toBe('number');
      expect(Number.isFinite(chest.x)).toBe(true);
      expect(Number.isFinite(chest.z)).toBe(true);
    }
  });

  // Ids used to be array indices, so any worldgen edit that re-indexed the
  // manifest silently remapped every player's persisted playerChestOpened
  // history. They are now derived from the chest's own position and seed.
  it('ids are position-derived, not array indices', () => {
    for (const chest of WORLD_CHESTS) {
      expect(chest.id).toBe(chestKey(chest.x, chest.z, chest.seed));
    }
    // Guard against a regression to the old scheme.
    const looksIndexed = WORLD_CHESTS.every((c, i) => c.id === i);
    expect(looksIndexed, 'ids regressed to array indices').toBe(false);
  });

  it('ids are unique and fit the u32 the server persists', () => {
    const ids = new Set(WORLD_CHESTS.map((c) => c.id));
    expect(ids.size).toBe(WORLD_CHESTS.length);
    for (const c of WORLD_CHESTS) {
      expect(Number.isInteger(c.id)).toBe(true);
      expect(c.id).toBeGreaterThanOrEqual(0);
      expect(c.id).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it('ids survive a re-index — the property the old scheme lacked', () => {
    // Simulate an exclusion zone removing the first two chests.
    const survivors = WORLD_CHESTS.slice(2);
    for (const c of survivors) {
      expect(chestKey(c.x, c.z, c.seed)).toBe(c.id);
    }
  });
});
