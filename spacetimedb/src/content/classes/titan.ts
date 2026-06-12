// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/classes/titan.ts
// Regenerate with: npm run sync:content

/**
 * Titan — derived Warrior-tank variant: shield wall / taunt / last stand
 * identity for dungeons (plan §6). Locked class (unlocks fitness-side).
 * P0 skeleton: 2 starter abilities. Full kit lands in P3b.
 */
import type { AbilityDef, ClassKitDef } from '../types';

export const KIT: ClassKitDef = {
  classId: 'titan',
  resource: 'rage',
  usesComboPoints: false,
  baseHp: 65,
  hpPerLevel: 13,
  baseResource: 100,
  resourcePerLevel: 0,
  abilityIds: ['titan_crushing_blow', 'titan_immovable'],
};

export const ABILITIES: AbilityDef[] = [
  {
    id: 'titan_crushing_blow',
    classId: 'titan',
    name: 'Crushing Blow',
    school: 'physical',
    cost: 20,
    castTimeSec: 0,
    cooldownSec: 6,
    rangeM: 3,
    triggersGcd: true,
    effects: [{ kind: 'weaponStrike', bonusDamage: 8 }],
    ranks: [{ level: 8, magnitudeMult: 1.6 }, { level: 16, magnitudeMult: 2.4 }],
    minLevel: 1,
    description: 'An immense blow that staggers the target.',
  },
  {
    id: 'titan_immovable',
    classId: 'titan',
    name: 'Immovable',
    school: 'physical',
    cost: 10,
    castTimeSec: 0,
    cooldownSec: 120,
    rangeM: 0,
    triggersGcd: false,
    effects: [{ kind: 'selfBuff', stat: 'armor', amount: 60, durationSec: 12 }],
    minLevel: 4,
    description: 'Plant your feet — briefly become a fortress.',
  },
];
