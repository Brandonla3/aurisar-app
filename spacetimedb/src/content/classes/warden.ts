// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/classes/warden.ts
// Regenerate with: npm run sync:content

/**
 * Warden — Hunter-style kit reflavor: ranged + traps, no pets v1 (plan §6).
 * P0 skeleton: 2 starter abilities. Full kit lands in P3b.
 */
import type { AbilityDef, ClassKitDef } from '../types';

export const KIT: ClassKitDef = {
  classId: 'warden',
  resource: 'mana',
  usesComboPoints: false,
  baseHp: 50,
  hpPerLevel: 10,
  baseResource: 70,
  resourcePerLevel: 12,
  abilityIds: ['warden_aimed_shot', 'warden_snare_trap'],
};

export const ABILITIES: AbilityDef[] = [
  {
    id: 'warden_aimed_shot',
    classId: 'warden',
    name: 'Aimed Shot',
    school: 'physical',
    cost: 10,
    castTimeSec: 0,
    cooldownSec: 6,
    rangeM: 30,
    triggersGcd: true,
    effects: [{ kind: 'directDamage', min: 8, max: 12 }],
    ranks: [{ level: 8, magnitudeMult: 1.6 }, { level: 16, magnitudeMult: 2.4 }],
    minLevel: 1,
    description: 'A carefully aimed shot at a distant target.',
  },
  {
    id: 'warden_snare_trap',
    classId: 'warden',
    name: 'Snare Trap',
    school: 'nature',
    cost: 12,
    castTimeSec: 0,
    cooldownSec: 15,
    rangeM: 20,
    triggersGcd: true,
    effects: [{ kind: 'slow', pct: 50, durationSec: 8 }],
    minLevel: 4,
    description: 'Snares the target, slowing its movement.',
  },
];
