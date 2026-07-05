/**
 * QuestTracker — compact always-on HUD list of active/ready quests with
 * objective progress (top-right, under the online counter). Capped at 4
 * quests so it never crowds the view; the full journal lives in
 * QuestLogPanel (L).
 */

import React from 'react';
import { FONT } from '../ui/panelTheme.js';
import { QUESTS } from '../content/index';
import { QUEST_STATE, parseCounts, objectiveTarget, questRowReady } from '../hooks/useQuests.js';

const S = {
  wrap: {
    position: 'absolute', top: 34, right: 14, zIndex: 10,
    width: 200, pointerEvents: 'none', fontFamily: FONT,
    display: 'flex', flexDirection: 'column', gap: 6,
  },
  quest: {
    background: 'rgba(0,0,0,0.42)', borderRadius: 8, padding: '6px 9px',
    backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)',
    borderLeft: '2px solid rgba(240,208,96,0.55)',
  },
  name: { fontSize: 11.5, fontWeight: 700, color: '#f0d060', marginBottom: 2 },
  ready: { fontSize: 11, color: '#86efac' },
  objective: { fontSize: 11, color: '#cbd5e1', lineHeight: 1.45 },
  objectiveDone: { fontSize: 11, color: '#86efac', lineHeight: 1.45 },
};

export default function QuestTracker({ myQuests, itemCounts = {} }) {
  const tracked = [...myQuests.entries()]
    .map(([questId, row]) => ({ quest: QUESTS[questId], row }))
    .filter((e) => e.quest && e.row.state !== QUEST_STATE.DONE)
    .slice(0, 4);

  if (tracked.length === 0) return null;

  return (
    <div style={S.wrap}>
      {tracked.map(({ quest, row }) => {
        const counts = parseCounts(row, quest, itemCounts);
        const ready = row.state === QUEST_STATE.READY
          || questRowReady(row, quest, itemCounts);
        return (
          <div key={quest.id} style={S.quest}>
            <div style={S.name}>{quest.name}</div>
            {ready ? (
              <div style={S.ready}>✓ Ready to turn in</div>
            ) : (
              quest.objectives.map((obj, i) => {
                const target = objectiveTarget(obj);
                const done = (counts[i] ?? 0) >= target;
                return (
                  <div key={i} style={done ? S.objectiveDone : S.objective}>
                    {obj.label}: {Math.min(counts[i] ?? 0, target)}/{target}
                  </div>
                );
              })
            )}
          </div>
        );
      })}
    </div>
  );
}
