import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { planQuickLogRows } from '../../../utils/quickLogRows';
import { calcExXP } from '../../../utils/xp';

/**
 * Set Forge parity guard. The quick log's per-set rows must never fork the
 * write path: the modal's Projected XP and logExercise's written entries both
 * consume planQuickLogRows, and this suite pins the planner's contract —
 * (a) with no extra rows it is the old single-entry math bit-for-bit,
 * (b) extra rows are priced with the PRIMARY working weight + extraCount,
 * (c) the typed weight (already intensity-scaled) flows into every row,
 * plus a source-level check that BOTH consumers actually import the planner.
 */

const STRENGTH = { id: 'stub_bench', baseXP: 50, category: 'strength', muscleGroup: 'chest', tracksWeight: true };
const CARDIO = { id: 'stub_row', baseXP: 40, category: 'cardio', muscleGroup: 'cardio', tracksWeight: false };
const BY_ID = { [STRENGTH.id]: STRENGTH, [CARDIO.id]: CARDIO };

const base = over => ({
  exId: STRENGTH.id, category: 'strength', noSets: false, chosenClass: null, allExById: BY_ID,
  sets: '3', reps: '10', exWeight: '135', exHHMM: '', exSec: '', distanceVal: '', quickRows: [],
  metric: false, hrZone: null, ...over,
});

describe('planQuickLogRows — Set Forge parity', () => {
  it('with no extra rows, equals the old single-entry calcExXP call exactly', () => {
    const plan = planQuickLogRows(base());
    const legacy = calcExXP(STRENGTH.id, 3, 10, null, BY_ID, null, 135, null);
    expect(plan.rows).toHaveLength(1);
    expect(plan.totalXP).toBe(legacy);
    expect(plan.rows[0]).toMatchObject({ primary: true, sets: 3, reps: 10, weightLbs: 135, distanceMi: null });
  });

  it('prices every extra row with the PRIMARY weight and the shared extraCount', () => {
    const plan = planQuickLogRows(base({
      quickRows: [
        { sets: '1', reps: '8', weightLbs: '155' },
        { sets: '', reps: '', weightLbs: '' }, // blanks inherit primary sets/reps
      ],
    }));
    expect(plan.rows).toHaveLength(3);
    // Row 2 records its own 155 but is PRICED at the primary 135 (the
    // estimator's historical contract — the weight bonus rides the working load).
    expect(plan.rows[1].weightLbs).toBe(155);
    expect(plan.rows[1].xp).toBe(calcExXP(STRENGTH.id, 1, 8, null, BY_ID, null, 135, null, 2));
    expect(plan.rows[1].xp).not.toBe(calcExXP(STRENGTH.id, 1, 8, null, BY_ID, null, 555, null, 2));
    // Blank extra row inherits 3×10 and records no weight of its own.
    expect(plan.rows[2]).toMatchObject({ sets: 3, reps: 10, weightLbs: null });
    expect(plan.rows[2].xp).toBe(calcExXP(STRENGTH.id, 3, 10, null, BY_ID, null, 135, null, 2));
    // The primary row itself is priced with extraCount (interval-bonus seam).
    expect(plan.rows[0].xp).toBe(calcExXP(STRENGTH.id, 3, 10, null, BY_ID, null, 135, null, 2));
    expect(plan.totalXP).toBe(plan.rows.reduce((s, r) => s + r.xp, 0));
  });

  it('the intensity-scaled typed weight flows into all rows; metric input converts to lbs', () => {
    const at100 = planQuickLogRows(base());
    const at200 = planQuickLogRows(base({ exWeight: '270' })); // the % ruler rescales the typed value
    expect(at200.totalXP).toBeGreaterThanOrEqual(at100.totalXP);
    expect(at200.effW).toBe(270);

    const kg = planQuickLogRows(base({ metric: true, exWeight: '100', quickRows: [{ sets: '1', reps: '5', weightLbs: '110' }] }));
    expect(kg.effW).toBeCloseTo(220.5, 0); // 100 kg → lbs
    expect(kg.rows[1].weightLbs).toBeCloseTo(242.5, 0); // 110 kg → lbs, recorded per-row
  });

  it('cardio rows derive minutes and gain the interval bonus via extraCount', () => {
    const plan = planQuickLogRows(base({
      exId: CARDIO.id, category: 'cardio', exWeight: '',
      exHHMM: '00:20', exSec: '', reps: '',
      quickRows: [{ hhmm: '00:10', sec: '', dist: '' }],
    }));
    expect(plan.rv).toBe(20);
    expect(plan.rows[1].reps).toBe(10);
    expect(plan.rows[0].xp).toBe(calcExXP(CARDIO.id, plan.sv, 20, null, BY_ID, null, null, null, 1));
  });

  it('an untouched (fully blank) timed extra row inherits the primary duration and distance, never a bare 1-minute row', () => {
    // "＋ Add Interval" creates a row with no hhmm/sec/dist typed. Math.max(1, 0)
    // is truthy, so the old `|| rv` fallback could never fire — a 30-minute,
    // 2-mile primary with one blank interval used to persist and price that
    // row as 1 minute with a null distance.
    const plan = planQuickLogRows(base({
      exId: CARDIO.id, category: 'cardio', exWeight: '',
      exHHMM: '00:30', exSec: '', reps: '', distanceVal: '2',
      quickRows: [{ hhmm: '', sec: '', dist: '' }],
    }));
    expect(plan.rv).toBe(30);
    expect(plan.distMi).toBe(2);
    expect(plan.rows[1]).toMatchObject({ reps: 30, distanceMi: 2 });
    expect(plan.rows[1].xp).toBe(calcExXP(CARDIO.id, plan.sv, 30, null, BY_ID, 2, null, null, 1));
    // A row where the user typed 0 seconds (a real, if unusual, choice) is
    // NOT blank and must still price at its own (near-zero) duration.
    const typedZero = planQuickLogRows(base({
      exId: CARDIO.id, category: 'cardio', exWeight: '',
      exHHMM: '00:30', exSec: '', reps: '', distanceVal: '2',
      quickRows: [{ hhmm: '00:00', sec: '5', dist: '' }],
    }));
    expect(typedZero.rows[1].reps).toBe(1); // Math.max(1, floor(5s/60)) = 1
    expect(typedZero.rows[1].distanceMi).toBe(2); // still inherits primary distance
  });

  it('an extra row with its own distance keeps it, unaffected by primary fallback', () => {
    const plan = planQuickLogRows(base({
      exId: CARDIO.id, category: 'cardio', exWeight: '',
      exHHMM: '00:30', exSec: '', reps: '', distanceVal: '2',
      quickRows: [{ hhmm: '00:15', sec: '', dist: '0.75' }],
    }));
    expect(plan.rows[1]).toMatchObject({ reps: 15, distanceMi: 0.75 });
  });
});

describe('single write path (source-level)', () => {
  const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
  it('both the modal estimate and logExercise consume planQuickLogRows', () => {
    const modal = readFileSync(ROOT + 'src/features/exercises/QuickLogModal.jsx', 'utf8');
    const app = readFileSync(ROOT + 'src/App.jsx', 'utf8');
    expect(modal).toContain('planQuickLogRows(');
    expect(app).toContain('planQuickLogRows(');
    // The modal must not keep a private duplicate of the row-XP math.
    expect(modal).not.toMatch(/rowsXP/);
  });

  it('Add to Workout builds its entry from rowPlan (not raw sets/reps state), carrying extra rows through', () => {
    // rowPlan.rows[0] already holds the correctly-derived sets/reps/weight/
    // distance (timed duration via combineHHMMSec, noSets handling, etc) —
    // re-deriving from the raw `sets`/`reps` strings here used to silently
    // drop a typed duration and every Set Forge extra row.
    const modal = readFileSync(ROOT + 'src/features/exercises/QuickLogModal.jsx', 'utf8');
    const marker = 'Add to Workout';
    const btnStart = modal.lastIndexOf('onClick', modal.indexOf(marker));
    const btnBody = modal.slice(btnStart, modal.indexOf(marker) + marker.length);
    expect(btnBody).toContain('rowPlan.rows');
    expect(btnBody).toContain('extraRows');
    expect(btnBody).not.toMatch(/parseInt\(sets\)/);
    expect(btnBody).not.toMatch(/parseInt\(reps\)/);
  });
});
