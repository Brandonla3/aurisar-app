/**
 * castleDungeon — shared px/coord helpers for Castle Ashwood instances.
 * Used by client reconciliation tests; mirrored in spacetimedb/src/dungeon/helpers.ts.
 */

import { PX_PER_M, WORLD_ORIGIN_PX } from '../worldSpace.js';
import { INTERIOR_ANCHOR, ENTRY, LOCAL_BOUNDS } from './castlePlan.js';

// Coordinate contract sourced from the single client source of truth
// (worldSpace) so this module and the server dungeon helper never drift.
// STDB_CENTER is worldSpace.WORLD_ORIGIN_PX under this module's historical name.
export { PX_PER_M };
export const STDB_CENTER = WORLD_ORIGIN_PX;
export const DUNGEON_MAX_PLAYERS = 5;
export const DUNGEON_GATE_RANGE_M = 6;
export const DUNGEON_EXIT_RANGE_M = 4;

/** Interior-local meters → STDB px (player.x / player.y). */
export function interiorLocalToPx(local) {
  return {
    x: Math.round((local.x + INTERIOR_ANCHOR.x) * PX_PER_M + STDB_CENTER),
    y: Math.round((local.z + INTERIOR_ANCHOR.z) * PX_PER_M + STDB_CENTER),
  };
}

/** STDB px → world meters. */
export function pxToWorldM(px) {
  return (px - STDB_CENTER) / PX_PER_M;
}

/** True when world (x,z) meters fall inside the castle interior footprint. */
export function isInCastleInteriorFootprint(worldXM, worldZM) {
  const lx = worldXM - INTERIOR_ANCHOR.x;
  const lz = worldZM - INTERIOR_ANCHOR.z;
  return lx >= LOCAL_BOUNDS.x0 && lx < LOCAL_BOUNDS.x1 &&
         lz >= LOCAL_BOUNDS.z0 && lz < LOCAL_BOUNDS.z1;
}

export function castleSpawnPx() {
  return interiorLocalToPx(ENTRY.spawnLocal);
}

export function castleGatePx(zoneOrigin = { x: 0, z: 0 }) {
  const g = ENTRY.gateWorld;
  return {
    x: Math.round((g.x + zoneOrigin.x) * PX_PER_M + STDB_CENTER),
    y: Math.round((g.z + zoneOrigin.z) * PX_PER_M + STDB_CENTER),
  };
}

export function castleExitHotspotPx() {
  return interiorLocalToPx(ENTRY.exitHotspotLocal);
}
