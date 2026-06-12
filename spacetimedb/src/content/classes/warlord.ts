// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/classes/warlord.ts
// Regenerate with: npm run sync:content

/**
 * Warlord — battle-leader support kit (Priest-style reflavor): rallies and
 * banners instead of prayers (plan §6). Class display name comes from
 * CLASSES['warlord'].name in src/data/exercises.js — renaming is one edit.
 * P0 skeleton: 2 starter abilities. Full kit lands in P3b.
 */
import type { AbilityDef, ClassKitDef } from '../types';

export const KIT: ClassKitDef = {
  classId: 'warlord',
  resource: 'mana',
  usesComboPoints: false,
  baseHp: 48,
  hpPerLevel: 9,
  baseResource: 85,
  resourcePerLevel: 15,
  abilityIds: ['warlord_rally', 'warlord_war_banner'],
};

export const ABILITIES: AbilityDef[] = [
  {
    id: 'warlord_rally',
    classId: 'warlord',
    name: 'Rally',
    school: 'holy',
    cost: 16,
    castTimeSec: 2,
    cooldownSec: 0,
    rangeM: 30,
    triggersGcd: true,
    effects: [{ kind: 'heal', min: 10, max: 16 }],
    ranks: [{ level: 8, magnitudeMult: 1.6 }, { level: 16, magnitudeMult: 2.4 }],
    minLevel: 1,
    description: 'A commanding rally that restores an ally’s strength.',
  },
  {
    id: 'warlord_war_banner',
    classId: 'warlord',
    name: 'War Banner',
    school: 'holy',
    cost: 14,
    castTimeSec: 0,
    cooldownSec: 0,
    rangeM: 30,
    triggersGcd: true,
    effects: [{ kind: 'buffTarget', stat: 'attackPower', amount: 8, durationSec: 300 }],
    minLevel: 4,
    description: 'Plants your banner in an ally’s spirit, raising their attack power.',
  },
];
