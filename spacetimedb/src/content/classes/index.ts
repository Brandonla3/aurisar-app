// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/classes/index.ts
// Regenerate with: npm run sync:content

/**
 * classes/index.ts — aggregates all 11 class kits + their abilities.
 *
 * Class ids must match the keys of CLASSES in src/data/exercises.js
 * (cross-checked by the integrity test). Display names live there too —
 * never store a class display name in world content.
 */
import type { AbilityDef, ClassId, ClassKitDef } from '../types';

import * as warrior from './warrior';
import * as gladiator from './gladiator';
import * as warden from './warden';
import * as phantom from './phantom';
import * as tempest from './tempest';
import * as warlord from './warlord';
import * as druid from './druid';
import * as oracle from './oracle';
import * as alchemist from './alchemist';
import * as titan from './titan';
import * as striker from './striker';

const MODULES = [
  warrior, gladiator, warden, phantom, tempest,
  warlord, druid, oracle, alchemist, titan, striker,
];

export const CLASS_KITS: Record<ClassId, ClassKitDef> = Object.fromEntries(
  MODULES.map((m) => [m.KIT.classId, m.KIT]),
) as Record<ClassId, ClassKitDef>;

/** Raw authoring list — may contain duplicate ids; the validator checks it. */
export const ALL_ABILITIES: AbilityDef[] = MODULES.flatMap((m) => m.ABILITIES);

export const ABILITIES: Record<string, AbilityDef> = Object.fromEntries(
  ALL_ABILITIES.map((a) => [a.id, a]),
);

export const CLASS_IDS = Object.keys(CLASS_KITS) as ClassId[];
