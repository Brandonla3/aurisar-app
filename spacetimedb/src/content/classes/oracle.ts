// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/classes/oracle.ts
// Regenerate with: npm run sync:content

/**
 * Oracle — Mage-style kit reflavor: arcane/frost precision casting
 * ("Precision Metrics" → calculated magic) (plan §6).
 * P0 skeleton: 2 starter abilities. Full kit lands in P3b.
 */
import type { AbilityDef, ClassKitDef } from '../types';

export const KIT: ClassKitDef = {
  classId: 'oracle',
  resource: 'mana',
  usesComboPoints: false,
  baseHp: 45,
  hpPerLevel: 8,
  baseResource: 90,
  resourcePerLevel: 16,
  abilityIds: ['oracle_arcane_lance', 'oracle_frost_ward'],
};

export const ABILITIES: AbilityDef[] = [
  {
    id: 'oracle_arcane_lance',
    classId: 'oracle',
    name: 'Arcane Lance',
    school: 'arcane',
    cost: 14,
    castTimeSec: 1.5,
    cooldownSec: 0,
    rangeM: 30,
    triggersGcd: true,
    effects: [{ kind: 'directDamage', min: 8, max: 13 }],
    ranks: [{ level: 8, magnitudeMult: 1.6 }, { level: 16, magnitudeMult: 2.4 }],
    minLevel: 1,
    description: 'A calculated lance of arcane force.',
  },
  {
    id: 'oracle_frost_ward',
    classId: 'oracle',
    name: 'Frost Ward',
    school: 'frost',
    cost: 16,
    castTimeSec: 0,
    cooldownSec: 30,
    rangeM: 0,
    triggersGcd: true,
    effects: [{ kind: 'absorb', amount: 25, durationSec: 30 }],
    ranks: [{ level: 8, magnitudeMult: 1.6 }, { level: 16, magnitudeMult: 2.4 }],
    minLevel: 4,
    description: 'A predictive ward of frost absorbs incoming damage.',
  },
];
