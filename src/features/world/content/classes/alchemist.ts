/**
 * Alchemist — Warlock-style kit reflavor: DoTs and drains as poisons and
 * concoctions (plan §6). Locked class (unlocks fitness-side).
 * P0 skeleton: 2 starter abilities. Full kit lands in P3b.
 */
import type { AbilityDef, ClassKitDef } from '../types';

export const KIT: ClassKitDef = {
  classId: 'alchemist',
  resource: 'mana',
  usesComboPoints: false,
  baseHp: 47,
  hpPerLevel: 9,
  baseResource: 85,
  resourcePerLevel: 15,
  abilityIds: ['alchemist_corrosive_vial', 'alchemist_siphon_draught'],
};

export const ABILITIES: AbilityDef[] = [
  {
    id: 'alchemist_corrosive_vial',
    classId: 'alchemist',
    name: 'Corrosive Vial',
    school: 'shadow',
    cost: 14,
    castTimeSec: 0,
    cooldownSec: 0,
    rangeM: 30,
    triggersGcd: true,
    effects: [{ kind: 'dot', totalDamage: 24, durationSec: 12, tickSec: 3 }],
    ranks: [{ level: 8, magnitudeMult: 1.6 }, { level: 16, magnitudeMult: 2.4 }],
    minLevel: 1,
    description: 'Shatters a vial of corrosive reagent on the target.',
  },
  {
    id: 'alchemist_siphon_draught',
    classId: 'alchemist',
    name: 'Siphon Draught',
    school: 'shadow',
    cost: 12,
    castTimeSec: 2,
    cooldownSec: 0,
    rangeM: 30,
    triggersGcd: true,
    effects: [{ kind: 'directDamage', min: 5, max: 8 }],
    ranks: [{ level: 8, magnitudeMult: 1.6 }, { level: 16, magnitudeMult: 2.4 }],
    minLevel: 4,
    description: 'Draws vitality from the target into a volatile draught.',
  },
];
