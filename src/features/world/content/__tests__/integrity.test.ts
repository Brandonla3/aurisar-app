/**
 * Content referential-integrity tests. These run client-side only (they
 * cross-check against src/data + src/utils, which the server module must
 * never import) — the sync script excludes __tests__ from the mirror.
 */
import { describe, expect, it } from 'vitest';

import {
  CLASS_KITS,
  ITEMS,
  NPCS,
  QUESTS,
  validateContent,
} from '../index';
import { XP_TABLE as CONTENT_XP_TABLE, MAX_LEVEL } from '../formulas/xp';

// Fitness-side sources of truth
// eslint-disable-next-line -- JS modules without types
import { CLASSES, EXERCISES } from '../../../../data/exercises.js';
// eslint-disable-next-line -- JS modules without types
import { WORKOUT_TEMPLATES } from '../../../../data/constants.js';
// eslint-disable-next-line -- JS modules without types
import { XP_TABLE as FITNESS_XP_TABLE } from '../../../../utils/xp.js';
// eslint-disable-next-line -- JS modules without types
import { ITEMS as LEGACY_ITEMS } from '../../game/items.js';

describe('content graph', () => {
  it('has no referential-integrity errors', () => {
    expect(validateContent()).toEqual([]);
  });
});

describe('class contract with the fitness app', () => {
  it('kit ids exactly match CLASSES keys in src/data/exercises.js', () => {
    expect(Object.keys(CLASS_KITS).sort()).toEqual(Object.keys(CLASSES).sort());
  });
});

describe('level curve contract with the fitness app', () => {
  it('XP_TABLE is identical to the fitness curve in src/utils/xp.js', () => {
    expect(CONTENT_XP_TABLE).toEqual(FITNESS_XP_TABLE);
  });

  it('covers the full 1..MAX_LEVEL range', () => {
    expect(CONTENT_XP_TABLE.length).toBe(MAX_LEVEL + 1);
  });
});

describe('item contract with legacy client catalog', () => {
  it('every legacy items.js id survives (P4 migration maps 1:1)', () => {
    for (const id of Object.keys(LEGACY_ITEMS)) {
      expect(ITEMS[id], `legacy item ${id} missing from content catalog`).toBeTruthy();
    }
  });
});

describe('fitness reward references', () => {
  const templateIds = new Set(WORKOUT_TEMPLATES.map((t: { id: string }) => t.id));
  const exerciseIds = new Set(EXERCISES.map((e: { id: string }) => e.id));
  const muscleGroups = new Set(
    EXERCISES.map((e: { muscleGroup?: string }) => e.muscleGroup).filter(Boolean),
  );
  const categories = new Set(
    EXERCISES.map((e: { category?: string }) => e.category).filter(Boolean),
  );

  it('quest templateUnlockIds resolve to WORKOUT_TEMPLATES', () => {
    for (const q of Object.values(QUESTS)) {
      for (const tid of q.reward.templateUnlockIds ?? []) {
        expect(templateIds.has(tid), `quest ${q.id}: unknown template ${tid}`).toBe(true);
      }
    }
  });

  it('item fitnessPerks keys resolve to real exercises/muscleGroups/categories', () => {
    for (const item of Object.values(ITEMS)) {
      const perks = item.fitnessPerks;
      if (!perks) continue;
      for (const ex of Object.keys(perks.exercises ?? {})) {
        expect(exerciseIds.has(ex), `item ${item.id}: unknown exercise ${ex}`).toBe(true);
      }
      for (const mg of Object.keys(perks.muscleGroups ?? {})) {
        expect(muscleGroups.has(mg), `item ${item.id}: unknown muscleGroup ${mg}`).toBe(true);
      }
      for (const cat of Object.keys(perks.categories ?? {})) {
        expect(categories.has(cat), `item ${item.id}: unknown category ${cat}`).toBe(true);
      }
    }
  });
});

describe('placeholder copy hygiene', () => {
  it('greetings/templates only use known substitution tokens ($N, $C)', () => {
    const tokenRe = /\$[A-Za-z]/g;
    const check = (owner: string, text: string) => {
      for (const tok of text.match(tokenRe) ?? []) {
        expect(['$N', '$C'], `${owner}: unknown token ${tok}`).toContain(tok);
      }
    };
    for (const n of Object.values(NPCS)) check(`npc ${n.id}`, n.greeting);
    for (const q of Object.values(QUESTS)) {
      check(`quest ${q.id}`, q.text);
      check(`quest ${q.id}`, q.completionText);
    }
  });
});
