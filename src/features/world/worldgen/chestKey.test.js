/**
 * chestKey — the stability property that makes chest identity survive a
 * worldgen edit.
 *
 * The old scheme was `id: index`, assigned after the exclusion post-filter and
 * persisted forever in `playerChestOpened.chestId`. Adding a single exclusion
 * zone shifted every later chest's index by one, silently remapping every
 * player's looted-chest history onto different chests with no error anywhere.
 *
 * These tests pin the properties that fix it. The cutover (emitter + client +
 * server reading these keys, with the one announced reset) lands with the
 * worldgen reshuffle so players see exactly one chest restock — see
 * worldgen/DETERMINISM.md and docs/world-design-plan.md Batch D.
 */
import { describe, expect, it } from 'vitest';
import { chestKey } from './sites.js';

describe('chestKey', () => {
  it('is a stable u32 for the same position + seed', () => {
    const a = chestKey(12.34, -56.78, 0xdeadbeef);
    const b = chestKey(12.34, -56.78, 0xdeadbeef);
    expect(a).toBe(b);
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0xffffffff);
  });

  it('is independent of array position — the whole point', () => {
    // Simulate an exclusion zone removing an earlier chest: every later chest
    // shifts index, but its key is unchanged because its position is unchanged.
    const chests = [
      { x: 10, z: 10, seed: 1 },
      { x: -40, z: 22, seed: 2 },
      { x: 88, z: -13, seed: 3 },
    ];
    const before = chests.map((c) => chestKey(c.x, c.z, c.seed));
    const after = chests.slice(1).map((c) => chestKey(c.x, c.z, c.seed));
    expect(after).toEqual(before.slice(1));
  });

  it('changes when the chest actually moves or is reseeded', () => {
    const base = chestKey(10, 10, 7);
    expect(chestKey(10.5, 10, 7)).not.toBe(base); // moved
    expect(chestKey(10, 10.5, 7)).not.toBe(base);
    expect(chestKey(10, 10, 8)).not.toBe(base);   // regenerated
  });

  it('quantizes to 0.1 m so float noise cannot shift a key', () => {
    // The same chest reconstructed with a hair of FP error must key the same.
    expect(chestKey(10.000000001, -3.999999999, 5)).toBe(chestKey(10, -4, 5));
    // But a real 0.1 m move is still distinguishable.
    expect(chestKey(10.1, -4, 5)).not.toBe(chestKey(10, -4, 5));
  });

  it('is collision-free across the live chest manifest', async () => {
    const { WORLD_CHESTS } = await import('../content/world/chestManifest.generated');
    const keys = new Set(WORLD_CHESTS.map((c) => chestKey(c.x, c.z, c.seed)));
    expect(keys.size).toBe(WORLD_CHESTS.length);
  });
});
