import { describe, it, expect } from 'vitest';
import { cartEntry } from '../../../hooks/useExerciseCart';
import { EQUIP_OPTS, MUSCLE_OPTS, TYPE_OPTS, muscleLabel } from '../exerciseFilterOptions';
import { EXERCISES } from '../../../data/exercises';

/**
 * Regression cover for the drift-and-desync class of bug this area keeps
 * producing: filter vocabularies that fall behind the catalog, and cart
 * entries built from IDs the catalog can no longer resolve.
 */

describe('exercise filter vocabulary', () => {
  it('covers every equipment value present in the catalog', () => {
    const inCatalog = new Set(
      EXERCISES.map(e => (e.equipment || 'bodyweight').toLowerCase().trim()).filter(Boolean)
    );
    const missing = [...inCatalog].filter(v => !EQUIP_OPTS.includes(v));
    // A value missing here doesn't hide the exercise, it makes it
    // unfilterable — which is how medicine ball, landmine and rings went
    // unreachable from the equipment facet.
    expect(missing).toEqual([]);
  });

  it('covers every muscle group present in the catalog', () => {
    const inCatalog = new Set(
      EXERCISES.map(e => (e.muscleGroup || '').toLowerCase().trim()).filter(Boolean)
    );
    const missing = [...inCatalog].filter(v => !MUSCLE_OPTS.includes(v));
    expect(missing).toEqual([]);
  });

  it('covers every category present in the catalog', () => {
    const inCatalog = new Set(
      EXERCISES.map(e => (e.category || '').toLowerCase().trim()).filter(Boolean)
    );
    const missing = [...inCatalog].filter(v => !TYPE_OPTS.includes(v));
    expect(missing).toEqual([]);
  });

  it('labels underscored groups readably', () => {
    expect(muscleLabel('full_body')).toBe('Full body');
    expect(muscleLabel('chest')).toBe('Chest');
  });
});

describe('cartEntry', () => {
  const allExById = {
    known: { id: 'known', name: 'Known', defaultSets: 5, defaultReps: 3 },
    bare: { id: 'bare', name: 'Bare' },
  };

  it('uses the exercise defaults when present', () => {
    expect(cartEntry('known', allExById)).toMatchObject({ exId: 'known', sets: 5, reps: 3 });
  });

  it('falls back to 3x10 when the exercise carries no defaults', () => {
    expect(cartEntry('bare', allExById)).toMatchObject({ exId: 'bare', sets: 3, reps: 10 });
  });

  it('still produces an entry for an unknown id, which is why callers must filter', () => {
    // Documents the sharp edge rather than endorsing it: the builder renders
    // nothing for an unresolvable exId but counts it toward wbExercises.length,
    // so callers resolve against allExById before forging.
    const entry = cartEntry('deleted-custom', allExById);
    expect(entry.exId).toBe('deleted-custom');
    expect(allExById[entry.exId]).toBeUndefined();
  });
});
