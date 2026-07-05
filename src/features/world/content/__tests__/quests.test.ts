import { describe, expect, it } from 'vitest';
import { QUESTS } from '../index';
import {
  objectiveProgress,
  objectiveTarget,
  questIsReadyFromCounts,
  questProgressCounts,
} from '../formulas/quests';

describe('quest collect progress', () => {
  const greyjaw = QUESTS.q_greyjaw;

  it('collect objective reads live inventory counts', () => {
    const obj = greyjaw.objectives[0];
    expect(obj.type).toBe('collect');
    expect(objectiveProgress(obj, 0, {})).toBe(0);
    expect(objectiveProgress(obj, 0, { greyjaw_fang: 1 })).toBe(1);
    expect(objectiveTarget(obj)).toBe(1);
  });

  it('quest becomes ready when collect items are held', () => {
    const stored = [0];
    const withFang = questProgressCounts(greyjaw, stored, { greyjaw_fang: 1 });
    expect(questIsReadyFromCounts(greyjaw, withFang)).toBe(true);
  });

  it('q_boars needs six hides', () => {
    const q = QUESTS.q_boars;
    const partial = questProgressCounts(q, [0], { boar_hide: 3 });
    expect(questIsReadyFromCounts(q, partial)).toBe(false);
    const done = questProgressCounts(q, [0], { boar_hide: 6 });
    expect(questIsReadyFromCounts(q, done)).toBe(true);
  });
});
