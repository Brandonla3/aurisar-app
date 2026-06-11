/**
 * items.js — client-side item catalog for the world's Inventory + Cooking.
 *
 * Pure data, no React. There is no server-side item table; the inventory lives
 * entirely in the browser (see useInventory.js). `heal` is metadata only — real
 * HP is server-authoritative and "eating" is currently cosmetic (a future
 * server reducer would be needed to apply it).
 */

export const ITEMS = {
  berry:      { id: 'berry',      name: 'Wild Berries',   icon: '🫐', type: 'ingredient', stack: 99 },
  mushroom:   { id: 'mushroom',   name: 'Cave Mushroom',  icon: '🍄', type: 'ingredient', stack: 99 },
  herb:       { id: 'herb',       name: 'Wild Herb',      icon: '🌿', type: 'ingredient', stack: 99 },
  rawMeat:    { id: 'rawMeat',    name: 'Raw Meat',       icon: '🥩', type: 'ingredient', stack: 99 },
  fish:       { id: 'fish',       name: 'River Fish',     icon: '🐟', type: 'ingredient', stack: 99 },
  coin:       { id: 'coin',       name: 'Gold Coin',      icon: '🪙', type: 'misc',       stack: 999 },

  // Cooked foods (outputs of recipes)
  stew:       { id: 'stew',       name: 'Hearty Stew',    icon: '🍲', type: 'food', stack: 20, heal: 35 },
  berryJam:   { id: 'berryJam',   name: 'Berry Jam',      icon: '🍯', type: 'food', stack: 20, heal: 15 },
  grilledFish:{ id: 'grilledFish',name: 'Grilled Fish',   icon: '🍢', type: 'food', stack: 20, heal: 25 },
  herbTonic:  { id: 'herbTonic',  name: 'Herb Tonic',     icon: '🧪', type: 'food', stack: 20, heal: 20 },
};

export function getItem(id) {
  return ITEMS[id] ?? null;
}

/**
 * Chest loot table — each entry is rolled independently. `chance` in [0,1],
 * qty inclusive range. Rolled deterministically from the chest seed so every
 * client (and every reload) sees the same loot for a given chest.
 */
export const CHEST_LOOT = [
  { id: 'coin',     chance: 0.90, min: 1, max: 5 },
  { id: 'berry',    chance: 0.55, min: 1, max: 3 },
  { id: 'mushroom', chance: 0.45, min: 1, max: 2 },
  { id: 'herb',     chance: 0.45, min: 1, max: 2 },
  { id: 'rawMeat',  chance: 0.35, min: 1, max: 2 },
  { id: 'fish',     chance: 0.30, min: 1, max: 2 },
];
