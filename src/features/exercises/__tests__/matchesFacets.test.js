import { describe, it, expect } from 'vitest';
import {
  matchesFacets, matchesAll, facetCounts, muscleKeys, typeKeys, equipKeys,
} from '../matchesFacets';
import { EXERCISES } from '../../../data/exercises';
import { MUSCLE_OPTS, EQUIP_OPTS, TYPE_OPTS } from '../exerciseFilterOptions';

/**
 * The filter predicate and the option vocabulary were copied into four places
 * and drifted in three of them — the workout builder lost full_body and four
 * types, the equipment facet lost medicine ball / landmine / rings, and the
 * plan wizard lost tricep and full_body (188 exercises it could not filter
 * to). These tests pin the semantics and, more importantly, assert that no
 * option a real exercise needs is missing from the shared lists.
 */

const S = (...v) => new Set(v);
const ex = (over = {}) => ({
  id: 'x', name: 'Test Move', muscleGroup: 'chest',
  category: 'strength', exerciseType: 'strength', equipment: 'barbell', ...over,
});

describe('matchesFacets semantics', () => {
  it('treats an empty facet as no constraint, not as no matches', () => {
    expect(matchesFacets(ex(), S(), S(), S())).toBe(true);
  });

  it('ORs within a facet', () => {
    expect(matchesFacets(ex({ muscleGroup: 'back' }), S('chest', 'back'), S(), S())).toBe(true);
    expect(matchesFacets(ex({ muscleGroup: 'legs' }), S('chest', 'back'), S(), S())).toBe(false);
  });

  it('ANDs across facets', () => {
    const e = ex({ muscleGroup: 'chest', equipment: 'barbell' });
    expect(matchesFacets(e, S('chest'), S(), S('barbell'))).toBe(true);
    expect(matchesFacets(e, S('chest'), S(), S('cable'))).toBe(false);
  });

  it('matches a type against exerciseType tags or the category', () => {
    expect(matchesFacets(ex({ exerciseType: 'warmup,mobility', category: 'flexibility' }), S(), S('warmup'), S())).toBe(true);
    expect(matchesFacets(ex({ exerciseType: '', category: 'endurance' }), S(), S('endurance'), S())).toBe(true);
  });

  it('defaults missing equipment to bodyweight rather than excluding it', () => {
    expect(matchesFacets(ex({ equipment: undefined }), S(), S(), S('bodyweight'))).toBe(true);
  });

  it('is case- and whitespace-insensitive on catalog values', () => {
    expect(matchesFacets(ex({ muscleGroup: '  Chest ' }), S('chest'), S(), S())).toBe(true);
  });

  it('never matches rest_day, which is not a real exercise', () => {
    expect(matchesFacets(ex({ id: 'rest_day' }), S(), S(), S())).toBe(false);
  });
});

describe('matchesAll', () => {
  it('requires the search term as well as the facets', () => {
    const e = ex({ name: 'Barbell Bench Press' });
    expect(matchesAll(e, 'bench', S('chest'), S(), S())).toBe(true);
    expect(matchesAll(e, 'squat', S('chest'), S(), S())).toBe(false);
  });

  it('ignores an empty or whitespace-only query', () => {
    expect(matchesAll(ex(), '   ', S(), S(), S())).toBe(true);
  });
});

describe('facetCounts', () => {
  it('counts an exercise once per distinct type tag', () => {
    const list = [ex({ exerciseType: 'strength,functional', category: 'strength' })];
    const counts = facetCounts(list, typeKeys, () => true);
    // "strength" appears as both a tag and the category — counted once.
    expect(counts.get('strength')).toBe(1);
    expect(counts.get('functional')).toBe(1);
  });

  it('only counts what the predicate admits', () => {
    const list = [ex({ muscleGroup: 'chest' }), ex({ muscleGroup: 'back' })];
    const counts = facetCounts(list, muscleKeys, e => e.muscleGroup === 'chest');
    expect(counts.get('chest')).toBe(1);
    expect(counts.has('back')).toBe(false);
  });
});

describe('vocabulary covers the catalog', () => {
  // The drift guard. Every facet value a real exercise carries must be
  // offerable, or those exercises are silently unreachable through that facet
  // — which is exactly what happened three separate times.
  const distinct = keyFn => {
    const seen = new Set();
    for (const e of EXERCISES) for (const k of keyFn(e)) if (k) seen.add(k);
    return [...seen];
  };

  it('offers every muscle group in the catalog', () => {
    expect(distinct(muscleKeys).filter(v => !MUSCLE_OPTS.includes(v))).toEqual([]);
  });

  it('offers every equipment value in the catalog', () => {
    expect(distinct(equipKeys).filter(v => !EQUIP_OPTS.includes(v))).toEqual([]);
  });

  it('offers every category in the catalog', () => {
    const cats = new Set(EXERCISES.map(e => (e.category || '').toLowerCase().trim()).filter(Boolean));
    expect([...cats].filter(v => !TYPE_OPTS.includes(v))).toEqual([]);
  });
});
