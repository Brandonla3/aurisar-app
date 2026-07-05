import { describe, expect, it } from 'vitest';
import { CHEST_LOOT, rollChestLoot } from '../formulas/chestLoot';

describe('chest loot rolls', () => {
  it('rollChestLoot is deterministic for a fixed seed', () => {
    expect(rollChestLoot(12345)).toEqual(rollChestLoot(12345));
  });

  it('always yields at least one drop', () => {
    for (const seed of [0, 1, 99, 0xdeadbeef]) {
      const rolled = rollChestLoot(seed);
      expect(rolled.length).toBeGreaterThan(0);
      for (const drop of rolled) {
        expect(drop.qty).toBeGreaterThan(0);
        expect(CHEST_LOOT.some((e) => e.id === drop.itemId) || drop.itemId === 'coin').toBe(true);
      }
    }
  });

  it('includes wood in the loot table', () => {
    expect(CHEST_LOOT.some((e) => e.id === 'wood')).toBe(true);
  });
});
