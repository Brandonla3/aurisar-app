// GENERATED FILE — DO NOT EDIT.
// Source: src/features/world/content/formulas/quests.ts
// Regenerate with: npm run sync:content

/**
 * formulas/quests.ts — quest progress helpers shared by client UI and the
 * SpacetimeDB module (collect objectives read live inventory counts).
 */
import type { QuestDef, QuestObjective } from '../types';

export function objectiveTarget(obj: QuestObjective): number {
  return obj.type === 'find' ? 1 : obj.count;
}

/** Effective progress for one objective (collect uses live item counts). */
export function objectiveProgress(
  obj: QuestObjective,
  storedCount: number,
  itemCounts: Record<string, number> = {},
): number {
  if (obj.type === 'collect') {
    return Math.min(itemCounts[obj.itemId] ?? 0, obj.count);
  }
  return storedCount;
}

export function questProgressCounts(
  quest: QuestDef,
  storedCounts: number[],
  itemCounts: Record<string, number> = {},
): number[] {
  return quest.objectives.map((obj, i) =>
    objectiveProgress(obj, storedCounts[i] ?? 0, itemCounts),
  );
}

export function questIsReadyFromCounts(
  quest: QuestDef,
  counts: number[],
): boolean {
  return quest.objectives.every((obj, i) => (counts[i] ?? 0) >= objectiveTarget(obj));
}
