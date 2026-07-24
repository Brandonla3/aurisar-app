import { describe, expect, it } from 'vitest';
import {
  resolveGearVisual, RARITY, buildProceduralWeapon,
} from './gearVisuals.js';
import { ITEMS } from '../content/index';
import { EQUIP_TO_GEAR, GEAR_SLOTS } from './avatarSchema.js';

describe('resolveGearVisual', () => {
  it('maps a weapon item to a procedural weapon on the right hand', () => {
    const v = resolveGearVisual(ITEMS.worn_shortsword);
    expect(v).toMatchObject({ kind: 'weapon', socket: 'rightHand', rarity: 'common', shape: 'sword' });
  });

  it('picks the shape from the item id', () => {
    expect(resolveGearVisual(ITEMS.bronzework_mace)?.shape).toBe('mace');
    expect(resolveGearVisual(ITEMS.hunting_bow)?.shape).toBe('bow');
    expect(resolveGearVisual(ITEMS.gnarled_staff)?.shape).toBe('staff');
    expect(resolveGearVisual(ITEMS.carving_knife)?.shape).toBe('knife');
  });

  it('carries item rarity through (uncommon weapon)', () => {
    expect(resolveGearVisual(ITEMS.wolfsbane_blade).rarity).toBe('uncommon');
  });

  it('returns null for armor (Phase B — no fitted asset yet)', () => {
    const chest = Object.values(ITEMS).find((i) => i.slot === 'chest');
    expect(chest, 'a chest item exists to exercise the armor branch').toBeTruthy();
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
    expect(v.socket).toBe('rightHand');
  });

  it('falls back to a sword shape for an unlisted weapon', () => {
    const v = resolveGearVisual({ id: 'mystery_blade', type: 'weapon', slot: 'mainHand', quality: 'rare' });
    expect(v).toMatchObject({ kind: 'weapon', shape: 'sword', rarity: 'rare' });
  });
});

describe('RARITY table', () => {
  it('covers all four qualities with tint + emissive', () => {
    for (const q of ['common', 'uncommon', 'rare', 'epic']) {
      expect(RARITY[q]?.tint).toHaveLength(3);
      expect(typeof RARITY[q].emissive).toBe('number');
    }
    // Emissive is monotonic non-decreasing with rarity (rare/epic read as lit).
    expect(RARITY.common.emissive).toBe(0);
    expect(RARITY.epic.emissive).toBeGreaterThan(RARITY.rare.emissive);
  });
});

// A lightweight BABYLON mock so the actual mesh builders run in Node (the
// module is deliberately free of top-level BABYLON access for this).
function mockBabylon() {
  const created = [];
  class Color3 { constructor(r, g, b) { Object.assign(this, { r, g, b }); } scale(f) { return new Color3(this.r * f, this.g * f, this.b * f); } }
  class StandardMaterial { constructor(name) { this.name = name; this.disposed = false; created.push({ type: 'mat', name }); } dispose() { this.disposed = true; } }
  const mesh = (type) => (name) => { const m = { name, type, position: { set() {}, y: 0 }, rotation: { z: 0 }, scaling: { x: 1 }, material: null, isPickable: true }; created.push({ type, name }); return m; };
  return {
    created,
    Color3,
    StandardMaterial,
    MeshBuilder: {
      CreateBox: mesh('box'),
      CreateCylinder: mesh('cyl'),
      CreateSphere: mesh('sphere'),
      CreateTorus: mesh('torus'),
    },
    Mesh: { MergeMeshes: (parts) => ({ name: 'merged', parts, material: null, isPickable: true, dispose() {} }) },
  };
}

describe('buildProceduralWeapon', () => {
  const shapes = { sword: 3, knife: 2, mace: 2, staff: 2, bow: 1 }; // expected part counts
  for (const [shape, parts] of Object.entries(shapes)) {
    it(`${shape} builds ${parts} part(s), merged into one mesh with a material`, () => {
      const B = mockBabylon();
      const merged = buildProceduralWeapon(B, {}, { shape, rarity: 'common' }, `test_${shape}`);
      expect(merged, 'a mesh is returned').toBeTruthy();
      expect(merged.material, 'the merged mesh carries the material').toBeTruthy();
      // One StandardMaterial created; `parts` primitive meshes created.
      expect(B.created.filter((c) => c.type === 'mat')).toHaveLength(1);
      const prims = B.created.filter((c) => ['box', 'cyl', 'sphere', 'torus'].includes(c.type));
      expect(prims.length).toBe(parts);
    });
  }

  it('applies the rarity tint (+ emissive for epic) to the material', () => {
    const B = mockBabylon();
    const merged = buildProceduralWeapon(B, {}, { shape: 'sword', rarity: 'epic' }, 'test_epic');
    const [er, eg, eb] = RARITY.epic.tint;
    expect(merged.material.diffuseColor).toMatchObject({ r: er, g: eg, b: eb });
    expect(merged.material.emissiveColor, 'epic weapons emit').toBeTruthy();
  });
});

describe('EQUIP_TO_GEAR mapping', () => {
  it('maps mainHand → weapon and nulls the unsupported slots', () => {
    expect(EQUIP_TO_GEAR.mainHand).toBe('weapon');
    for (const slot of ['offHand', 'trinket']) expect(EQUIP_TO_GEAR[slot]).toBeNull();
  });

  it('every non-null mapping targets a real GEAR_SLOTS member (catches typos)', () => {
    for (const [slot, gearSlot] of Object.entries(EQUIP_TO_GEAR)) {
      if (gearSlot == null) continue;
      expect(GEAR_SLOTS, `${slot} → ${gearSlot}`).toContain(gearSlot);
    }
  });

  it('every equippable item slot has an EQUIP_TO_GEAR entry', () => {
    for (const item of Object.values(ITEMS)) {
      if (!item.slot) continue;
      expect(EQUIP_TO_GEAR, `slot ${item.slot}`).toHaveProperty(item.slot);
    }
  });
});
