/**
 * zone1/waypoints.ts — named POIs used by 'find' quest objectives
 * (completed server-side via the reachWaypoint reducer, P1).
 */
import type { WaypointDef } from '../../types';

export const WAYPOINTS: WaypointDef[] = [
  {
    id: 'wp_z1_ruins_overlook',
    zoneId: 1,
    pos: { x: 180, z: 220 },
    radiusM: 12,
    label: 'Ruins Overlook', // placeholder
  },
  {
    id: 'wp_z1_old_camp',
    zoneId: 1,
    pos: { x: -200, z: 150 },
    radiusM: 12,
    label: 'Abandoned Camp', // placeholder
  },
];
