/**
 * useQuests — client-side quest state over the player_quest table, plus the
 * pure helpers HUD components share (NPC markers, availability, progress
 * labels). Definitions come from the shared content package; only per-player
 * rows live on the server.
 */

import { useCallback, useState } from 'react';
import { QUESTS } from '../content/index';
import {
  objectiveProgress,
  objectiveTarget,
  questProgressCounts,
  questIsReadyFromCounts,
} from '../content/formulas/quests';

export const QUEST_STATE = { ACTIVE: 0, READY: 1, DONE: 2 };

function idHex(identity) {
  if (!identity) return '';
  return typeof identity.toHexString === 'function' ? identity.toHexString() : String(identity);
}

/**
 * Tracks player_quest rows from useSpacetimeWorld callbacks. Identity-free
 * so the handlers can be created BEFORE useSpacetimeWorld runs (its return
 * value provides the identity); filter with myQuestsFrom() afterwards.
 */
export function useQuestRows() {
  const [rows, setRows] = useState(() => new Map()); // rowId(string) → row

  const onQuestUpsert = useCallback((row) => {
    setRows((prev) => {
      const next = new Map(prev);
      next.set(String(row.id), row);
      return next;
    });
  }, []);

  const onQuestDelete = useCallback((row) => {
    setRows((prev) => {
      const next = new Map(prev);
      next.delete(String(row.id));
      return next;
    });
  }, []);

  return { onQuestUpsert, onQuestDelete, rows };
}

/** questId → row, filtered to the given identity. Memoize at the call site. */
export function myQuestsFrom(rows, identity) {
  const me = idHex(identity);
  const m = new Map();
  if (!me) return m;
  for (const row of rows.values()) {
    if (idHex(row.owner) === me) m.set(row.questId, row);
  }
  return m;
}

// ── Pure helpers ─────────────────────────────────────────────────────────────

export { objectiveTarget, objectiveProgress, questProgressCounts, questIsReadyFromCounts };

/** Per-objective counts for a row, tolerant of malformed JSON. */
export function parseCounts(row, quest, itemCounts = {}) {
  try {
    const arr = JSON.parse(row.countsJson);
    if (Array.isArray(arr) && arr.length === quest.objectives.length) {
      const stored = arr.map((n) => Math.max(0, Number(n) || 0));
      return questProgressCounts(quest, stored, itemCounts);
    }
  } catch { /* fresh */ }
  return questProgressCounts(
    quest,
    new Array(quest.objectives.length).fill(0),
    itemCounts,
  );
}

/** True when all objectives are met (uses live inventory for collect). */
export function questRowReady(row, quest, itemCounts = {}) {
  return questIsReadyFromCounts(quest, parseCounts(row, quest, itemCounts));
}

/** Quests this NPC offers that the player can accept right now. */
export function availableQuestsAt(npcId, myQuests, playerLevel = 999) {
  return Object.values(QUESTS).filter((q) => {
    if (q.giverNpcId !== npcId) return false;
    if (myQuests.has(q.id)) return false; // active, ready, or done
    if (q.minLevel && playerLevel < q.minLevel) return false;
    if (q.requiresQuestId) {
      const prereq = myQuests.get(q.requiresQuestId);
      if (!prereq || prereq.state !== QUEST_STATE.DONE) return false;
    }
    return true;
  });
}

/** Quests ready to be turned in at this NPC. */
export function readyQuestsAt(npcId, myQuests, itemCounts = {}) {
  return Object.values(QUESTS).filter((q) => {
    if (q.turnInNpcId !== npcId) return false;
    const row = myQuests.get(q.id);
    if (!row || row.state === QUEST_STATE.DONE) return false;
    return row.state === QUEST_STATE.READY || questRowReady(row, q, itemCounts);
  });
}

/** Active (not yet ready) quests this NPC gave the player. */
export function inProgressQuestsAt(npcId, myQuests, itemCounts = {}) {
  return Object.values(QUESTS).filter((q) => {
    if (q.giverNpcId !== npcId) return false;
    const row = myQuests.get(q.id);
    return !!row && row.state === QUEST_STATE.ACTIVE && !questRowReady(row, q, itemCounts);
  });
}

/** '?' (turn-in ready) wins over '!' (quest available); null = no marker. */
export function npcMarker(npcId, myQuests, playerLevel = 999) {
  if (readyQuestsAt(npcId, myQuests).length > 0) return '?';
  if (availableQuestsAt(npcId, myQuests, playerLevel).length > 0) return '!';
  return null;
}

/** { npcId: '!' | '?' } map for NpcSystem.setMarkers. */
export function buildNpcMarkers(npcIds, myQuests, playerLevel = 999) {
  const out = {};
  for (const id of npcIds) out[id] = npcMarker(id, myQuests, playerLevel);
  return out;
}

/** Substitute $N (player name) and $C (class display name) in NPC copy. */
export function substituteTokens(text, playerName, className) {
  return String(text ?? '')
    .replaceAll('$N', playerName || 'Adventurer')
    .replaceAll('$C', className || 'Adventurer');
}
