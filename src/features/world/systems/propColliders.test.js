/**
 * Prop collision — the analytic slide, and the two clearances that make it
 * risky in this particular settlement.
 *
 * Pure math, no Babylon: this is the whole point of keeping the collision
 * response as position arithmetic the code owns (engine collision was tried
 * for the castle camera and removed for exactly the opposite reason).
 */
import { describe, expect, it } from 'vitest';
import { createPropColliders, PLAYER_R } from './propColliders.js';
import { buildPropColliders, localToWorld } from './propFootprints.js';
// eslint-disable-next-line -- TS content module, no types needed here
import { ZONE1_PROPS } from '../content/zones/zone1/props';
// eslint-disable-next-line -- TS content module, no types needed here
import { ALL_NPCS } from '../content/index';

const at = (x, z) => ({ x, z });

describe('createPropColliders — the slide', () => {
  // One 4x4 building at the origin, unrotated, and nothing else.
  const solo = { buildings: [{ kind: 'house', x: 0, z: 0, w: 4, d: 4, rot: 0 }] };
  const P = createPropColliders(solo);

  it('blocks inside the expanded footprint, and only there', () => {
    expect(P.blocked(0, 0)).toBe(true);
    // half-extent 2 + player radius 0.35 = 2.35
    expect(P.blocked(2.3, 0)).toBe(true);
    expect(P.blocked(2.4, 0)).toBe(false);
    expect(P.blocked(50, 50)).toBe(false);
  });

  it('slides along x when only z is obstructed', () => {
    // Approaching the wall from +z: the x component of the move survives,
    // the z component is refused.
    const pos = at(1.5, 0);
    const changed = P.resolveMove(1.0, 5, pos);
    expect(changed).toBe(true);
    expect(pos.x).toBe(1.5);   // x advanced
    expect(pos.z).toBe(5);     // z reverted
  });

  it('slides along z when only x is obstructed', () => {
    const pos = at(0, 1.5);
    const changed = P.resolveMove(5, 1.0, pos);
    expect(changed).toBe(true);
    expect(pos.z).toBe(1.5);   // z advanced
    expect(pos.x).toBe(5);     // x reverted
  });

  it('stops dead when both slides are also blocked', () => {
    // An axis-aligned box can never reach this branch from outside: if prev is
    // outside, at least one axis is clear, so one slide always succeeds. A
    // rotated (diamond) footprint can — its corners overhang both axes.
    const diamond = createPropColliders({
      buildings: [{ kind: 'house', x: 0, z: 0, w: 4, d: 4, rot: Math.PI / 4 }],
    });
    const prev = { x: 2.4, z: 2.4 };
    expect(diamond.blocked(prev.x, prev.z)).toBe(false);  // outside the diamond
    expect(diamond.blocked(0, prev.z)).toBe(true);        // both slides blocked
    expect(diamond.blocked(prev.x, 0)).toBe(true);
    const pos = at(0, 0);
    expect(diamond.resolveMove(prev.x, prev.z, pos)).toBe(true);
    expect(pos).toEqual(prev);
  });

  it('leaves an unobstructed move completely alone', () => {
    const pos = at(30, 30);
    expect(P.resolveMove(29, 30, pos)).toBe(false);
    expect(pos).toEqual({ x: 30, z: 30 });
  });

  it('lets someone already inside walk out — never traps', () => {
    // prev inside, next also inside: must not be reverted, or they are stuck
    // forever. This is the escape CastleSystem.resolveShellCollision has.
    const pos = at(0.5, 0);
    const changed = P.resolveMove(0, 0, pos);
    expect(changed).toBe(false);
    expect(pos).toEqual({ x: 0.5, z: 0 });
  });

  it('respects rotation — a rotated rect blocks a different corner', () => {
    const rotated = createPropColliders({
      buildings: [{ kind: 'house', x: 0, z: 0, w: 8, d: 2, rot: Math.PI / 2 }],
    });
    // Rotated 90°, the long axis runs along z, so (0, 3) is inside and
    // (3, 0) is outside — the opposite of the unrotated case.
    expect(rotated.blocked(0, 3)).toBe(true);
    expect(rotated.blocked(3, 0)).toBe(false);
  });
});

describe('the live settlement', () => {
  const P = createPropColliders(ZONE1_PROPS);

  it('builds colliders for every solid bucket', () => {
    expect(P.colliders.length).toBeGreaterThan(30);
    for (const c of P.colliders) {
      expect(Number.isFinite(c.x) && Number.isFinite(c.z)).toBe(true);
      if (c.kind === 'circle') expect(c.r).toBeGreaterThan(0);
      else { expect(c.w).toBeGreaterThan(0); expect(c.d).toBeGreaterThan(0); }
    }
  });

  it('leaves the exact respawn point walkable', () => {
    // The server respawns every death to world (0,0). The well is the
    // nearest solid to that point (position is authored in props.ts, not
    // hardcoded here, so this can't go stale the way a written-out
    // distance/clearance figure would). If this ever fails, players
    // materialise inside a solid and the walk-out escape becomes the only
    // thing saving them.
    expect(P.blocked(0, 0)).toBe(false);
  });

  it('keeps every NPC reachable — none sealed inside a solid', () => {
    // A talk prompt is a 5 m radius test with no line-of-sight check, so an
    // NPC inside a building is still talkable from outside; but a player who
    // walks to them stops at the wall. Flag any NPC standing in a solid.
    const sealed = ALL_NPCS.filter((n) => P.blocked(n.pos.x, n.pos.z)).map((n) => n.id);
    expect(sealed, `NPCs standing inside a prop collider: ${sealed.join(', ')}`).toEqual([]);
  });

  it('campfires and dock decking stay walkable', () => {
    // Cooking is a proximity prompt at the fire; blocking it would make the
    // prompt unreachable from most approaches.
    for (const c of ZONE1_PROPS.campfires ?? []) {
      expect(P.blocked(c.x, c.z), `campfire (${c.x},${c.z}) is solid`).toBe(false);
    }
  });
});

describe('propFootprints geometry', () => {
  it('localToWorld matches PropsSystem\'s left-handed rotation', () => {
    // rot = 0 is the identity.
    expect(localToWorld(10, 20, 0, 1, 2)).toEqual({ x: 11, z: 22 });
    // A quarter turn maps local +x to world -z (left-handed about +y).
    const p = localToWorld(0, 0, Math.PI / 2, 1, 0);
    expect(p.x).toBeCloseTo(0, 6);
    expect(p.z).toBeCloseTo(-1, 6);
  });

  it('never emits a collider for a walkable prop', () => {
    const labels = new Set(buildPropColliders(ZONE1_PROPS).map((c) => c.label));
    expect(labels.has('campfire')).toBe(false);
    expect(labels.has('dock_platform')).toBe(false);
    expect(labels.has('rowboat')).toBe(false);
  });

  it('PLAYER_R matches the castle so both systems feel the same', () => {
    expect(PLAYER_R).toBe(0.35);
  });
});

describe('rotation inverse (review H1 regression)', () => {
  // The original rotation test used pi/2, the one angle where a sign error in
  // the inverse is invisible (symmetric extents). Pin a non-cardinal angle
  // using localToWorld — the pinned-correct forward transform — as the oracle:
  // a point just inside a local corner must be blocked; its mirror must not.
  it('agrees with localToWorld at rot -0.4 (the real NE house)', () => {
    const P = createPropColliders({
      buildings: [{ kind: 'house', x: 20, z: 12, w: 7, d: 6, rot: -0.4 }],
    });
    const inside = localToWorld(20, 12, -0.4, 3.0, 2.5);   // inside 3.5 x 3 extents
    const outside = localToWorld(20, 12, -0.4, 4.2, 3.7);  // past both + PLAYER_R
    expect(P.blocked(inside.x, inside.z)).toBe(true);
    expect(P.blocked(outside.x, outside.z)).toBe(false);
    // The MIRRORED bug blocked the reflection instead — assert a point the old
    // code wrongly blocked (reflect local z) is open. (7x6 is non-square, so
    // the mirrored point genuinely falls outside the correctly-rotated box —
    // no distance guard needed; a prior version of this guard was inverted
    // and silently skipped the assertion it existed to run.)
    const mirrored = localToWorld(20, 12, 0.4, 3.0, 2.5);
    expect(P.blocked(mirrored.x, mirrored.z)).toBe(false);
  });
});
