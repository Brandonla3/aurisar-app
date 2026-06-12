// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/classes/tempest.ts
// Regenerate with: npm run sync:content

/**
 * Tempest — Shaman-style kit reflavor: storm shocks + tide heals (plan §6).
 * Totems (short-lived buff entities) land with the full kit in P3b.
 * P0 skeleton: 2 starter abilities.
 */
import type { AbilityDef, ClassKitDef } from '../types';

export const KIT: ClassKitDef = {
  classId: 'tempest',
  resource: 'mana',
  usesComboPoints: false,
  baseHp: 48,
  hpPerLevel: 9,
  baseResource: 80,
  resourcePerLevel: 14,
  abilityIds: ['tempest_storm_bolt', 'tempest_renewing_tide'],
};

export const ABILITIES: AbilityDef[] = [
  {
    id: 'tempest_storm_bolt',
    classId: 'tempest',
    name: 'Storm Bolt',
    school: 'nature',
    cost: 14,
    castTimeSec: 2,
    cooldownSec: 0,
    rangeM: 30,
    triggersGcd: true,
    effects: [{ kind: 'directDamage', min: 7, max: 11 }],
    ranks: [{ level: 8, magnitudeMult: 1.6 }, { level: 16, magnitudeMult: 2.4 }],
    minLevel: 1,
    description: 'Hurls a crackling bolt of storm energy.',
  },
  {
    id: 'tempest_renewing_tide',
    classId: 'tempest',
    name: 'Renewing Tide',
    school: 'nature',
    cost: 18,
    castTimeSec: 2.5,
    cooldownSec: 0,
    rangeM: 30,
    triggersGcd: true,
    effects: [{ kind: 'heal', min: 12, max: 18 }],
    ranks: [{ level: 8, magnitudeMult: 1.6 }, { level: 16, magnitudeMult: 2.4 }],
    minLevel: 4,
    description: 'A wave of restoring water mends the target.',
  },
];
