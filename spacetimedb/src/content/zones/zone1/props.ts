// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/zones/zone1/props.ts
// Regenerate with: npm run sync:content

/**
 * zone1/props.ts — hub settlement + camp dressing, positions modeled on
 * the reference design's starter zone (see public/assets/ATTRIBUTION.md).
 * Consumed client-side by systems/PropsSystem.js; the server ignores
 * props entirely.
 */

export interface BuildingProp { kind: 'house' | 'inn' | 'chapel'; x: number; z: number; w: number; d: number; rot: number }
export interface StallProp { x: number; z: number; rot: number; smithy?: boolean }
export interface FenceLine { x1: number; z1: number; x2: number; z2: number }
export interface TentProp { x: number; z: number; rot: number; scale: number }
export interface RuinRing { x: number; z: number; ringR: number; columns: number }
export interface SimplePos { x: number; z: number }
export interface RotPos extends SimplePos { rot: number }

export const ZONE1_PROPS = {
  buildings: [
    { kind: 'house',  x: 10,  z: 12, w: 7, d: 6, rot: -0.4 },
    { kind: 'house',  x: -10, z: 10, w: 6, d: 5, rot: 0.5 },
    { kind: 'inn',    x: 12,  z: -6, w: 6, d: 7, rot: 2.4 },
    { kind: 'chapel', x: -16, z: -8, w: 5, d: 7, rot: 0.9 },
  ] as BuildingProp[],

  wells: [{ x: 0, z: 2 }] as SimplePos[],

  stalls: [
    { x: -8.5, z: 3,    rot: Math.PI / 2 },
    { x: 9.5,  z: 17.5, rot: -2.7, smithy: true }, // the smith's smithy
  ] as StallProp[],

  campfires: [
    { x: 3, z: -4 }, { x: 65, z: -65 }, { x: 90, z: -90 },
    { x: -80, z: -60 }, { x: -61, z: 56 },
  ] as SimplePos[],

  fences: [
    { x1: 16,  z1: 16, x2: 22,  z2: 4 },
    { x1: -16, z1: 14, x2: -20, z2: 2 },
  ] as FenceLine[],

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
