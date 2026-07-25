/**
 * Hub layout invariants (Batch E).
 *
 * The Oakrest relayout was designed against these rules and they are pinned
 * here so a future placement edit cannot silently regress them. Everything
 * reads the LIVE content — the worldgen config for roads, ZONE1_PROPS for
 * footprints, ALL_NPCS for positions — so this suite is the arbiter for any
 * "move X a bit" change, and `npm run plan -- --view hub` is how to look at
 * what it is checking.
 */
import { describe, expect, it } from 'vitest';

// eslint-disable-next-line -- JS module without types
import { createWorldgen } from '../../worldgen/index.js';
// eslint-disable-next-line -- JS module without types
import { createPropColliders } from '../../systems/propColliders.js';
// eslint-disable-next-line -- JSON module
import zone1Config from '../../config/zone1_world.json';
import { ZONE1_PROPS } from '../zones/zone1/props';
import { ALL_NPCS } from '../index';

const wg = createWorldgen(zone1Config);
const P = createPropColliders(ZONE1_PROPS);
const HALF_W = zone1Config.trailHalfWidth ?? 3.1;

/** Distance from (x,z) to the nearest trail centreline. */
function roadDist(x: number, z: number): number {
  let best = Infinity;
  for (const curve of wg.trailCurves) {
    for (let i = 0; i < curve.length - 1; i++) {
      const [ax, az] = curve[i];
      const [bx, bz] = curve[i + 1];
      const dx = bx - ax, dz = bz - az;
      const l2 = dx * dx + dz * dz;
      const t = l2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)) : 0;
      best = Math.min(best, Math.hypot(x - (ax + t * dx), z - (az + t * dz)));
    }
  }
  return best;
}

const hubNpcs = ALL_NPCS.filter((n) => Math.hypot(n.pos.x, n.pos.z) < 45);

describe('Oakrest hub layout', () => {
  it('no NPC stands in a carriageway', () => {
    for (const n of hubNpcs) {
      const d = roadDist(n.pos.x, n.pos.z);
      expect(d, `${n.id} is ${d.toFixed(1)}m from a road centreline (< ${HALF_W}m = in the road)`)
        .toBeGreaterThanOrEqual(HALF_W);
    }
  });

  it('no NPC is sealed inside a prop, with a real margin', () => {
    // Margin matters: an NPC exactly on a collider edge re-seals under any
    // future footprint tweak. 0.4 m of clearance on both axes.
    for (const n of hubNpcs) {
      const spots = [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]];
      for (const [dx, dz] of spots) {
        expect(P.blocked(n.pos.x + dx, n.pos.z + dz), `${n.id} sealed or too tight at +(${dx},${dz})`)
          .toBe(false);
      }
    }
  });

  it('every NPC pair keeps >= 12 m separation', () => {
    for (let i = 0; i < hubNpcs.length; i++) {
      for (let j = i + 1; j < hubNpcs.length; j++) {
        const a = hubNpcs[i], b = hubNpcs[j];
        const d = Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);
        expect(d, `${a.id} <-> ${b.id} are ${d.toFixed(2)}m apart`).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it('no prop collider blocks a carriageway near the hub', () => {
    for (const c of P.colliders) {
      if (Math.hypot(c.x, c.z) > 45) continue;
      const d = roadDist(c.x, c.z);
      expect(d, `${c.label} at (${c.x.toFixed(1)},${c.z.toFixed(1)}) is ${d.toFixed(1)}m from a road centreline`)
        .toBeGreaterThanOrEqual(HALF_W);
    }
  });

  it('the respawn point stays open with margin', () => {
    // The server respawns every death to exactly (0,0).
    for (const [dx, dz] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      expect(P.blocked(dx, dz), `respawn blocked at (${dx},${dz})`).toBe(false);
    }
  });

  it('the hub sits on the level shelf', () => {
    // E1a levels the plateau to 1.5 m out to r34; every hub placement should
    // be on it, not on the blend ramp where props tilt visibly.
    for (const n of hubNpcs) {
      expect(wg.surfaceY(n.pos.x, n.pos.z), `${n.id} off the hub shelf`).toBeCloseTo(1.5, 1);
    }
    for (const b of ZONE1_PROPS.buildings) {
      if (Math.hypot(b.x, b.z) > 34) continue;
      expect(wg.surfaceY(b.x, b.z), `building ${b.kind} off the shelf`).toBeCloseTo(1.5, 1);
    }
  });
});
