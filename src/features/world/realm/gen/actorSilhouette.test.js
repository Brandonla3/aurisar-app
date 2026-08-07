/**
 * actorSilhouette.test.js — P6's exit bar, as a machine can check it.
 *
 * The bar reads "stylized silhouettes readable at distance": species, class
 * and faction distinguishable by SILHOUETTE ALONE at gameplay camera range.
 * That sentence is an art aspiration until something measures it, and an
 * aspiration is exactly what the stack this replaces shipped. This file is
 * the mechanical form of it, built from model/silhouette.js's harness and
 * model/silhouetteGates.js's numbers, in seven groups:
 *
 *   1. WINDOW FIT      — nothing below is measuring a clipped mask.
 *   2. LOD FIDELITY    — an actor's far stage is the same body, coarser.
 *   3. DISTINCTNESS    — no two archetypes read as the same shape.
 *   4. IDENTIFICATION  — the far body a player sees IS the near one, and by
 *                        a margin over every impostor. The literal exit bar.
 *   5. ABLATION        — proof 3 and 4 are earned by mass allocation, not by
 *                        proportion knobs; and proof the gate can go red.
 *                        SPLIT OUT to gen/actorAblation.test.js in the P6
 *                        final fix round: this file hit 653 of its 700-line
 *                        ceiling, and ablation is the seam — every other
 *                        group measures the SHIPPED roster, group 5 measures
 *                        fixtures built from modified mass lists, which has
 *                        its own failure mode (a fixture that is silently not
 *                        what it says) and now its own guard.
 *   6. BAND OCCUPANCY  — where the mass sits, which is what an author edits.
 *   7. COLOUR CONTROL  — the gate cannot be satisfied by tint.
 *
 * ORDER MATTERS. Group 1 runs first because `canonicalStats` and
 * `bandOccupancy` score against a FIXED window, and a fixed window that clips
 * does not error — it silently bins the geometry outside it into nothing and
 * returns a smaller-than-real number that still looks plausible. Everything
 * from group 2 down is only meaningful once group 1 is green.
 *
 * MEASURE, NEVER COMPARE TO A STALE NUMBER. Every assertion here scores the
 * REAL generator (`buildActorPayload`) against a FIXED threshold. Earlier
 * tasks necessarily calibrated some constants against a stand-in for
 * `addMass` that predated it, and a small drift between stand-in and shipped
 * generator was measured then (legion's LOD mean/min, +0.005/+0.010, in the
 * safe direction). That drift is benign precisely BECAUSE this file
 * re-measures from scratch rather than asserting equality with a task-2-era
 * decimal. Do not "improve" this file by pinning it to previous numbers.
 *
 * The full pairwise matrix and per-archetype band histogram are logged the
 * way realmBudget.test.js and propGen.test.js log their actuals — a human
 * reading CI output should be able to see the roster's health at a glance,
 * and a future retune should read numbers instead of folklore.
 *
 * 45 GATES AND 3 REPORTERS, not 48 tests. The three whose names begin
 * `report:` exist to LOG the tables above; they assert nothing and cannot go
 * red. That is the same deal realmBudget.test.js's `[census]` logging makes
 * and it is worth keeping, but this project has now caught seven separate
 * tests that executed code without being able to fail, so the distinction is
 * named here rather than left for a future reader to discover by counting.
 * A `report:` test is documentation that runs; every other test is a gate.
 * (Group 5's 6 gates and 1 reporter moved to gen/actorAblation.test.js.)
 */
import { describe, expect, it } from 'vitest';
import { buildActorPayload } from './actorGen.js';
import { addMass } from './actorPrimitives.js';
import { finalize, newAccumulator } from './propPrimitives.js';
import {
  ARCHETYPES, CAP_LEVEL, FAR_COMP, SEG, archetypeById,
} from '../model/actorMasses.js';
import {
  ACTOR_WINDOW, bandOccupancy, canonicalStats, fitsWindow, maskIoU, rasterizeMask,
  silhouetteStats,
} from '../model/silhouette.js';
import {
  ACTOR_ID_MARGIN_MIN, ACTOR_LOD_IOU_MIN, ACTOR_LOD_WIDTH_DELTA_MAX,
  ACTOR_LOD_WORST_YAW_MIN, ACTOR_PAIR_IOU_MAX, GATE_PITCH_RAD, GATE_RES,
  SHOULDER_Y, WAIST_Y,
} from '../model/silhouetteGates.js';

const IDS = ARCHETYPES.map((a) => a.id);
const STAGES = [0, 1];
const STAGE_NAME = ['near', 'far'];

/**
 * Yaws every sweep below takes, evenly spaced over a full turn.
 *
 * EIGHT YAWS ARE NOT EIGHT VIEWS, and how far short they fall is per
 * archetype. A yaw and its opposite differ only by the body's front-back
 * asymmetry, and legion and magistari have almost none: their only depth
 * terms are legion's face-plate at z = 0.04 with its crown and crest tips,
 * and magistari's spine at z = -0.02. Measured at GATE_RES and gate pitch,
 * mask IoU between a yaw and its opposite:
 *
 *   magistari  0.974 - 0.981   effectively 4 distinct views
 *   legion     0.857 - 0.986   4 to 5
 *   orghon     0.654 - 0.811   the hunch is a real front-back signature
 *   unbound    0.506 - 0.757   the roster's only doubly-asymmetric body
 *
 * So `minIoU`/`maxIoU` over 8 yaws is a min/max over 4-5 independent samples
 * for the top two. That weakens nothing here — every gate reads the same
 * sweep and the roster sits far from its thresholds — but it does mean
 * raising YAWS is not the lever it looks like for legion and magistari:
 * their next genuinely new view comes from breaking a symmetry, not from
 * sampling one more angle of one they already have. The numbers above are
 * asserted, not narrated, by the last test in group 3.
 */
const YAWS = 8;

/** The one options bag every roster-wide comparison uses. Fixed window, gate
 *  pitch, gate resolution — a common yardstick is what makes "is A closer to
 *  B than to C?" a valid question at all (see silhouette.js's header). */
const PAIR_OPTS = {
  bounds: ACTOR_WINDOW, yawCount: YAWS, res: GATE_RES, pitchRad: GATE_PITCH_RAD,
};
const BAND_OPTS = {
  bounds: ACTOR_WINDOW, bandEdgesY: [WAIST_Y, SHOULDER_Y], yawCount: YAWS, res: GATE_RES,
};

/**
 * Minimum clearance between a payload and ACTOR_WINDOW's edges, as a fraction
 * of the window span. `fitsWindow` returning `fits: true` only proves the
 * margin is above ZERO, which is not a property worth defending: a roster
 * sitting 0.2% off the edge is one retune away from silently clipping, and a
 * clipped mask is a wrong measurement rather than a failure. 0.05 is the
 * target model/actorArchetypes.js already authors against (it is why
 * magistari's hem carries no cap — a hem cap collapsed its margin to 0.010).
 * Measured worst across the roster: 0.076 (magistari, far stage, gate pitch).
 */
const WINDOW_MARGIN_MIN = 0.05;

/**
 * Tolerance on a declared `bandTargets` entry. Bands are a MEASURED property
 * re-pasted into the archetype table, so the near stage agrees to within
 * 0.0005; the whole tolerance exists for the far stage, whose coarser
 * tessellation shifts area between bands. Measured worst far-stage deviation
 * across the roster: 0.0104 (unbound). 0.06 is the brief's declared starting
 * tolerance and sits ~6x above that, so a real authoring drift trips it while
 * tessellation noise never does.
 */
const BAND_TOLERANCE = 0.06;

/**
 * Orghon's above-shoulder band must be structurally EMPTY — its whole body
 * ends below where legion's face-plate begins, and that single zero is the
 * strongest separator in the roster (it is the only thing distinguishing
 * orghon from magistari, the other bottom-heavy body). A +/-0.06 tolerance
 * around a declared 0.001 has no teeth at all: it would pass anything up to
 * 0.061, i.e. a head. This asserts the structural claim directly.
 * Measured: 0.00106 near, 0.00000 far.
 */
const ORGHON_ABOVE_SHOULDER_MAX = 0.02;

/**
 * Floor on the L1 distance between any two archetypes' band histograms —
 * asserted in its own right rather than only through the pairwise IoU it
 * often precedes. Measured range: 0.324 (magistari x orghon, the roster's
 * structural weak spot — the two bottom-heavy bodies) up to 0.829 (legion x
 * orghon, the histogram opposites). 0.25 sits 23% below the worst measured
 * pair, so the gate trips when a NEW archetype lands on top of an existing
 * one in band space, which is one of the two ways the roster degrades (the
 * other — chassis convergence without a band shift — is what the pairwise
 * gate and ABLATED_WORST_MAX catch).
 */
const BAND_L1_MIN = 0.25;

// ── payload bank ────────────────────────────────────────────────────────────
// Built once. Every archetype at both stages is used by nearly every group,
// and a rasterized 48x48 mask over 8 yaws is not free.
const PAYLOAD = STAGES.map((s) => Object.fromEntries(IDS.map((id) => [id, buildActorPayload(id, s)])));
const PAIRS = IDS.flatMap((a, i) => IDS.slice(i + 1).map((b) => [a, b]));

/** meanIoU/minIoU for two payloads under the canonical yardstick. */
const pairIoU = (a, b) => canonicalStats(a, b, PAIR_OPTS);

/** Build a payload from an arbitrary mass list, at a shipped stage's exact
 *  tessellation. This is how every synthetic fixture below is produced: same
 *  primitives, same SEG/CAP_LEVEL/FAR_COMP as the real generator, only the
 *  mass list differs — so a fixture that scores badly does so because of its
 *  MASSES, never because it was built by a different code path. */
function buildFromMasses(masses, stage) {
  const acc = newAccumulator();
  for (const mass of masses) {
    addMass(acc, mass, {
      segments: SEG[stage], capLevel: CAP_LEVEL[stage], comp: stage === 0 ? 1 : FAR_COMP,
    });
  }
  return finalize(acc);
}

const f3 = (n) => n.toFixed(3);
const log = (line) => console.log(`[silhouette] ${line}`);
const pad = (s, n) => String(s).padEnd(n);

// ── 1. WINDOW FIT ───────────────────────────────────────────────────────────

describe('1. window fit — every measurement below is of an unclipped mask', () => {
  for (const id of IDS) {
    for (const stage of STAGES) {
      it(`${id} ${STAGE_NAME[stage]}: sits inside ACTOR_WINDOW at pitch 0 AND at the gate pitch`, () => {
        // Both pitches, because they clip differently: pitch tilts world-Y
        // into depth, so the gate pitch pushes the bottom of a deep body
        // (orghon's forward-hunched torso, magistari's hem) below where a
        // level eye sees it. Measuring only one would leave the other free
        // to clip.
        for (const pitchRad of [0, GATE_PITCH_RAD]) {
          const fit = fitsWindow(PAYLOAD[stage][id], { bounds: ACTOR_WINDOW, yawCount: YAWS, pitchRad });
          expect(fit.fits, `${id} s${stage} pitch ${f3(pitchRad)} CLIPS: margin ${f3(fit.worstMarginFrac)}`).toBe(true);
          expect(
            fit.worstMarginFrac,
            `${id} s${stage} pitch ${f3(pitchRad)} margin ${f3(fit.worstMarginFrac)} is under the ${WINDOW_MARGIN_MIN} target`,
          ).toBeGreaterThanOrEqual(WINDOW_MARGIN_MIN);
        }
      });
    }
  }
});

// ── 2. LOD FIDELITY ─────────────────────────────────────────────────────────

describe('2. LOD fidelity — the far stage is the same body, only coarser', () => {
  // Deliberately `silhouetteStats` with its DEFAULTS (8 yaws, res 32, per-pair
  // union window, no pitch), byte-for-byte the call propGen.test.js makes of
  // the props. This is the established LOD contract, and the union window is
  // the part that matters: normalizing each stage to its own bounds would
  // score a half-width far stage at IoU 1. Envelope mismatch is the pop this
  // catches, and only a shared window can see it.
  //
  // Measured through the real generator, res 32:
  //   unbound   mean 0.947  min 0.918  width 0.025
  //   legion    mean 0.950  min 0.927  width 0.037
  //   magistari mean 0.964  min 0.919  width 0.030
  //   orghon    mean 0.948  min 0.939  width 0.020
  // (At res 48 the same pairs read 0.941-0.958 mean, 0.901-0.920 min — the
  // gates hold at both, so the choice of 32 is about matching the props'
  // calibration, not about needing the easier number.)
  for (const id of IDS) {
    it(`${id}: stage 0 vs stage 1 clears mean ${ACTOR_LOD_IOU_MIN}, worst-yaw ${ACTOR_LOD_WORST_YAW_MIN}, width ${ACTOR_LOD_WIDTH_DELTA_MAX}`, () => {
      const s = silhouetteStats(PAYLOAD[0][id], PAYLOAD[1][id]);
      expect(s.meanIoU, `${id} LOD meanIoU=${f3(s.meanIoU)}`).toBeGreaterThanOrEqual(ACTOR_LOD_IOU_MIN);
      expect(s.minIoU, `${id} LOD minIoU=${f3(s.minIoU)}`).toBeGreaterThanOrEqual(ACTOR_LOD_WORST_YAW_MIN);
      expect(s.widthDeltaFrac, `${id} LOD widthDeltaFrac=${f3(s.widthDeltaFrac)}`).toBeLessThanOrEqual(ACTOR_LOD_WIDTH_DELTA_MAX);
    });
  }

  it('report: the LOD table (no assertion — see the file header)', () => {
    log(`LOD fidelity (silhouetteStats, union window, ${YAWS} yaws, res 32)`);
    log(`  gates: mean >= ${ACTOR_LOD_IOU_MIN}  worst-yaw >= ${ACTOR_LOD_WORST_YAW_MIN}  width <= ${ACTOR_LOD_WIDTH_DELTA_MAX}`);
    for (const id of IDS) {
      const s = silhouetteStats(PAYLOAD[0][id], PAYLOAD[1][id]);
      log(`  ${pad(id, 10)} mean ${f3(s.meanIoU)}  worst-yaw ${f3(s.minIoU)}  width ${f3(s.widthDeltaFrac)}`);
    }
  });
});

// ── 3. PAIRWISE DISTINCTNESS ────────────────────────────────────────────────

describe('3. pairwise distinctness — four factions, four silhouettes', () => {
  // Calibration reference points, all measured with this same harness: the
  // shipped tree props score 0.200 across species; the probe's
  // proportion-tweaked roster (one skeleton, per-faction multipliers) scored
  // 0.941 and its mass-reallocated rebuild 0.678. The gate is 0.72. This
  // roster measures worst-pair 0.506 near / 0.501 far.
  //
  // Both stages are asserted although the brief bars only the far one:
  // distance is where the claim has to hold, but a near-stage regression that
  // the far stage happens to smooth over is still a regression, and the extra
  // assertion costs one more matrix.
  for (const stage of STAGES) {
    for (const [a, b] of PAIRS) {
      it(`${STAGE_NAME[stage]}: ${a} x ${b} stays under ${ACTOR_PAIR_IOU_MAX}`, () => {
        const s = pairIoU(PAYLOAD[stage][a], PAYLOAD[stage][b]);
        expect(s.meanIoU, `${a} x ${b} s${stage} meanIoU=${f3(s.meanIoU)}`).toBeLessThanOrEqual(ACTOR_PAIR_IOU_MAX);
      });
    }
  }

  it('unbound x legion specifically — the pair that shares a chassis', () => {
    // Named on its own because these two are the roster's near-identical
    // biped chassis, differing mainly in radius. What actually separates
    // them is unbound's graft arm and legion's mask stack (group 5 measures
    // that contribution); nothing structural stops a future edit from
    // leaning on the radius multipliers instead, and this pair gate is the
    // only thing that would catch it. Measured 0.483 near / 0.486 far.
    for (const stage of STAGES) {
      const s = pairIoU(PAYLOAD[stage].unbound, PAYLOAD[stage].legion);
      expect(s.meanIoU, `unbound x legion s${stage} = ${f3(s.meanIoU)}`).toBeLessThanOrEqual(ACTOR_PAIR_IOU_MAX);
    }
  });

  it('magistari x orghon specifically — the roster\'s structural weak spot', () => {
    // The two bottom-heavy bodies, and the worst pair at both stages (0.506
    // near / 0.501 far against a 0.72 gate). Any future bottom-heavy
    // archetype lands on top of these two first, so this pair is where the
    // roster degrades before anywhere else.
    //
    // CARRY-FORWARD, the above-shoulder band. Orghon is separated from
    // magistari by a STRUCTURAL ZERO — it has no above-shoulder occupancy at
    // all (0.001), which is why ORGHON_ABOVE_SHOULDER_MAX exists and is the
    // strongest single separator in the roster. Legion and magistari have no
    // such luxury: both HAVE above-shoulder mass (0.415 and 0.163) and are
    // told apart by its SHAPE, not by its presence — a face-plate-and-crest
    // bar versus a cowl-and-spine. That is a weaker kind of separation, and
    // there is deliberately no legion/magistari equivalent of the orghon
    // gate because no such structural claim is true. Benign today (0.417
    // near / 0.411 far, band L1 0.582), but the above-shoulder band is
    // already the crowded one: a FIFTH archetype whose herald also lives up
    // there arrives into two occupants rather than the empty band orghon
    // enjoys, and it will land on this pair, not on magistari x orghon.
    for (const stage of STAGES) {
      const s = pairIoU(PAYLOAD[stage].magistari, PAYLOAD[stage].orghon);
      expect(s.meanIoU, `magistari x orghon s${stage} = ${f3(s.meanIoU)}`).toBeLessThanOrEqual(ACTOR_PAIR_IOU_MAX);
    }
  });

  it('logs the full pairwise matrix AND gates its argmax', () => {
    // THE COLUMNS SAY WHAT THEY MEAN. This table printed `minIoU` under a
    // "worst" heading until the P6 review, which had it exactly backwards:
    // distinctness is a CEILING, so a pair's worst yaw is the one where the
    // two archetypes look MOST alike — maxIoU. minIoU is the angle they are
    // best separated at, i.e. the flattering number. A reader scanning the
    // "worst" column for trouble was reading the column that cannot show it.
    log(`pairwise canonical IoU (fixed ACTOR_WINDOW, pitch ${f3(GATE_PITCH_RAD)} rad, res ${GATE_RES}, ${YAWS} yaws)`);
    log(`  gate: mean <= ${ACTOR_PAIR_IOU_MAX}   props across species measure 0.200; the rejected proportion roster measured 0.941`);
    log('  max = the yaw where the pair looks MOST alike (the worst case for a ceiling gate)');
    log(`  ${pad('pair', 24)} ${pad('near mean', 11)}${pad('near max', 11)}${pad('far mean', 10)}far max`);
    let worst = { iou: -1, label: '' };
    for (const [a, b] of PAIRS) {
      const n = pairIoU(PAYLOAD[0][a], PAYLOAD[0][b]);
      const f = pairIoU(PAYLOAD[1][a], PAYLOAD[1][b]);
      log(`  ${pad(`${a} x ${b}`, 24)} ${pad(f3(n.meanIoU), 11)}${pad(f3(n.maxIoU), 11)}${pad(f3(f.meanIoU), 10)}${f3(f.maxIoU)}`);
      for (const [iou, tag] of [[n.meanIoU, 'near'], [f.meanIoU, 'far']]) {
        if (iou > worst.iou) worst = { iou, label: `${a} x ${b} (${tag})` };
      }
    }
    log(`  worst pair by mean: ${worst.label} = ${f3(worst.iou)}  (headroom ${f3(ACTOR_PAIR_IOU_MAX - worst.iou)})`);
    expect(worst.iou).toBeLessThanOrEqual(ACTOR_PAIR_IOU_MAX);
  });

  it('the max column really is the worse one — it is not a relabelled min', () => {
    // Cheap guard on the correction above: if maxIoU were wired to the same
    // number as minIoU, or the log went back to printing min under a "max"
    // heading, this notices. Measured spread on the shipped roster: every
    // pair's max exceeds its min, by 0.031 (magistari x orghon) to 0.124
    // (unbound x orghon).
    for (const [a, b] of PAIRS) {
      const s = pairIoU(PAYLOAD[0][a], PAYLOAD[0][b]);
      expect(s.maxIoU, `${a} x ${b}`).toBeGreaterThan(s.minIoU);
      expect(s.maxIoU, `${a} x ${b}`).toBeGreaterThanOrEqual(s.meanIoU);
      expect(s.minIoU, `${a} x ${b}`).toBeLessThanOrEqual(s.meanIoU);
    }
  });

  it('how much front-back symmetry the yaw sweep is spending yaws on', () => {
    // Backs the YAWS comment with the measurement instead of a claim. Also a
    // real gate on unbound's stated signature: its own archetype comment
    // calls it "the only archetype whose silhouette is not left-right
    // symmetric... a signature the band histogram cannot even see", and
    // nothing else in this suite checks that the asymmetry survives a retune.
    const worstSelfPair = (id) => {
      const p = PAYLOAD[0][id];
      const mask = (yaw) => rasterizeMask(p, yaw, ACTOR_WINDOW, GATE_RES, GATE_PITCH_RAD);
      let worst = 0;
      for (let k = 0; k < YAWS / 2; k++) {
        const yaw = (k / YAWS) * Math.PI * 2;
        worst = Math.max(worst, maskIoU(mask(yaw), mask(yaw + Math.PI)));
      }
      return worst;
    };
    const measured = Object.fromEntries(IDS.map((id) => [id, worstSelfPair(id)]));
    log(`front-back self-similarity, worst (highest) opposite-yaw IoU, res ${GATE_RES}`);
    for (const id of IDS) log(`  ${pad(id, 10)} ${f3(measured[id])}`);
    // Measured 0.757; the floor is well below it because the claim being
    // defended is "clearly asymmetric", not a tuned value.
    expect(
      measured.unbound,
      `unbound's silhouette is now ${f3(measured.unbound)} self-similar front-to-back. It is the roster's `
      + 'ONLY asymmetric body and that is the signature the band histogram cannot see — if the graft arm '
      + 'stopped breaking symmetry, the distinctness gates lost a separator they are not measuring',
    ).toBeLessThan(0.85);
    // ...and the two symmetric ones really are, which is the fact the YAWS
    // comment is warning a future author about.
    expect(measured.magistari).toBeGreaterThan(0.90);
    expect(measured.legion).toBeGreaterThan(0.90);
  });
});

// ── 4. IDENTIFICATION MARGIN ────────────────────────────────────────────────

describe('4. identification margin — the exit bar, stated mechanically', () => {
  // "Distinguishable by silhouette alone at gameplay camera distance" is a
  // NEAREST-NEIGHBOUR claim, not a ceiling: take the body a player just saw
  // up close, walk away until it swaps to its far LOD, and the far effigy
  // they now see must still be the nearest match to that body — by a margin
  // over every impostor. A fixed ceiling cannot say this (it says nothing
  // about which archetype is closest), and it does not scale with the roster
  // the way a margin does.
  //
  // Measured margins: unbound 0.473, legion 0.474, magistari 0.454,
  // orghon 0.440 — against a 0.15 floor. Self-match runs 0.947-0.960; the
  // best impostor never beats 0.507.
  for (const id of IDS) {
    it(`${id}: its own far stage is the nearest match, by more than ${ACTOR_ID_MARGIN_MIN}`, () => {
      const ranked = IDS
        .map((other) => ({ other, iou: pairIoU(PAYLOAD[0][id], PAYLOAD[1][other]).meanIoU }))
        .sort((x, y) => y.iou - x.iou);
      const detail = ranked.map((r) => `${r.other}=${f3(r.iou)}`).join(' ');
      expect(ranked[0].other, `${id}'s near stage matches the WRONG far effigy: ${detail}`).toBe(id);
      expect(
        ranked[0].iou - ranked[1].iou,
        `${id} identification margin ${f3(ranked[0].iou - ranked[1].iou)} (runner-up ${ranked[1].other}): ${detail}`,
      ).toBeGreaterThan(ACTOR_ID_MARGIN_MIN);
    });
  }

  it('report: the identification table (no assertion — see the file header)', () => {
    log(`identification margin (near stage vs every far effigy), floor > ${ACTOR_ID_MARGIN_MIN}`);
    for (const id of IDS) {
      const ranked = IDS
        .map((other) => ({ other, iou: pairIoU(PAYLOAD[0][id], PAYLOAD[1][other]).meanIoU }))
        .sort((x, y) => y.iou - x.iou);
      log(`  ${pad(id, 10)} ${pad(ranked.map((r) => `${r.other}=${f3(r.iou)}`).join('  '), 58)} margin ${f3(ranked[0].iou - ranked[1].iou)}`);
    }
  });
});

// ── 6. BAND OCCUPANCY ───────────────────────────────────────────────────────

describe('6. band occupancy — the authoring-side indicator, held to its declared table', () => {
  // The band histogram — [below-waist, torso, above-shoulder] fractions of
  // filled silhouette area — is what an author can actually EDIT against,
  // which is why every archetype declares its measured values as
  // `bandTargets`. Pairwise IoU tells you a pair has converged; the histogram
  // tells you where.
  //
  // COMPLEMENTARY, not strictly leading-and-lagging. Either can fire first
  // depending on the edit, and both directions have been observed: raising
  // orghon's head above SHOULDER_Y collapses band L1 to 0.077 while pairwise
  // IoU stays green, and narrowing legion's chassis pushes pairwise to 0.733
  // (past 0.72) while band L1 sits comfortably at 0.359. A roster can
  // converge in silhouette without moving its band budget and vice versa, so
  // both gates ship.
  //
  // bandOccupancy is defined at pitch 0 ONLY (see its own doc: under pitch a
  // mask row stops mapping to a single world-Y, so the metric would return
  // plausible numbers for the wrong thing). Two interior edges therefore give
  // exactly three bands, which the first assertion pins.
  for (const id of IDS) {
    for (const stage of STAGES) {
      it(`${id} ${STAGE_NAME[stage]}: bandOccupancy matches its declared bandTargets within ${BAND_TOLERANCE}`, () => {
        const measured = bandOccupancy(PAYLOAD[stage][id], BAND_OPTS);
        const declared = archetypeById(id).bandTargets;

        expect(measured.length, 'two interior edges must yield exactly three bands').toBe(3);
        expect(declared.length, `${id} declares the wrong number of bandTargets`).toBe(3);
        expect(measured.reduce((s, v) => s + v, 0), `${id} s${stage} bands must sum to 1`).toBeCloseTo(1, 6);

        for (let b = 0; b < 3; b++) {
          expect(
            Math.abs(measured[b] - declared[b]),
            `${id} s${stage} band ${b}: measured ${f3(measured[b])} vs declared ${f3(declared[b])} — `
            + 'if the geometry moved on purpose, re-paste the MEASURED value into model/actorArchetypes.js '
            + 'with its evidence; never widen this tolerance',
          ).toBeLessThanOrEqual(BAND_TOLERANCE);
        }
      });
    }
  }

  for (const stage of STAGES) {
    it(`orghon ${STAGE_NAME[stage]}: above-shoulder occupancy is structurally empty (< ${ORGHON_ABOVE_SHOULDER_MAX})`, () => {
      // Asserted separately from the tolerance check above because +/-0.06
      // around a declared 0.001 would accept 0.061 — a whole head — while
      // still calling itself a match. Orghon's entire body ending below
      // SHOULDER_Y is the single strongest separator in the roster and the
      // only thing that keeps it apart from magistari; it deserves a gate
      // that says so. Measured 0.00106 near, 0.00000 far.
      const measured = bandOccupancy(PAYLOAD[stage].orghon, BAND_OPTS);
      expect(
        measured[2],
        `orghon s${stage} above-shoulder = ${measured[2].toFixed(5)} — orghon must end below SHOULDER_Y (${SHOULDER_Y} m)`,
      ).toBeLessThan(ORGHON_ABOVE_SHOULDER_MAX);
    });
  }

  it(`every pair of band histograms stays at least ${BAND_L1_MIN} apart in L1`, () => {
    const bands = Object.fromEntries(IDS.map((id) => [id, bandOccupancy(PAYLOAD[0][id], BAND_OPTS)]));
    for (const [a, b] of PAIRS) {
      const l1 = bands[a].reduce((sum, v, i) => sum + Math.abs(v - bands[b][i]), 0);
      expect(
        l1,
        `${a} x ${b} band L1 = ${f3(l1)} — these two now occupy the same vertical bands, which is how the `
        + 'roster degrades: the pairwise IoU gate will follow',
      ).toBeGreaterThanOrEqual(BAND_L1_MIN);
    }
  });

  it('report: the band histogram and L1 matrix (no assertion — see the file header)', () => {
    log(`band histogram [below-waist, torso, above-shoulder], edges WAIST_Y=${WAIST_Y} SHOULDER_Y=${SHOULDER_Y}, res ${GATE_RES}, pitch 0`);
    for (const id of IDS) {
      const near = bandOccupancy(PAYLOAD[0][id], BAND_OPTS);
      const far = bandOccupancy(PAYLOAD[1][id], BAND_OPTS);
      const declared = archetypeById(id).bandTargets;
      log(`  ${pad(id, 10)} near [${near.map(f3).join(' ')}]  far [${far.map(f3).join(' ')}]  declared [${declared.map(f3).join(' ')}]`);
    }
    log(`band L1 distance between archetypes (floor ${BAND_L1_MIN})`);
    const bands = Object.fromEntries(IDS.map((id) => [id, bandOccupancy(PAYLOAD[0][id], BAND_OPTS)]));
    for (const [a, b] of PAIRS) {
      const l1 = bands[a].reduce((sum, v, i) => sum + Math.abs(v - bands[b][i]), 0);
      log(`  ${pad(`${a} x ${b}`, 24)} ${f3(l1)}`);
    }
  });
});

// ── 7. COLOUR CONTROL ───────────────────────────────────────────────────────

describe('7. colour control — the gate cannot be satisfied by tint', () => {
  // The point is NOT the tautology "rasterizeMask never reads vertex colours".
  // The point is what that implies for the exit bar: two actors that differ
  // ONLY in faction palette are, to this gate, the SAME actor. They score
  // IoU 1.000 and FAIL the distinctness ceiling outright. So a faction cannot
  // buy readability with a colour — that is exactly the failure mode the
  // 0.941 proportion-roster probe was a milder version of, and it is why
  // model/actorArchetypes.js authors identity as mass allocation and treats
  // its palettes as up-close flavour only.
  const recolour = (masses, color) => masses.map((m) => ({ ...m, color }));
  const unboundMasses = archetypeById('unbound').masses;
  const paleFaction = buildFromMasses(recolour(unboundMasses, [0.95, 0.94, 0.90]), 0);
  const darkFaction = buildFromMasses(recolour(unboundMasses, [0.06, 0.05, 0.08]), 0);

  it('the two fixtures really are geometry-identical and colour-different', () => {
    // Without this the group is vacuous: two payloads that differed in
    // nothing at all would also score 1.
    expect(paleFaction.positions).toEqual(darkFaction.positions);
    expect(paleFaction.indices).toEqual(darkFaction.indices);
    expect(paleFaction.colors).not.toEqual(darkFaction.colors);
    let maxChannelDelta = 0;
    for (let i = 0; i < paleFaction.colors.length; i++) {
      maxChannelDelta = Math.max(maxChannelDelta, Math.abs(paleFaction.colors[i] - darkFaction.colors[i]));
    }
    expect(maxChannelDelta, 'the two palettes must be far apart, not a shade off').toBeGreaterThan(0.8);
  });

  it('they score IoU exactly 1 and therefore FAIL the distinctness ceiling', () => {
    const s = pairIoU(paleFaction, darkFaction);
    expect(s.meanIoU, 'a repaint must not move the silhouette at all').toBe(1);
    expect(s.minIoU, 'not at any single yaw either').toBe(1);
    expect(
      s.meanIoU,
      `two actors differing only in palette score ${f3(s.meanIoU)} and must be REJECTED by the `
      + `${ACTOR_PAIR_IOU_MAX} distinctness gate — a faction cannot become readable by changing colour`,
    ).toBeGreaterThan(ACTOR_PAIR_IOU_MAX);
  });

  it('and the same holds for a colour-blind viewer, by construction', () => {
    // A colour-blindness simulation is a per-channel remap of the colours,
    // and the mask is built from positions and indices alone. Every possible
    // remap therefore lands on the identical mask — including the total loss
    // case, greyscale. Asserting it against a THIRD palette rather than
    // reasoning about it keeps the claim measured.
    const greyscale = buildFromMasses(recolour(unboundMasses, [0.5, 0.5, 0.5]), 0);
    expect(pairIoU(paleFaction, greyscale).meanIoU).toBe(1);
    expect(pairIoU(darkFaction, greyscale).meanIoU).toBe(1);
  });
});
