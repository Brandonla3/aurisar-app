import { describe, it, expect } from 'vitest';
import {
  interiorLocalToPx, castleSpawnPx, castleGatePx, isInCastleInteriorFootprint,
  pxToWorldM, STDB_CENTER, PX_PER_M,
} from '../castleDungeon.js';
import { INTERIOR_ANCHOR, ENTRY } from '../castlePlan.js';

describe('castleDungeon helpers', () => {
  it('interiorLocalToPx matches STDB center + anchor offset', () => {
    const px = interiorLocalToPx({ x: 0, z: 0 });
    expect(px.x).toBe(Math.round((INTERIOR_ANCHOR.x) * PX_PER_M + STDB_CENTER));
    expect(px.y).toBe(Math.round((INTERIOR_ANCHOR.z) * PX_PER_M + STDB_CENTER));
  });

  it('castle spawn px round-trips through pxToWorldM into the footprint', () => {
    const px = castleSpawnPx();
    const wx = pxToWorldM(px.x);
    const wz = pxToWorldM(px.y);
    expect(isInCastleInteriorFootprint(wx, wz)).toBe(true);
  });

  it('gate px matches authored gateWorld', () => {
    const px = castleGatePx();
    expect(pxToWorldM(px.x)).toBeCloseTo(ENTRY.gateWorld.x, 3);
    expect(pxToWorldM(px.y)).toBeCloseTo(ENTRY.gateWorld.z, 3);
  });
});
