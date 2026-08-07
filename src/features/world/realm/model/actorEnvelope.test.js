/**
 * actorEnvelope.test.js — the customs audit for the posed-culling envelope.
 *
 * Same shape as actorBudget.test.js: declared numbers must equal generated
 * numbers, both directions, exactly, with paste-ready actuals on drift. The
 * declaration is what `view/actor/ActorRig.js` spends at runtime, so unlike
 * ACTOR_MANIFEST's costs this one is not a ceiling a test defends in private —
 * a stale number here is a limb that gets culled on screen.
 *
 * PURE: no NullEngine, no BABYLON. The live half — that a real cloned mesh's
 * bounding box actually contains every posed vertex — is
 * view/actor/ActorRigSkin.test.js's, because only there is there a mesh.
 *
 * ANTI-VACUITY, stated because this file could so easily be written without
 * it: `overhangM` is 0 on both magistari stages (its one non-root bone barely
 * reaches past the robe), so a bug that measured nothing at all would still
 * match two of the eight declarations. The `travelM` column is measured on the
 * same pass and is non-zero everywhere, and the sanity block below asserts the
 * roster's worst overhang is a real distance rather than a rounding artefact.
 */
import { describe, expect, it } from 'vitest';
import { buildActorPayload } from '../gen/actorGen.js';
import { skinPayload } from '../gen/actorSkin.js';
import { ARCHETYPES } from './actorMasses.js';
import { buildActorRig, evaluatePose } from './actorRig.js';
import { CANARY_POSE } from './actorCanary.js';
import { ACTOR_POSE_MARGIN_M, POSE_ENVELOPE_MANIFEST } from './actorEnvelope.js';

/**
 * The two measured metres for one master, exactly as the manifest declares
 * them: the largest distance a posed vertex sits outside the REST box (over
 * all six faces), and the largest distance any vertex moves.
 */
function measure(archetypeId, stage) {
  const payload = buildActorPayload(archetypeId, stage);
  const rig = buildActorRig(archetypeId);
  const posed = skinPayload(payload, rig, evaluatePose(rig, CANARY_POSE[archetypeId])).positions;
  const rest = payload.positions;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < rest.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      if (rest[i + a] < min[a]) min[a] = rest[i + a];
      if (rest[i + a] > max[a]) max[a] = rest[i + a];
    }
  }
  let overhang = 0;
  let travel = 0;
  for (let i = 0; i < posed.length; i += 3) {
    for (let a = 0; a < 3; a++) {
      overhang = Math.max(overhang, min[a] - posed[i + a], posed[i + a] - max[a]);
    }
    travel = Math.max(travel, Math.hypot(
      posed[i] - rest[i], posed[i + 1] - rest[i + 1], posed[i + 2] - rest[i + 2],
    ));
  }
  return { overhangM: Number(overhang.toFixed(4)), travelM: Number(travel.toFixed(4)) };
}

const PAIRS = ARCHETYPES.flatMap((a) => (
  Array.from({ length: a.stages }, (_, stage) => ({ id: a.id, stage }))
));

describe('manifest completeness — both directions', () => {
  it('every archetype has an envelope entry with the right stage count', () => {
    for (const arch of ARCHETYPES) {
      const entry = POSE_ENVELOPE_MANIFEST[arch.id];
      expect(entry, `${arch.id} missing from POSE_ENVELOPE_MANIFEST`).toBeTruthy();
      expect(entry.length, `${arch.id} stage count`).toBe(arch.stages);
    }
  });

  it('every manifest key is a real archetype — no ghost cargo', () => {
    const ids = new Set(ARCHETYPES.map((a) => a.id));
    for (const key of Object.keys(POSE_ENVELOPE_MANIFEST)) {
      expect(ids.has(key), `envelope entry "${key}" has no archetype`).toBe(true);
    }
  });
});

describe('declared envelope equals measured envelope', () => {
  for (const { id, stage } of PAIRS) {
    it(`${id} stage ${stage} matches its declaration`, () => {
      const actual = measure(id, stage);
      expect(
        actual,
        `${id}[${stage}] drifted — update POSE_ENVELOPE_MANIFEST to ${JSON.stringify(actual)}`,
      ).toEqual(POSE_ENVELOPE_MANIFEST[id][stage]);
    });
  }
});

describe('the margin covers the envelope', () => {
  const all = PAIRS.map(({ id, stage }) => ({ id, stage, ...POSE_ENVELOPE_MANIFEST[id][stage] }));

  it('is at least the roster-wide worst TRAVEL, not merely the worst overhang', () => {
    // The headroom argument in actorEnvelope.js's header, as an assertion:
    // overhang can never exceed travel, so a margin >= worst travel covers any
    // re-aiming of a pose this size. Sizing it off the overhang alone would
    // bake the canary's particular aim into the culler.
    const worstTravel = Math.max(...all.map((e) => e.travelM));
    const worstOverhang = Math.max(...all.map((e) => e.overhangM));
    expect(worstTravel).toBeGreaterThan(worstOverhang);
    expect(
      ACTOR_POSE_MARGIN_M,
      `margin ${ACTOR_POSE_MARGIN_M} m no longer covers the roster's worst posed-vertex travel `
      + `(${worstTravel} m). See actorEnvelope.js's REVISIT TRIGGER: raise the constant to the `
      + 'new worst travel, do not switch to per-archetype margins without re-arguing aim-independence.',
    ).toBeGreaterThanOrEqual(worstTravel);
  });

  it('covers every single master with room to spare', () => {
    for (const e of all) {
      expect(e.overhangM, `${e.id}[${e.stage}] overhangs the margin`).toBeLessThan(ACTOR_POSE_MARGIN_M);
      expect(e.travelM, `${e.id}[${e.stage}] travels past the margin`).toBeLessThanOrEqual(ACTOR_POSE_MARGIN_M);
    }
  });

  it('the fault it exists for is REAL — the roster genuinely overhangs its rest box', () => {
    // Anti-vacuity for the whole file. If this ever reads ~0 the production
    // expansion has become dead weight and should be argued for again, not
    // kept because a green test says nothing.
    const worstOverhang = Math.max(...all.map((e) => e.overhangM));
    expect(worstOverhang, 'no master overhangs at all — why is there a margin?').toBeGreaterThan(0.1);
    expect(PAIRS.length, 'the roster shrank; re-read this file before trusting it').toBe(8);
  });

  it('is a plain positive finite number of metres', () => {
    expect(Number.isFinite(ACTOR_POSE_MARGIN_M)).toBe(true);
    expect(ACTOR_POSE_MARGIN_M).toBeGreaterThan(0);
  });
});
