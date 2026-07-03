// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/dungeons/index.ts
// Regenerate with: npm run sync:content

/**
 * dungeons/index.ts — instanced dungeon definitions.
 *
 * castle_ashwood is the v1 registration for Castle Ashwood
 * (src/features/world/castle/). The client renders the castle procedurally
 * from castlePlan.js; this entry is the SEAM:dungeon-def hook the server
 * seeder consumes in v2 to spawn interior mobs and gate 5-player groups.
 * Spawn positions are interior-local meters (castlePlan LOCAL space).
 */
import type { DungeonDef } from '../types';

export const DUNGEONS: DungeonDef[] = [
  {
    id: 'castle_ashwood',
    name: 'Castle Ashwood',
    minLevel: 5,
    entrance: { zoneId: 1, pos: { x: 118.5, z: 20 } }, // west gates (ENTRY.gateWorld)
    layoutManifest: 'castle_ashwood.json', // SEAM:layout-manifest — emit from CASTLE_PLAN
    bossMobType: 'gorrak',
    bossMechanics: {
      aoePulse: { everySec: 9, damage: 14, radiusM: 6 },
      enrage: { afterSec: 240, mult: 1.5 },
    },
    spawns: [
      // v2: consumed by the server seeder; ignored by the v1 renderer.
      { netId: 'ca_cells',    mobType: 'restless_bones', pos: { x: -12, z: 8 },  count: 4, radiusM: 8 },
      { netId: 'ca_vault',    mobType: 'vale_bandit',    pos: { x: 13, z: -10 }, count: 3, radiusM: 6 },
      { netId: 'ca_ballroom', mobType: 'restless_bones', pos: { x: -14, z: -9 }, count: 5, radiusM: 10 },
      { netId: 'ca_boss',     mobType: 'gorrak',         pos: { x: 0, z: 13 },   count: 1, radiusM: 2 },
    ],
  },
];
