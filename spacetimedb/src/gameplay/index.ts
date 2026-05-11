/**
 * Tile gameplay manifest — server-side bundle of per-tile spawn data.
 *
 * Each JSON file under this directory follows
 * `src/features/world/config/schemas/tile_gameplay.schema.json` (validated
 * client-side; the server trusts the bundled data because it ships in the
 * module WASM at compile time).
 *
 * Today `seedWorld()` only reads `.spawns[]`. `encounter_zones`,
 * `waypoints`, `pois`, and `nav_hints` are declared in the JSON but ignored
 * — they get consumed when slice 5c+ AI / encounter logic lands.
 *
 * Mirrored to `public/assets/tiles/<tile_id>_gameplay.json` by
 * `npm run build:gameplay` so external tooling (validators, the testing
 * HUD, future client-side waypoint rendering) can fetch them at runtime.
 */

import T_03_03 from './T_03_03.json' with { type: 'json' };

// Narrow shape used by `seedWorld()`. The JSON files contain more fields
// (encounter_zones, waypoints, etc.); we list only what the server reads.
export interface SpawnPoint {
  net_id:           string;
  mob_type:         string;
  position:         { x: number; y: number; z: number };
  yaw_deg:          number;
  respawn_sec:      number;
  max_alive:        number;
  leash_radius_m?:  number;
  aggro_radius_m?:  number;
}

export interface TileGameplay {
  tile:    { tile_id: string };
  spawns:  SpawnPoint[];
}

// The cast is safe — the schema is enforced at authoring time. Each new
// tile's JSON joins this array with one line.
export const tileGameplay: TileGameplay[] = [
  T_03_03 as TileGameplay,
];
