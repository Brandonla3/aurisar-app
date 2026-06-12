// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/items/weapons.ts
// Regenerate with: npm run sync:content

/**
 * items/weapons.ts — starter weapon set (placeholder stats; tuning P3/P4).
 * fitnessPerks keys reference exercise ids / muscleGroups / categories
 * from src/data/exercises.js — cross-checked by the integrity test.
 */
import type { ItemDef } from '../types';

export const WEAPONS: ItemDef[] = [
  {
    id: 'worn_shortsword',
    name: 'Worn Shortsword',
    icon: '🗡️',
    type: 'weapon',
    stack: 1,
    quality: 'common',
    slot: 'mainHand',
    gameStats: { weaponDmgMin: 3, weaponDmgMax: 6, weaponSpeedSec: 2.4 },
    vendorPriceCopper: 95,
  },
  {
    id: 'hunting_bow',
    name: 'Hunting Bow',
    icon: '🏹',
    type: 'weapon',
    stack: 1,
    quality: 'common',
    slot: 'mainHand',
    gameStats: { weaponDmgMin: 2, weaponDmgMax: 7, weaponSpeedSec: 2.8 },
    vendorPriceCopper: 110,
  },
  {
    id: 'gnarled_staff',
    name: 'Gnarled Staff',
    icon: '🪄',
    type: 'weapon',
    stack: 1,
    quality: 'common',
    slot: 'mainHand',
    gameStats: { weaponDmgMin: 3, weaponDmgMax: 5, weaponSpeedSec: 3.0, INT: 1 },
    vendorPriceCopper: 105,
  },
  {
    id: 'wolfsbane_blade',
    name: 'Wolfsbane Blade',
    icon: '⚔️',
    type: 'weapon',
    stack: 1,
    quality: 'uncommon',
    slot: 'mainHand',
    gameStats: { weaponDmgMin: 4, weaponDmgMax: 8, weaponSpeedSec: 2.5, STR: 1 },
    fitnessPerks: { categories: { strength: 1.03 } },
    minLevel: 3,
  },
];
