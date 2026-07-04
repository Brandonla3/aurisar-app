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
import { SPAWN_MARKERS, ENTRY } from '../../castle/castlePlan.js';

export const DUNGEONS: DungeonDef[] = [
  {
    id: 'castle_ashwood',
    name: 'Castle Ashwood',
    minLevel: 5,
    entrance: { zoneId: 1, pos: { x: ENTRY.gateWorld.x, z: ENTRY.gateWorld.z } },
    layoutManifest: 'castle_ashwood.json',
    bossMobType: 'gorrak',
    bossMechanics: {
      aoePulse: { everySec: 9, damage: 14, radiusM: 6 },
      enrage: { afterSec: 240, mult: 1.5 },
    },
    spawns: SPAWN_MARKERS.map(({ netId, mobType, pos, count, radiusM }) => ({
      netId,
      mobType,
      pos: { x: pos.x, z: pos.z },
      count,
      radiusM,
    })),
  },
];
