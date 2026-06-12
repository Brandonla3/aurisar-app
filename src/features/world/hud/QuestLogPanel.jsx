/**
 * QuestLogPanel — full quest journal: active / ready / completed, with
 * objective progress and abandon for in-progress quests. Opened with L or
 * the Quests action button.
 */

import React from 'react';
import { FONT, overlayBackdrop, panel, panelTitle, closeBtn, ghostBtn } from '../ui/panelTheme.js';
import { QUESTS, NPCS } from '../content/index';
import { QUEST_STATE, parseCounts, objectiveTarget } from '../hooks/useQuests.js';

const S = {
  section: { fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#94a3b8', textTransform: 'uppercase', margin: '14px 0 6px' },
  card: {
    background: 'rgba(30, 41, 59, 0.7)', border: '1px solid rgba(148,163,184,0.22)',
    borderRadius: 10, padding: '10px 12px', marginBottom: 8, fontFamily: FONT,
  },
  name: { fontWeight: 700, color: '#f0d060', fontSize: 13.5 },
  meta: { fontSize: 11.5, color: '#94a3b8', margin: '2px 0 6px' },
  objective: { fontSize: 12.5, color: '#a7b6cc', margin: '2px 0' },
  objectiveDone: { fontSize: 12.5, color: '#86efac', margin: '2px 0' },
  empty: { fontSize: 13, color: '#94a3b8', fontStyle: 'italic', margin: '8px 0' },
};

function QuestCard({ quest, row, onAbandon }) {
  const counts = parseCounts(row, quest);
  const turnIn = NPCS[quest.turnInNpcId];
  return (
    <div style={S.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <span style={S.name}>
          {row.state === QUEST_STATE.READY && <span style={{ color: '#86efac' }}>✓ </span>}
          {quest.name}
        </span>
        {row.state !== QUEST_STATE.DONE && onAbandon && (
          <button
            style={{ ...ghostBtn, padding: '2px 10px', minHeight: 26, fontSize: 11 }}
            onClick={() => onAbandon(quest.id)}
          >
            Abandon
          </button>
        )}
      </div>
      <div style={S.meta}>
        {row.state === QUEST_STATE.READY
          ? `Return to ${turnIn?.name ?? quest.turnInNpcId}`
          : row.state === QUEST_STATE.DONE
            ? 'Completed'
            : `For ${NPCS[quest.giverNpcId]?.name ?? quest.giverNpcId}`}
      </div>
      {row.state !== QUEST_STATE.DONE && quest.objectives.map((obj, i) => {
        const target = objectiveTarget(obj);
        const done = (counts[i] ?? 0) >= target;
        return (
          <div key={i} style={done ? S.objectiveDone : S.objective}>
            • {obj.label}: {Math.min(counts[i] ?? 0, target)}/{target}
          </div>
        );
      })}
    </div>
  );
}

export default function QuestLogPanel({ myQuests, onAbandonQuest, onClose }) {
  const entries = [...myQuests.entries()]
    .map(([questId, row]) => ({ quest: QUESTS[questId], row }))
    .filter((e) => e.quest);

  const active = entries.filter((e) => e.row.state === QUEST_STATE.ACTIVE);
  const ready  = entries.filter((e) => e.row.state === QUEST_STATE.READY);
  const done   = entries.filter((e) => e.row.state === QUEST_STATE.DONE);

  return (
    <div
      style={overlayBackdrop}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div style={{ ...panel, width: 'min(420px, 92vw)' }} role="dialog" aria-label="Quest log">
        <button style={closeBtn} onClick={onClose} aria-label="Close quest log">✕</button>
        <h2 style={panelTitle}>Quest Log</h2>

        {entries.length === 0 && (
          <div style={S.empty}>No quests yet — look for NPCs marked with ! in the hub.</div>
        )}

        {ready.length > 0 && <div style={S.section}>Ready to complete</div>}
        {ready.map((e) => <QuestCard key={e.quest.id} quest={e.quest} row={e.row} onAbandon={onAbandonQuest} />)}

        {active.length > 0 && <div style={S.section}>Active</div>}
        {active.map((e) => <QuestCard key={e.quest.id} quest={e.quest} row={e.row} onAbandon={onAbandonQuest} />)}

        {done.length > 0 && <div style={S.section}>Completed</div>}
        {done.map((e) => <QuestCard key={e.quest.id} quest={e.quest} row={e.row} />)}
      </div>
    </div>
  );
}
