/**
 * quests/collect.ts — collect-objective progress synced from inventory.
 */
import { QUESTS } from '../content/index.js';
import type { QuestDef, QuestObjective } from '../content/types.js';
import {
  objectiveProgress,
  objectiveTarget,
  questIsReadyFromCounts,
  questProgressCounts,
} from '../content/formulas/quests.js';
import {
  countItemOwned,
  removeItemStack,
  type InventoryCtx,
} from '../inventory/helpers.js';

export const QUEST_STATE_ACTIVE = 0;
export const QUEST_STATE_READY = 1;
export const QUEST_STATE_DONE = 2;

export function parseQuestCounts(json: string, len: number): number[] {
  try {
    const arr = JSON.parse(json);
    if (Array.isArray(arr) && arr.length === len) {
      return arr.map((n) => Math.max(0, Number(n) || 0));
    }
  } catch {
    // malformed row — treat as fresh progress
  }
  return new Array(len).fill(0);
}

export function itemCountsForOwner(ctx: InventoryCtx, owner: unknown): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of ctx.db.playerItemStack.iter()) {
    if (!row.owner.isEqual(owner)) continue;
    counts[row.itemId] = (counts[row.itemId] ?? 0) + row.quantity;
  }
  return counts;
}

export function effectiveQuestCounts(
  ctx: InventoryCtx,
  identity: unknown,
  quest: QuestDef,
  storedCounts: number[],
): number[] {
  const items = itemCountsForOwner(ctx, identity);
  return questProgressCounts(quest, storedCounts, items);
}

export function questReadyWithInventory(
  ctx: InventoryCtx,
  identity: unknown,
  quest: QuestDef,
  storedCounts: number[],
): boolean {
  return questIsReadyFromCounts(
    quest,
    effectiveQuestCounts(ctx, identity, quest, storedCounts),
  );
}

/** Remove collect objective items when a quest is turned in. */
export function consumeCollectObjectives(
  ctx: InventoryCtx,
  identity: unknown,
  quest: QuestDef,
): boolean {
  for (const obj of quest.objectives) {
    if (obj.type !== 'collect') continue;
    if (!removeItemStack(ctx, identity, obj.itemId, obj.count)) return false;
  }
  return true;
}

/**
 * Recompute collect counts from inventory and promote rows to ready when met.
 * Call after inventory gains (loot, import, etc.).
 */
export function refreshCollectQuestProgress(
  ctx: InventoryCtx,
  identity: unknown,
): void {
  const items = itemCountsForOwner(ctx, identity);
  for (const row of ctx.db.playerQuest.iter()) {
    if (!row.owner.isEqual(identity)) continue;
    if (row.state === QUEST_STATE_DONE) continue;
    const quest: QuestDef | undefined = QUESTS[row.questId];
    if (!quest) continue;

    const stored = parseQuestCounts(row.countsJson, quest.objectives.length);
    const effective = questProgressCounts(quest, stored, items);
    let changed = false;
    quest.objectives.forEach((obj, i) => {
      if (obj.type !== 'collect') return;
      const next = effective[i] ?? 0;
      if (stored[i] !== next) {
        stored[i] = next;
        changed = true;
      }
    });

    const ready = questIsReadyFromCounts(quest, effective);
    const nextState = ready ? QUEST_STATE_READY : QUEST_STATE_ACTIVE;
    if (!changed && row.state === nextState) continue;

    ctx.db.playerQuest.id.update({
      ...row,
      countsJson: JSON.stringify(stored),
      state: nextState,
    });
  }
}

export { objectiveProgress, objectiveTarget };
