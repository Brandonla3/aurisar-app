/**
 * worldSpace — the single client-side source of truth for the Aurisar world's
 * coordinate frame.
 *
 * Everything that converts between SpacetimeDB units and Babylon meters, or
 * that projects the world onto the 2D maps, imports from here so the frame can
 * never drift apart across the scene, the World Map, and the minimap.
 *
 * World frame:
 *   • World space is meters, with the origin (0,0) at the spawn hub.
 *     **+z is NORTH**, +x is east; north is the top of the map.
 *
 *     This was inverted until Batch E. The renderer said +z = south while the
 *     content said the opposite, and the content was both larger and
 *     player-facing: the zone-2 gate is literally named `z1_north_pass` and
 *     sits at z = +170, and the wolf quests point players "up the north road"
 *     toward camps at z = +55…+95. Under the old convention a player following
 *     the compass north walked ~125 m the wrong way, toward the crypt. The
 *     compass, both 2D maps and the prose were reconciled onto +z = north
 *     rather than renaming the gate and rewriting the quests.
 *   • The PLAYABLE world is a disc centered on the origin (radius from the live
 *     world config — zone1_world.json `radius`, ~520 m). The tile-streaming grid
 *     in world_build_config.json over-covers this disc; it is NOT the playable
 *     bound and must not be used to frame the maps.
 *
 * SpacetimeDB frame:
 *   • The server stores positions in px: PX_PER_M px per meter, offset by
 *     WORLD_ORIGIN_PX so that world (0,0) = STDB (1600,1600). The 1600 offset is
 *     a legacy origin inherited from the retired 3200 px prototype; it is kept
 *     only so the live database's stored coordinates stay valid, and is fully
 *     encapsulated behind toWorld/toStdb. The server mirrors these constants —
 *     see spacetimedb/src/index.ts (WORLD_CENTER_PX / PX_PER_M).
 */

// ── SpacetimeDB units ────────────────────────────────────────────────────────
export const PX_PER_M = 32;
export const WORLD_ORIGIN_PX = 1600; // legacy STDB origin offset; world (0,0)

/** STDB px → world meters (one axis). */
export function toWorld(v) { return (v - WORLD_ORIGIN_PX) / PX_PER_M; }

/** World meters → STDB px (one axis), rounded to the server's integer grid. */
export function toStdb(v) { return Math.round(v * PX_PER_M + WORLD_ORIGIN_PX); }

// ── Playable world (the disc the 2D maps bake + project against) ─────────────
// Fallback radius (meters) when a caller has no live world config; the real
// value comes from the world config's `radius` (zone1_world.json).
export const DEFAULT_PLAYABLE_RADIUS_M = 520;

/**
 * Square, origin-centered world bounds that exactly cover the playable disc —
 * the framing both 2D maps bake and project against. Pass the live config
 * radius; falls back to DEFAULT_PLAYABLE_RADIUS_M.
 *
 * @param {number} [radius] playable disc radius in meters
 * @returns {{minX:number, minZ:number, maxX:number, maxZ:number}}
 */
export function mapBounds(radius = DEFAULT_PLAYABLE_RADIUS_M) {
  // Guard a malformed config: a non-positive or non-finite radius would make
  // ctx.arc() throw (negative) or divide-by-zero → NaN coords in the map bake.
  const r = Number.isFinite(radius) && radius > 0 ? radius : DEFAULT_PLAYABLE_RADIUS_M;
  return { minX: -r, minZ: -r, maxX: r, maxZ: r };
}
