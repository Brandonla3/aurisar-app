/**
 * zone1/waypoints.ts — Eastbrook Vale points of interest, verbatim from
 * world-of-claudecraft zone-1. Used for map labels and future 'find'
 * objectives (none of the zone-1 quests use 'find'; the POIs anchor the
 * world map + minimap).
 */
import type { WaypointDef } from '../../types';

export const WAYPOINTS: WaypointDef[] = [
  { id: 'poi_eastbrook',     zoneId: 1, pos: { x: 0, z: -3 },    radiusM: 26, label: 'Eastbrook' },
  { id: 'poi_wolf_run',      zoneId: 1, pos: { x: -2, z: 70 },   radiusM: 20, label: 'Wolf Run' },
  { id: 'poi_boar_meadow',   zoneId: 1, pos: { x: 65, z: 0 },    radiusM: 20, label: 'Boar Meadow' },
  { id: 'poi_mirror_lake',   zoneId: 1, pos: { x: -88, z: 82 },  radiusM: 24, label: 'Mirror Lake' },
  { id: 'poi_webwood',       zoneId: 1, pos: { x: -60, z: 4 },   radiusM: 20, label: 'Webwood' },
  { id: 'poi_copper_dig',    zoneId: 1, pos: { x: -84, z: -64 }, radiusM: 18, label: 'Copper Dig' },
  { id: 'poi_bandit_camp',   zoneId: 1, pos: { x: 76, z: -76 },  radiusM: 22, label: 'Bandit Camp' },
  { id: 'poi_fallen_chapel', zoneId: 1, pos: { x: 80, z: 80 },   radiusM: 16, label: 'Fallen Chapel' },
];
