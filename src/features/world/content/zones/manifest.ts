/**
 * zones/manifest.ts — the zone progression map.
 *
 * Zone 1 is a NEW map (reference-style hub + camps + roads) — its
 * worldgen config (zone1_world.json) lands in P1. Ashwood is intentionally
 * NOT in this manifest: it stays in the repo as a dev/test world only.
 * Level bands cap at 35 until more zones ship (plan §2b). All names are
 * placeholders for the story pass.
 */
import type { ZoneDef } from '../types';

export const ZONES: ZoneDef[] = [
  {
    id: 1,
    key: 'zone1',
    // Modeled on the reference design's starter zone. The display name is
    // a working placeholder the story pass renames.
    name: 'Zone One',
    levelBand: [1, 7],
    // Zone 1 lives at the world origin (it replaces Ashwood in place, and
    // movePlayer's ±1000 m bounds assume the origin region). Zones 2+ get
    // k·3000 m offsets in P5, when per-zone bounds + travel land.
    originOffsetM: { x: 0, z: 0 },
    worldConfig: 'zone1_world.json',
    spawnPos: { x: 0, z: 0 },
    graveyardPos: { x: -12, z: -14 },
    gates: [
      // Zone 2 begins past z=180; the pass placement follows the reference
      // northern ridge road.
      { id: 'z1_north_pass', pos: { x: 0, z: 170 }, toZoneId: 2, toGateId: 'z2_south_pass' },
    ],
  },
  // Zone 2 (levels 12–24) and zone 3 (levels 24–35) land in P5.
];

export const ZONES_BY_ID: Record<number, ZoneDef> = Object.fromEntries(
  ZONES.map((z) => [z.id, z]),
);

export function getZone(id: number): ZoneDef | null {
  return ZONES_BY_ID[id] ?? null;
}
