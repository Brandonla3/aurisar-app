import { describe, it, expect } from 'vitest';
import { calcExEntryXP, calcWorkoutXP } from '../xp';

/**
 * Guards preview/award XP parity. PR #264 unified the builder XP preview onto
 * the award-path formula (calcWorkoutXP → useWorkoutCompletion): a blank extra
 * row scores 3x10 independently, NOT the base row's sets/reps. The builder
 * total and per-row badges route through calcExEntryXP, which must equal the
 * award path's per-exercise contribution.
 *
 * Synthetic catalog so baseXP is fixed and the arithmetic is checkable by hand
 * (calcExXP accepts an injected lookup: xp.js `(exLookup||EX_BY_ID)[exId]`).
 * classKey=null keeps the class multiplier at 1.
 */
const exLookup = {
  push: { id: 'push', baseXP: 100, category: 'strength', tracksWeight: true },
  jog:  { id: 'jog',  baseXP: 100, category: 'cardio' },
};

// calcExXP core: round(baseXP * mult * (1 + (sets*reps - 1) * 0.05) * ...bonuses)
// classKey=null => mult=1; distance/weight/hr=null => those bonuses=1.
const BASE_4x10 = 295; // round(100 * (1 + (4*10 - 1) * 0.05)) = round(100 * 2.95)
const ROW_3x10  = 245; // round(100 * (1 + (3*10 - 1) * 0.05)) = round(100 * 2.45)

describe('calcExEntryXP — preview/award parity', () => {
  it('equals the per-exercise contribution of the award-path calcWorkoutXP', () => {
    const ex = { exId: 'push', sets: 4, reps: 10, extraRows: [{ sets: '', reps: '' }] };
    expect(calcExEntryXP(ex, null, exLookup)).toBe(calcWorkoutXP({ exercises: [ex] }, null, exLookup));
  });

  it('scores a blank extra row as 3x10, NOT the base row 4x10 (the old preview bug)', () => {
    const ex = { exId: 'push', sets: 4, reps: 10, extraRows: [{ sets: '', reps: '' }] };
    const baseOnly = calcExEntryXP({ exId: 'push', sets: 4, reps: 10 }, null, exLookup);

    expect(baseOnly).toBe(BASE_4x10);                                       // 295
    expect(calcExEntryXP(ex, null, exLookup)).toBe(BASE_4x10 + ROW_3x10);   // 540

    // The blank row contributes the 3x10 amount...
    expect(calcExEntryXP(ex, null, exLookup) - baseOnly).toBe(ROW_3x10);    // 245
    // ...NOT the inherited base 4x10 amount.
    expect(calcExEntryXP(ex, null, exLookup) - baseOnly).not.toBe(BASE_4x10);
  });

  it('applies the cardio interval bonus (1.25x) to every row, in parity with the award path', () => {
    const cardioEx = { exId: 'jog', sets: 1, reps: 10, extraRows: [{ sets: 1, reps: 10 }] };
    // Each row: round(100 * (1 + (1*10 - 1) * 0.05) * 1.25) = round(100 * 1.45 * 1.25) = 181
    expect(calcExEntryXP(cardioEx, null, exLookup)).toBe(181 * 2); // 362
    expect(calcExEntryXP(cardioEx, null, exLookup))
      .toBe(calcWorkoutXP({ exercises: [cardioEx] }, null, exLookup));
  });
});
