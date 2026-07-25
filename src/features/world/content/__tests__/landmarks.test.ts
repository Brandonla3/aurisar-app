/**
 * Landmark / spatial-integrity tests.
 *
 * `validateContent()` has no spatial rules — it checks that ids resolve, not
 * that positions agree. Every coordinate drift the landmarks emitter exists to
 * kill (Stillmere authored twice, the castle keep-out hand-copied from
 * castlePlan, the crypt portal living in the renderer) was invisible to CI.
 * These are the spatial assertions.
 *
 * The REALIZED_SPAWNS table below is a position pin in the spirit of the
 * worldgen GOLDEN: camps are authored as offsets from their landmark, and this
 * pins what those offsets resolve to. A deliberate camp move updates this
 * table in the same commit; an accidental one fails here.
 */
import { describe, expect, it } from 'vitest';

import {
  ALL_LANDMARKS,
  ALL_WAYPOINTS,
  LANDMARKS,
  SPAWNS,
  landmarkPos,
} from '../index';

// eslint-disable-next-line -- JSON module, no types
import zone1Config from '../../config/zone1_world.json';
// eslint-disable-next-line -- JS module without types
import { EXTERIOR, ENTRY, INTERIOR_ANCHOR } from '../../castle/castlePlan.js';

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe('landmark integrity', () => {
  it('every landmark has a finite, uniquely-placed position', () => {
    for (const l of ALL_LANDMARKS) {
      expect(Number.isFinite(l.x), `${l.id}.x`).toBe(true);
      expect(Number.isFinite(l.z), `${l.id}.z`).toBe(true);
      expect(l.name.length, `${l.id}.name`).toBeGreaterThan(0);
    }
    // Two landmarks on the same spot is a copy-paste, not intent.
    for (let i = 0; i < ALL_LANDMARKS.length; i++) {
      for (let j = i + 1; j < ALL_LANDMARKS.length; j++) {
        const a = ALL_LANDMARKS[i], b = ALL_LANDMARKS[j];
        expect(dist(a, b), `${a.id} vs ${b.id} overlap`).toBeGreaterThan(2);
      }
    }
  });

  it('landmarks stay in sync with the terrain truth they derive from', () => {
    // Stillmere is the lake bowl — the drift this emitter resolved was a POI
    // authored at (-88,82) against a bowl centered at (-92,88).
    expect(landmarkPos('stillmere')).toEqual({ x: zone1Config.lake.x, z: zone1Config.lake.z });

    const [hubX, hubZ] = zone1Config.plateaus[0];
    expect(landmarkPos('hub')).toEqual({ x: hubX, z: hubZ });

    const summit = zone1Config.plateaus[zone1Config.plateaus.length - 1];
    expect(landmarkPos('frostspire_summit')).toEqual({ x: summit[0], z: summit[1] });

    expect(landmarkPos('wildwood')).toEqual({
      x: zone1Config.zones.wildwood.x, z: zone1Config.zones.wildwood.z,
    });
  });

  it('landmarks stay in sync with castlePlan (the hand-copies it replaced)', () => {
    expect(landmarkPos('castle_ashwood')).toEqual({ x: EXTERIOR.site.x, z: EXTERIOR.site.z });
    expect(landmarkPos('castle_gate')).toEqual({ x: ENTRY.gateWorld.x, z: ENTRY.gateWorld.z });

    // The worldgen keep-out is still a literal in zone1_world.json; assert it
    // tracks the castle it is supposed to be protecting.
    const keepOut = zone1Config.exclusions.find(
      (e: { x: number; z: number }) => dist(e, EXTERIOR.site) < 1e-6,
    );
    expect(keepOut, 'no exclusion zone at castlePlan EXTERIOR.site').toBeTruthy();

    expect(zone1Config.interiors.ashwoodCastle.cx).toBe(INTERIOR_ANCHOR.x);
  });
});

describe('waypoints resolve to landmarks', () => {
  const expected: Record<string, keyof typeof LANDMARKS> = {
    poi_oakrest: 'hub',
    poi_greywood_run: 'greywood_run',
    poi_tuskfield: 'tuskfield',
    poi_stillmere: 'stillmere',
    poi_gloomweb: 'gloomweb',
    poi_rustvein_dig: 'rustvein_dig',
    poi_gallows_rise: 'gallows_rise',
    poi_castle_ashwood: 'castle_gate',
    poi_mourners_rest: 'mourners_rest',
  };

  it('every POI sits exactly on the landmark it names', () => {
    for (const w of ALL_WAYPOINTS) {
      const id = expected[w.id];
      expect(id, `waypoint ${w.id} has no landmark mapping`).toBeTruthy();
      expect(w.pos, `waypoint ${w.id}`).toEqual(landmarkPos(id));
    }
  });

  it('covers every waypoint (no POI left hand-placed)', () => {
    expect(ALL_WAYPOINTS.map((w) => w.id).sort()).toEqual(Object.keys(expected).sort());
  });
});

describe('mob camps', () => {
  // Realized positions as hand-placed before the landmark migration. This PR
  // re-expressed them as landmark + offset and must not have moved any of them.
  const REALIZED_SPAWNS: Record<string, { x: number; z: number }> = {
    z1_wolves_a: { x: -15, z: 55 },
    z1_wolves_b: { x: 20, z: 70 },
    z1_greyjaw: { x: 0, z: 95 },
    z1_boars_a: { x: 55, z: 12 },
    z1_boars_b: { x: 80, z: -15 },
    z1_spiders: { x: -60, z: 5 },
    z1_murlocs: { x: -75, z: 57 },
    z1_kobolds: { x: -82, z: -62 },
    z1_bandits_a: { x: 65, z: -65 },
    z1_bandits_b: { x: 90, z: -90 },
    z1_gorrak: { x: 92, z: -92 },
    z1_undead: { x: 80, z: 78 },
  };

  it('realize to their pinned positions', () => {
    for (const s of SPAWNS) {
      const want = REALIZED_SPAWNS[s.netId];
      expect(want, `spawn ${s.netId} missing from the position pin`).toBeTruthy();
      expect(s.pos, `spawn ${s.netId} moved`).toEqual(want);
    }
    expect(SPAWNS.length).toBe(Object.keys(REALIZED_SPAWNS).length);
  });

  it('sit within reach of the landmark they are anchored to', () => {
    // A camp more than 40 m from every landmark is orphaned — it belongs to no
    // POI, so no quest breadcrumb or map label can lead a player to it.
    for (const s of SPAWNS) {
      const nearest = Math.min(...ALL_LANDMARKS.map((l) => dist(s.pos, l)));
      expect(nearest, `spawn ${s.netId} is ${nearest.toFixed(1)}m from any landmark`)
        .toBeLessThanOrEqual(40);
    }
  });
});
