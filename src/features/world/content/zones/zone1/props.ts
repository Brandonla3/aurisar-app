/**
 * zone1/props.ts — hub settlement + camp dressing, positions modeled on
 * the reference design's starter zone (see public/assets/ATTRIBUTION.md).
 * Consumed client-side by systems/PropsSystem.js; the server ignores
 * props entirely.
 */

export interface BuildingProp { kind: 'house' | 'inn' | 'chapel'; x: number; z: number; w: number; d: number; rot: number }
export interface VillageProp { x: number; z: number; rot: number }
export interface StallProp { x: number; z: number; rot: number; smithy?: boolean }
export interface FenceLine { x1: number; z1: number; x2: number; z2: number }
export interface TentProp { x: number; z: number; rot: number; scale: number }
export interface RuinRing { x: number; z: number; ringR: number; columns: number }
export interface SimplePos { x: number; z: number }
export interface RotPos extends SimplePos { rot: number }

export const ZONE1_PROPS = {
  // The starter town: one composed Meshy-AI village model (~75m footprint,
  // geometry pre-scaled to meters — see scripts/build_village_glb.mjs).
  // Sits on the terrain settlement pad + scatter exclusion declared in
  // zone1_world.json. With rot 0 the main path gates face the spawn meadow.
  villages: [{ x: -10, z: -100, rot: 0 }] as VillageProp[],

  // The generic starter buildings were replaced by the village model above.
  buildings: [] as BuildingProp[],

  // Well + market stalls live on the village plaza (world = village + local).
  wells: [{ x: -11, z: -97 }] as SimplePos[],

  stalls: [
    { x: -16, z: -91, rot: Math.PI / 2 },
    { x: 1,   z: -88, rot: -1.9, smithy: true }, // the smith's smithy
  ] as StallProp[],

  campfires: [
    { x: 3, z: -4 }, { x: 65, z: -65 }, { x: 90, z: -90 },
    { x: -80, z: -60 }, { x: -61, z: 56 },
  ] as SimplePos[],

  fences: [] as FenceLine[],

  tents: [
    { x: 62, z: -61, rot: 0.4,  scale: 1 },
    { x: 69, z: -69, rot: 2.1,  scale: 1 },
    { x: 88, z: -86, rot: 1.2,  scale: 1.3 },
    { x: 95, z: -94, rot: -0.6, scale: 1 },
  ] as TentProp[],

  crates: [
    { x: 60, z: -63 }, { x: 66, z: -67 }, { x: 87, z: -88 },
    { x: 93, z: -90 }, { x: 70, z: -72 },
  ] as SimplePos[],

  mudHuts: [
    { x: -73, z: 59 }, { x: -78, z: 54 }, { x: -69, z: 55 },
  ] as SimplePos[],

  ruinRings: [
    { x: 80, z: 78, ringR: 7, columns: 7 },
  ] as RuinRing[],

  mines: [{ x: -88, z: -68, rot: 0.8 }] as RotPos[],

  docks: [{ x: -64, z: 60, rot: -2.2 }] as RotPos[],
};
