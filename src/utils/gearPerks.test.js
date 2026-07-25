import { describe, expect, it } from 'vitest';
import {
  aggregateFitnessPerks, perkMultiplier, hasAnyPerks, perkAward, applyStoredPerk, PERK_CAP,
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

  it('respects an explicit cap override', () => {
    const p = aggregateFitnessPerks([{ fitnessPerks: { categories: { strength: 1.3 } } }]);
    expect(perkMultiplier(p, { category: 'strength' }, 1.1)).toBe(1.1);
  });

  it('never reduces XP — a sub-1 factor is rejected at aggregation (floor 1)', () => {
    const p = aggregateFitnessPerks([{ fitnessPerks: { categories: { strength: 0.85 } } }]);
    expect(hasAnyPerks(p)).toBe(false);
    expect(perkMultiplier(p, { category: 'strength' })).toBe(1);
  });
});

describe('hasAnyPerks', () => {
  it('is true when any bucket has an entry, false otherwise', () => {
    expect(hasAnyPerks(aggregateFitnessPerks([{ fitnessPerks: { categories: { cardio: 1.03 } } }]))).toBe(true);
    expect(hasAnyPerks({ exercises: {}, muscleGroups: {}, categories: {} })).toBe(false);
    expect(hasAnyPerks(null)).toBe(false);
  });
});

describe('perkAward', () => {
  const p = aggregateFitnessPerks([{ fitnessPerks: { categories: { strength: 1.03 } } }]);
  it('multiplies + rounds and records perkMult/baseXp when a perk matches', () => {
    expect(perkAward(100, p, { category: 'strength' })).toEqual({ xp: 103, perkMult: 1.03, baseXp: 100 });
    expect(perkAward(101, p, { category: 'strength' }).xp).toBe(104); // 104.03 → 104
  });
  it('returns xp unchanged, perkMult 1 and no baseXp when no perk matches', () => {
    expect(perkAward(100, p, { category: 'cardio' })).toEqual({ xp: 100, perkMult: 1 });
    expect(perkAward(100, null, { category: 'strength' })).toEqual({ xp: 100, perkMult: 1 });
    expect(perkAward(100, p, { category: 'cardio' })).not.toHaveProperty('baseXp');
  });
  it('preserves the invariant xp === round(baseXp × perkMult)', () => {
    const a = perkAward(137, aggregateFitnessPerks([{ fitnessPerks: { muscleGroups: { chest: 1.07 } } }]), { muscleGroup: 'chest' });
    expect(a.xp).toBe(Math.round(a.baseXp * a.perkMult));
  });
});

describe('applyStoredPerk', () => {
  it('re-applies a stored multiplier to a recomputed base (rounded)', () => {
    expect(applyStoredPerk(100, 1.03)).toBe(103);
    expect(applyStoredPerk(101, 1.03)).toBe(104); // 104.03 → 104
  });
  it('is a no-op for missing / ≤1 / non-finite stored factors', () => {
    expect(applyStoredPerk(100, undefined)).toBe(100);
    expect(applyStoredPerk(100, 1)).toBe(100);
    expect(applyStoredPerk(100, 0.9)).toBe(100);
    expect(applyStoredPerk(100, NaN)).toBe(100);
    expect(applyStoredPerk(100, 'x')).toBe(100);
  });
  it('clamps a stored factor above the cap', () => {
    expect(applyStoredPerk(100, 2)).toBe(Math.round(100 * PERK_CAP));
  });
});
