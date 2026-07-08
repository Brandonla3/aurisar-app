import { describe, expect, it } from 'vitest';
import { rollMobLoot } from '../formulas/inventory';
import { MOBS as ZONE1_MOBS } from '../zones/zone1/mobs';

describe('inventory loot rolls', () => {
  it('Old Greyjaw always drops greyjaw_fang at seed 1', () => {
    const def = ZONE1_MOBS.find((m) => m.mobType === 'old_greyjaw');
    expect(def).toBeTruthy();
    const { items, copper } = rollMobLoot(def!, 0xdeadbeef);
    expect(items.some((i) => i.itemId === 'greyjaw_fang')).toBe(true);
    expect(copper).toBe(60);
  });

  it('forest wolf loot is deterministic for a fixed seed', () => {
    const def = ZONE1_MOBS.find((m) => m.mobType === 'forest_wolf');
    expect(def).toBeTruthy();
    const a = rollMobLoot(def!, 42);
    const b = rollMobLoot(def!, 42);
    expect(a).toEqual(b);
  });

  it('mob with no loot table yields empty items', () => {
    const def = { mobType: 'test', lootTable: undefined, copperMin: 5, copperMax: 5 };
    const { items, copper } = rollMobLoot(def as any, 1);
    expect(items).toEqual([]);
    expect(copper).toBe(5);
  });
});
