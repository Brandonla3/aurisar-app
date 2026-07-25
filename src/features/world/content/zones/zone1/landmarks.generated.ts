// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/config/zone1_world.json (anchors) + castle/castlePlan.js
// Regenerate with: npm run emit:landmarks

/**
 * Shared Zone 1 world positions — the single authored copy.
 *
 * Anything that needs a landmark's coordinates (waypoints, NPCs, mob camps,
 * props, dungeon entrances, the map) reads it from here rather than repeating
 * the literal. Derived entries trace back to the terrain/castle truth that
 * already owned them; authored entries live in zone1_world.json `anchors`.
 */
export interface LandmarkDef {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly z: number;
}

export const LANDMARKS = {
  // castle/castlePlan.js EXTERIOR.site
  castle_ashwood: { id: 'castle_ashwood', name: "Castle Ashwood", x: 150, z: 20 },
  // castle/castlePlan.js ENTRY.gateWorld (derived from EXTERIOR)
  castle_gate: { id: 'castle_gate', name: "Castle Ashwood Gate", x: 112.5, z: 20 },
  // zone1_world.json plateaus[12] (summit shelf)
  frostspire_summit: { id: 'frostspire_summit', name: "Frostspire Summit", x: -285, z: -315 },
  // zone1_world.json anchors
  gallows_rise: { id: 'gallows_rise', name: "Gallows Rise", x: 76, z: -76 },
  // zone1_world.json anchors
  gloomweb: { id: 'gloomweb', name: "Gloomweb", x: -60, z: 4 },
  // zone1_world.json anchors
  graveyard: { id: 'graveyard', name: "Oakrest Graveyard", x: -12, z: -14 },
  // zone1_world.json anchors
  greywood_run: { id: 'greywood_run', name: "Greywood Run", x: -2, z: 70 },
  // zone1_world.json anchors
  hollow_crypt: { id: 'hollow_crypt', name: "The Hollow Crypt", x: 0, z: -37 },
  // zone1_world.json plateaus[0] (hub plateau, r34)
  hub: { id: 'hub', name: "Oakrest", x: 0, z: 0 },
  // zone1_world.json anchors
  lower_gate: { id: 'lower_gate', name: "Frostspire Lower Gate", x: -160, z: -150 },
  // zone1_world.json anchors
  mourners_rest: { id: 'mourners_rest', name: "Mourner's Rest", x: 80, z: 80 },
  // zone1_world.json anchors
  rustvein_dig: { id: 'rustvein_dig', name: "Rustvein Dig", x: -84, z: -64 },
  // zone1_world.json lake (bowl center)
  stillmere: { id: 'stillmere', name: "Stillmere", x: -92, z: 88 },
  // zone1_world.json anchors
  tuskfield: { id: 'tuskfield', name: "Tuskfield", x: 65, z: 0 },
  // zone1_world.json zones.wildwood
  wildwood: { id: 'wildwood', name: "The Wildwood", x: -5, z: 110 },
} as const satisfies Record<string, LandmarkDef>;

export type LandmarkId = keyof typeof LANDMARKS;

/** All landmarks as a flat array (stable id order). */
export const ALL_LANDMARKS: readonly LandmarkDef[] = Object.values(LANDMARKS);

/** Position-only helper for the common `{ x, z }` shape. */
export function landmarkPos(id: LandmarkId): { x: number; z: number } {
  const l = LANDMARKS[id];
  return { x: l.x, z: l.z };
}
