/**
 * Warrior — direct port of the rage melee kit (plan §6).
 * P0 skeleton: 2 starter abilities. Full kit lands in P3b.
 */
import type { AbilityDef, ClassKitDef } from '../types';

export const KIT: ClassKitDef = {
  classId: 'warrior',
  resource: 'rage',
  usesComboPoints: false,
  baseHp: 60,
  hpPerLevel: 12,
  baseResource: 100,
  resourcePerLevel: 0,
  abilityIds: ['warrior_heroic_strike', 'warrior_battle_shout'],
};

export const ABILITIES: AbilityDef[] = [
  {
    id: 'warrior_heroic_strike',
    classId: 'warrior',
    name: 'Heroic Strike',
    school: 'physical',
    cost: 15,
    castTimeSec: 0,
    cooldownSec: 0,
    rangeM: 3,
    triggersGcd: true,
    effects: [{ kind: 'weaponStrike', bonusDamage: 6 }],
    ranks: [{ level: 8, magnitudeMult: 1.6 }, { level: 16, magnitudeMult: 2.4 }],
    minLevel: 1,
    description: 'A strong attack that adds damage to your next swing.',
  },
  {
    id: 'warrior_battle_shout',
    classId: 'warrior',
    name: 'Battle Shout',
    school: 'physical',
    cost: 10,
    castTimeSec: 0,
    cooldownSec: 0,
    rangeM: 0,
    triggersGcd: true,
    effects: [{ kind: 'selfBuff', stat: 'attackPower', amount: 10, durationSec: 120 }],
    minLevel: 4,
    description: 'A rallying shout that increases your attack power.',
  },
];
