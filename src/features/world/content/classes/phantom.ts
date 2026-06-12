/**
 * Phantom — Rogue-style kit reflavor: energy + combo points, stealth
 * openers and finishers (plan §6).
 * P0 skeleton: builder + finisher. Full kit lands in P3b.
 */
import type { AbilityDef, ClassKitDef } from '../types';

export const KIT: ClassKitDef = {
  classId: 'phantom',
  resource: 'energy',
  usesComboPoints: true,
  baseHp: 50,
  hpPerLevel: 10,
  baseResource: 100,
  resourcePerLevel: 0,
  abilityIds: ['phantom_shadow_strike', 'phantom_eviscerate'],
};

export const ABILITIES: AbilityDef[] = [
  {
    id: 'phantom_shadow_strike',
    classId: 'phantom',
    name: 'Shadow Strike',
    school: 'physical',
    cost: 40,
    castTimeSec: 0,
    cooldownSec: 0,
    rangeM: 3,
    triggersGcd: true,
    combo: { builds: 1 },
    effects: [{ kind: 'weaponStrike', bonusDamage: 4 }],
    ranks: [{ level: 8, magnitudeMult: 1.6 }, { level: 16, magnitudeMult: 2.4 }],
    minLevel: 1,
    description: 'A precise strike from the shadows. Awards 1 combo point.',
  },
  {
    id: 'phantom_eviscerate',
    classId: 'phantom',
    name: 'Eviscerate',
    school: 'physical',
    cost: 35,
    castTimeSec: 0,
    cooldownSec: 0,
    rangeM: 3,
    triggersGcd: true,
    combo: { spendsAll: true },
    effects: [{ kind: 'directDamage', min: 6, max: 10 }],
    ranks: [{ level: 8, magnitudeMult: 1.6 }, { level: 16, magnitudeMult: 2.4 }],
    minLevel: 4,
    description: 'A vicious finisher — damage scales with combo points spent.',
  },
];
