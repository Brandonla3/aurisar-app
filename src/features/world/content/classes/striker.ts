/**
 * Striker — derived Rogue-burst variant: unarmed combo brawler (plan §6).
 * Locked class (unlocks fitness-side).
 * P0 skeleton: builder + finisher. Full kit lands in P3b.
 */
import type { AbilityDef, ClassKitDef } from '../types';

export const KIT: ClassKitDef = {
  classId: 'striker',
  resource: 'energy',
  usesComboPoints: true,
  baseHp: 52,
  hpPerLevel: 10,
  baseResource: 100,
  resourcePerLevel: 0,
  abilityIds: ['striker_jab', 'striker_haymaker'],
};

export const ABILITIES: AbilityDef[] = [
  {
    id: 'striker_jab',
    classId: 'striker',
    name: 'Jab',
    school: 'physical',
    cost: 30,
    castTimeSec: 0,
    cooldownSec: 0,
    rangeM: 3,
    triggersGcd: true,
    combo: { builds: 1 },
    effects: [{ kind: 'weaponStrike', bonusDamage: 3 }],
    ranks: [{ level: 8, magnitudeMult: 1.6 }, { level: 16, magnitudeMult: 2.4 }],
    minLevel: 1,
    description: 'A lightning-fast jab. Awards 1 combo point.',
  },
  {
    id: 'striker_haymaker',
    classId: 'striker',
    name: 'Haymaker',
    school: 'physical',
    cost: 35,
    castTimeSec: 0,
    cooldownSec: 0,
    rangeM: 3,
    triggersGcd: true,
    combo: { spendsAll: true },
    effects: [{ kind: 'directDamage', min: 10, max: 16 }],
    ranks: [{ level: 8, magnitudeMult: 1.6 }, { level: 16, magnitudeMult: 2.4 }],
    minLevel: 4,
    description: 'An explosive finisher — damage scales with combo points spent.',
  },
];
