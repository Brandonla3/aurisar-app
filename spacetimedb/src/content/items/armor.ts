// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/items/armor.ts
// Regenerate with: npm run sync:content

/**
 * items/armor.ts — starter armor set (placeholder stats; tuning P4).
 */
import type { ItemDef } from '../types';

export const ARMOR: ItemDef[] = [
  {
    id: 'padded_vest',
    name: 'Padded Vest',
    icon: '🦺',
    type: 'armor',
    stack: 1,
    quality: 'common',
    slot: 'chest',
    gameStats: { armor: 8 },
    vendorPriceCopper: 80,
  },
  {
    id: 'travelers_boots',
    name: "Traveler's Boots",
    icon: '🥾',
    type: 'armor',
    stack: 1,
    quality: 'common',
    slot: 'feet',
    gameStats: { armor: 4 },
    vendorPriceCopper: 55,
  },
  {
    id: 'greyjaw_pelt_cloak',
    name: 'Greyjaw Pelt Cloak',
    icon: '🧥',
    type: 'armor',
    stack: 1,
    quality: 'uncommon',
    slot: 'chest',
    gameStats: { armor: 12, END: 1 },
    fitnessPerks: { categories: { cardio: 1.03 } },
    minLevel: 2,
  },
  {
    id: 'boarhide_gloves',
    name: 'Boarhide Gloves',
    icon: '🧤',
    type: 'armor',
    stack: 1,
    quality: 'uncommon',
    slot: 'hands',
    gameStats: { armor: 5, STR: 1 },
    fitnessPerks: { muscleGroups: { forearm: 1.05 } },
    minLevel: 3,
  },
];
