/**
 * zone1/waypoints.ts — zone-1 points of interest. Original Aurisar
 * placeholder names; the layout is modeled on the reference design's
 * starter zone. Used for map labels and future 'find' objectives (none of
 * the zone-1 quests use 'find' yet; the POIs anchor the world map +
 * minimap).
 */
import type { WaypointDef } from '../../types';

export const WAYPOINTS: WaypointDef[] = [
  { id: 'poi_oakrest',      zoneId: 1, pos: { x: -10, z: -100 }, radiusM: 40, label: 'Oakrest' },
  { id: 'poi_greywood_run', zoneId: 1, pos: { x: -2, z: 70 },   radiusM: 20, label: 'Greywood Run' },
  { id: 'poi_tuskfield',    zoneId: 1, pos: { x: 65, z: 0 },    radiusM: 20, label: 'Tuskfield' },
  { id: 'poi_stillmere',    zoneId: 1, pos: { x: -88, z: 82 },  radiusM: 24, label: 'Stillmere' },
  { id: 'poi_gloomweb',     zoneId: 1, pos: { x: -60, z: 4 },   radiusM: 20, label: 'Gloomweb' },
  { id: 'poi_rustvein_dig', zoneId: 1, pos: { x: -84, z: -64 }, radiusM: 18, label: 'Rustvein Dig' },
  { id: 'poi_gallows_rise', zoneId: 1, pos: { x: 76, z: -76 },  radiusM: 22, label: 'Gallows Rise' },
  { id: 'poi_mourners_rest',zoneId: 1, pos: { x: 80, z: 80 },   radiusM: 16, label: "Mourner's Rest" },
];
