// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/items/consumables.ts
// Regenerate with: npm run sync:content

/**
 * items/consumables.ts — ingredients, foods, and misc carryovers.
 *
 * The forage/cooked ids (berry, mushroom, …, herbTonic) are IDENTICAL to
 * the legacy client catalog in src/features/world/game/items.js so the
 * P4 localStorage→server migration maps 1:1. 'coin' survives as a misc
 * item only for migration — the reducer converts coin stacks to copper.
 */
import type { ItemDef } from '../types';

export const CONSUMABLES: ItemDef[] = [
  // ── Ingredients (foraged) ──────────────────────────────────────────
  { id: 'berry',    name: 'Wild Berries',  icon: '🫐', type: 'ingredient', stack: 99, quality: 'common', vendorPriceCopper: 4 },
  { id: 'mushroom', name: 'Cave Mushroom', icon: '🍄', type: 'ingredient', stack: 99, quality: 'common', vendorPriceCopper: 5 },
  { id: 'herb',     name: 'Wild Herb',     icon: '🌿', type: 'ingredient', stack: 99, quality: 'common', vendorPriceCopper: 5 },
  { id: 'rawMeat',  name: 'Raw Meat',      icon: '🥩', type: 'ingredient', stack: 99, quality: 'common', vendorPriceCopper: 8 },
  { id: 'fish',     name: 'River Fish',    icon: '🐟', type: 'ingredient', stack: 99, quality: 'common', vendorPriceCopper: 8 },
  { id: 'wood',     name: 'Firewood',      icon: '🪵', type: 'ingredient', stack: 99, quality: 'common', vendorPriceCopper: 3 },

  // ── Cooked foods (recipe outputs) ──────────────────────────────────
  { id: 'stew',        name: 'Hearty Stew',  icon: '🍲', type: 'consumable', stack: 20, quality: 'common', heal: 35, vendorPriceCopper: 30 },
  { id: 'berryJam',    name: 'Berry Jam',    icon: '🍯', type: 'consumable', stack: 20, quality: 'common', heal: 15, vendorPriceCopper: 15 },
  { id: 'grilledFish', name: 'Grilled Fish', icon: '🍢', type: 'consumable', stack: 20, quality: 'common', heal: 25, vendorPriceCopper: 22 },
  { id: 'herbTonic',   name: 'Herb Tonic',   icon: '🧪', type: 'consumable', stack: 20, quality: 'common', heal: 20, vendorPriceCopper: 18 },

  // ── Vendor staples ─────────────────────────────────────────────────
  { id: 'baked_bread',  name: 'Baked Bread',  icon: '🍞', type: 'consumable', stack: 20, quality: 'common', heal: 12, vendorPriceCopper: 10 },
  { id: 'spring_water', name: 'Spring Water', icon: '💧', type: 'consumable', stack: 20, quality: 'common', heal: 8,  vendorPriceCopper: 6 },

  // ── Migration-only ─────────────────────────────────────────────────
  { id: 'coin', name: 'Gold Coin', icon: '🪙', type: 'misc', stack: 999, quality: 'common' },
];
