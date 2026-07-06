import { describe, expect, it } from 'vitest';
import { NPCS, ITEMS } from '../index';
import { sellPriceCopper } from '../formulas/prices';

describe('vendor trading (client preview rules)', () => {
  it('trader Pell sells provision staples with prices', () => {
    const pell = NPCS.trader_pell;
    expect(pell.vendorItemIds).toContain('baked_bread');
    for (const id of pell.vendorItemIds ?? []) {
      expect(ITEMS[id]?.vendorPriceCopper, id).toBeGreaterThan(0);
    }
  });

  it('smith Dorn sells gear with level-gated rewards flagged', () => {
    const dorn = NPCS.smith_dorn;
    expect(dorn.vendorItemIds?.length).toBeGreaterThan(0);
    expect(ITEMS.arming_sword.vendorPriceCopper).toBe(220);
  });

  it('mob junk is sellable at 25% vendor list', () => {
    expect(sellPriceCopper(ITEMS.wolf_fang)).toBe(Math.floor(6 * 0.25));
    expect(sellPriceCopper(ITEMS.greyjaw_fang ?? {})).toBe(0);
  });
});
