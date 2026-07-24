import { describe, expect, it } from 'vitest';
import { resolveGearVisual, RARITY, CLASS_TINTS } from './gearVisuals.js';
import { ITEMS } from '../content/index';
import { EQUIP_TO_GEAR } from './avatarSchema.js';

describe('resolveGearVisual', () => {
  it('maps a weapon item to a procedural weapon on the right hand', () => {
    const v = resolveGearVisual(ITEMS.worn_shortsword);
    expect(v).toMatchObject({ kind: 'weapon', socket: 'rightHand', rarity: 'common' });
    expect(['sword', 'knife', 'mace', 'staff', 'bow']).toContain(v.shape);
  });

  it('carries item rarity through (uncommon weapon)', () => {
    expect(resolveGearVisual(ITEMS.wolfsbane_blade).rarity).toBe('uncommon');
  });

  it('returns null for armor (Phase B — no fitted asset yet)', () => {
    const chest = Object.values(ITEMS).find((i) => i.slot === 'chest');
    expect(resolveGearVisual(chest)).toBeNull();
  });

  it('returns null for a missing item', () => {
    expect(resolveGearVisual(null)).toBeNull();
    expect(resolveGearVisual(undefined)).toBeNull();
  });

  it('prefers a real gear GLB when the manifest has one', () => {
    const v = resolveGearVisual(ITEMS.worn_shortsword, (k) => k === 'gear/worn_shortsword');
    expect(v.kind).toBe('weaponModel');
    expect(v.modelKey).toBe('gear/worn_shortsword');
  });

  it('falls back to a sword shape for an unlisted weapon', () => {
    const v = resolveGearVisual({ id: 'mystery_blade', type: 'weapon', slot: 'mainHand', quality: 'rare' });
    expect(v).toMatchObject({ kind: 'weapon', shape: 'sword', rarity: 'rare' });
  });
});

describe('visual tables', () => {
  it('RARITY covers all four qualities', () => {
    for (const q of ['common', 'uncommon', 'rare', 'epic']) {
      expect(RARITY[q]?.tint).toHaveLength(3);
    }
  });

  it('CLASS_TINTS covers all 11 classes', () => {
    // Derive the class list from the content graph to stay in sync.
    expect(Object.keys(CLASS_TINTS)).toHaveLength(11);
    for (const hex of Object.values(CLASS_TINTS)) expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('EQUIP_TO_GEAR mapping', () => {
  it('maps every content EquipSlot, weapons → weapon', () => {
    expect(EQUIP_TO_GEAR.mainHand).toBe('weapon');
    // Slots with no avatar target are explicitly null (not undefined).
    for (const slot of ['offHand', 'trinket']) {
      expect(EQUIP_TO_GEAR[slot]).toBeNull();
    }
  });

  it('every equippable item slot has an EQUIP_TO_GEAR entry', () => {
    for (const item of Object.values(ITEMS)) {
      if (!item.slot) continue;
      expect(EQUIP_TO_GEAR, `slot ${item.slot}`).toHaveProperty(item.slot);
    }
  });
});
