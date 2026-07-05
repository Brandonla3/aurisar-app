import { describe, expect, it } from 'vitest';
import { ITEMS } from '../index';

describe('equipment item defs', () => {
  it('quest reward boarhide_gloves is equippable hands armor', () => {
    const gloves = ITEMS.boarhide_gloves;
    expect(gloves).toBeTruthy();
    expect(gloves.type).toBe('armor');
    expect(gloves.slot).toBe('hands');
    expect(gloves.stack).toBe(1);
  });

  it('vendor weapons and armor declare equip slots', () => {
    for (const id of ['arming_sword', 'chain_vest', 'marshals_blade', 'militia_vest']) {
      const item = ITEMS[id];
      expect(item, id).toBeTruthy();
      expect(['weapon', 'armor']).toContain(item.type);
      expect(item.slot).toBeTruthy();
      expect(item.stack).toBe(1);
    }
  });
});
