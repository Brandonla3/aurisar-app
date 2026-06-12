/**
 * Gladiator — Paladin-style kit reflavor: auras + judgement strikes (plan §6).
 * P0 skeleton: 2 starter abilities. Full kit lands in P3b.
 */
import type { AbilityDef, ClassKitDef } from '../types';

export const KIT: ClassKitDef = {
  classId: 'gladiator',
  resource: 'mana',
  usesComboPoints: false,
  baseHp: 55,
  hpPerLevel: 11,
  baseResource: 70,
  resourcePerLevel: 12,
  abilityIds: ['gladiator_judgement_strike', 'gladiator_iron_presence'],
};

export const ABILITIES: AbilityDef[] = [
  {
    id: 'gladiator_judgement_strike',
    classId: 'gladiator',
    name: 'Judgement Strike',
    school: 'holy',
    cost: 12,
    castTimeSec: 0,
    cooldownSec: 6,
    rangeM: 3,
    triggersGcd: true,
    effects: [{ kind: 'weaponStrike', bonusDamage: 5 }],
    ranks: [{ level: 8, magnitudeMult: 1.6 }, { level: 16, magnitudeMult: 2.4 }],
    minLevel: 1,
    description: 'An arena-honed strike charged with conviction.',
  },
  {
    id: 'gladiator_iron_presence',
    classId: 'gladiator',
    name: 'Iron Presence',
    school: 'holy',
    cost: 15,
    castTimeSec: 0,
    cooldownSec: 0,
    rangeM: 0,
    triggersGcd: true,
    effects: [{ kind: 'selfBuff', stat: 'armor', amount: 30, durationSec: 300 }],
    minLevel: 4,
    description: 'Your commanding presence hardens you against blows.',
  },
];
