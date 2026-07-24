import { describe, expect, it } from 'vitest';
import {
  aggregateFitnessPerks, perkMultiplier, hasAnyPerks, PERK_CAP,
} from './gearPerks.js';

const cloak = { fitnessPerks: { categories: { cardio: 1.03 } } };
const gloves = { fitnessPerks: { muscleGroups: { forearm: 1.05 } } };
const blade = { fitnessPerks: { categories: { strength: 1.03 } } };
const plain = { id: 'x' }; // no perks

describe('aggregateFitnessPerks', () => {
  it('merges buckets across items', () => {
    const p = aggregateFitnessPerks([cloak, gloves, blade, plain]);
    expect(p.categories).toEqual({ cardio: 1.03, strength: 1.03 });
    expect(p.muscleGroups).toEqual({ forearm: 1.05 });
    expect(p.exercises).toEqual({});
  });

  it('stacks same-key factors multiplicatively', () => {
    const p = aggregateFitnessPerks([cloak, { fitnessPerks: { categories: { cardio: 1.05 } } }]);
    expect(p.categories.cardio).toBeCloseTo(1.03 * 1.05, 10);
  });

  it('ignores items without perks and bad values', () => {
    const p = aggregateFitnessPerks([plain, null, undefined, { fitnessPerks: { categories: { cardio: 0 } } }, { fitnessPerks: { categories: { cardio: NaN } } }]);
    expect(hasAnyPerks(p)).toBe(false);
  });

  it('empty / nullish input → empty table', () => {
    expect(hasAnyPerks(aggregateFitnessPerks([]))).toBe(false);
    expect(hasAnyPerks(aggregateFitnessPerks(null))).toBe(false);
  });
});

describe('perkMultiplier', () => {
  const perks = aggregateFitnessPerks([cloak, gloves, blade]);

  it('applies the matching category factor', () => {
    expect(perkMultiplier(perks, { category: 'strength' })).toBeCloseTo(1.03, 10);
    expect(perkMultiplier(perks, { category: 'cardio' })).toBeCloseTo(1.03, 10);
  });

  it('applies the matching muscleGroup factor', () => {
    expect(perkMultiplier(perks, { muscleGroup: 'forearm' })).toBeCloseTo(1.05, 10);
  });

  it('stacks exercise × muscleGroup × category', () => {
    const p = aggregateFitnessPerks([
      { fitnessPerks: { exercises: { squat: 1.1 }, muscleGroups: { legs: 1.1 }, categories: { strength: 1.05 } } },
    ]);
    expect(perkMultiplier(p, { exId: 'squat', muscleGroup: 'legs', category: 'strength' }))
      .toBeCloseTo(1.1 * 1.1 * 1.05, 10);
  });

  it('returns 1 when nothing matches or no perks', () => {
    expect(perkMultiplier(perks, { category: 'flexibility' })).toBe(1);
    expect(perkMultiplier(null, { category: 'strength' })).toBe(1);
    expect(perkMultiplier(perks, null)).toBe(1);
  });

  it('hard-caps the combined multiplier at PERK_CAP', () => {
    // Absurd stack that would exceed the cap.
    const p = aggregateFitnessPerks([
      { fitnessPerks: { categories: { strength: 1.5 }, muscleGroups: { chest: 1.5 } } },
    ]);
    expect(perkMultiplier(p, { category: 'strength', muscleGroup: 'chest' })).toBe(PERK_CAP);
    expect(PERK_CAP).toBe(1.35);
  });
});
