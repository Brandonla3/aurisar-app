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

  it('Edran chain collect steps read inventory counts', () => {
    const whispers = QUESTS.q_whispers;
    expect(whispers.requiresQuestId).toBe('q_bones');
    const partial = questProgressCounts(whispers, [0], { ghostly_essence: 2 });
    expect(questIsReadyFromCounts(whispers, partial)).toBe(false);
    const done = questProgressCounts(whispers, [0], { ghostly_essence: 4 });
    expect(questIsReadyFromCounts(whispers, done)).toBe(true);

    const names = QUESTS.q_names_of_the_dead;
    expect(names.requiresQuestId).toBe('q_whispers');
    expect(questIsReadyFromCounts(
      names,
      questProgressCounts(names, [0], { bone_fragments: 6 }),
    )).toBe(true);

    const silence = QUESTS.q_silence_the_call;
    expect(silence.requiresQuestId).toBe('q_names_of_the_dead');
    expect(questIsReadyFromCounts(
      silence,
      questProgressCounts(silence, [0], { blessed_wax: 4 }),
    )).toBe(true);
  });

  it('q_rite uses a find objective at Mourner\'s Rest', () => {
    const rite = QUESTS.q_rite;
    expect(rite.requiresQuestId).toBe('q_silence_the_call');
    expect(rite.objectives[0]).toMatchObject({
      type: 'find',
      targetId: 'poi_mourners_rest',
    });
    expect(rite.reward.itemIds).toContain('boarhide_gloves');
  });
});
