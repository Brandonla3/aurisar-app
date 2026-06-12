/**
 * Druid — direct port: nature damage + HoTs; bear form (model swap + kit
 * page) lands with the full kit in P3b (plan §6).
 * P0 skeleton: 2 starter abilities.
 */
import type { AbilityDef, ClassKitDef } from '../types';

export const KIT: ClassKitDef = {
  classId: 'druid',
  resource: 'mana',
  usesComboPoints: false,
  baseHp: 50,
  hpPerLevel: 10,
  baseResource: 80,
  resourcePerLevel: 14,
  abilityIds: ['druid_thornlash', 'druid_regrowth'],
};

export const ABILITIES: AbilityDef[] = [
  {
    id: 'druid_thornlash',
    classId: 'druid',
    name: 'Thornlash',
    school: 'nature',
    cost: 12,
    castTimeSec: 1.5,
    cooldownSec: 0,
    rangeM: 30,
    triggersGcd: true,
    effects: [{ kind: 'directDamage', min: 6, max: 10 }],
    ranks: [{ level: 8, magnitudeMult: 1.6 }, { level: 16, magnitudeMult: 2.4 }],
    minLevel: 1,
    description: 'Lashes the target with conjured thorns.',
  },
  {
    id: 'druid_regrowth',
    classId: 'druid',
    name: 'Regrowth',
    school: 'nature',
    cost: 18,
    castTimeSec: 0,
    cooldownSec: 0,
    rangeM: 30,
    triggersGcd: true,
    effects: [{ kind: 'hot', totalHeal: 30, durationSec: 12, tickSec: 3 }],
    ranks: [{ level: 8, magnitudeMult: 1.6 }, { level: 16, magnitudeMult: 2.4 }],
    minLevel: 4,
    description: 'Living energy knits the target’s wounds over time.',
  },
];
