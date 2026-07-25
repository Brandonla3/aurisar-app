/**
 * zone1/waypoints.ts — zone-1 points of interest. Original Aurisar
 * placeholder names; the layout is modeled on the reference design's
 * starter zone. Used for map labels and 'find' objectives; the POIs anchor
 * the world map + minimap.
 *
 * Positions come from LANDMARKS (generated — see scripts/emit_zone1_landmarks.mjs)
 * so a POI label can never drift from the terrain feature it names. Only
 * `radiusM` is authored here: the POI radius is a map/label concern, not a
 * world-geometry one.
 */
import type { WaypointDef } from '../../types';
import { LANDMARKS as L } from './landmarks.generated';

export const WAYPOINTS: WaypointDef[] = [
  { id: 'poi_oakrest',        zoneId: 1, pos: { x: L.hub.x, z: L.hub.z },                           radiusM: 26, label: L.hub.name },
  { id: 'poi_greywood_run',   zoneId: 1, pos: { x: L.greywood_run.x, z: L.greywood_run.z },         radiusM: 20, label: L.greywood_run.name },
  { id: 'poi_tuskfield',      zoneId: 1, pos: { x: L.tuskfield.x, z: L.tuskfield.z },               radiusM: 20, label: L.tuskfield.name },
  { id: 'poi_stillmere',      zoneId: 1, pos: { x: L.stillmere.x, z: L.stillmere.z },               radiusM: 24, label: L.stillmere.name },
  { id: 'poi_gloomweb',       zoneId: 1, pos: { x: L.gloomweb.x, z: L.gloomweb.z },                 radiusM: 20, label: L.gloomweb.name },
  { id: 'poi_rustvein_dig',   zoneId: 1, pos: { x: L.rustvein_dig.x, z: L.rustvein_dig.z },         radiusM: 18, label: L.rustvein_dig.name },
  { id: 'poi_gallows_rise',   zoneId: 1, pos: { x: L.gallows_rise.x, z: L.gallows_rise.z },         radiusM: 22, label: L.gallows_rise.name },
  { id: 'poi_castle_ashwood', zoneId: 1, pos: { x: L.castle_gate.x, z: L.castle_gate.z },           radiusM: 12, label: L.castle_ashwood.name },
  { id: 'poi_mourners_rest',  zoneId: 1, pos: { x: L.mourners_rest.x, z: L.mourners_rest.z },       radiusM: 16, label: L.mourners_rest.name },
];
