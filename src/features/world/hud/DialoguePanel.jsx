/**
 * DialoguePanel — NPC conversation modal: greeting, available quests
 * (accept), ready quests (complete), in-progress reminders, and vendor
 * buy/sell when the NPC has wares.
 */

import React, { useState } from 'react';
import { FONT, overlayBackdrop, panel, panelTitle, closeBtn, primaryBtn, ghostBtn } from '../ui/panelTheme.js';
import { NPCS, ITEMS } from '../content/index';
import { formatCopper, sellPriceCopper } from '../content/formulas/prices';
import {
  availableQuestsAt, readyQuestsAt, inProgressQuestsAt,
  parseCounts, objectiveTarget, substituteTokens,
} from '../hooks/useQuests.js';
import { WORKOUT_TEMPLATES } from '../../../data/constants.js';

const IS_TOUCH = typeof window !== 'undefined' &&
  window.matchMedia('(pointer: coarse)').matches;

const S = {
  greeting: { fontSize: 13.5, color: '#cbd5e1', lineHeight: 1.6, margin: '10px 0 14px', fontStyle: 'italic' },
  section: { fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: '#94a3b8', textTransform: 'uppercase', margin: '14px 0 6px' },
  questBtn: {
    display: 'block', width: '100%', textAlign: 'left',
    background: 'rgba(30, 41, 59, 0.7)', border: '1px solid rgba(148,163,184,0.22)',
    borderRadius: 10, color: '#e2e8f0', padding: '9px 12px', marginBottom: 6,
    cursor: 'pointer', fontFamily: FONT, fontSize: 13, WebkitTapHighlightColor: 'transparent',
  },
  questName: { fontWeight: 700, color: '#f0d060' },
  questText: { fontSize: 13, color: '#cbd5e1', lineHeight: 1.6, margin: '10px 0' },
  objective: { fontSize: 12.5, color: '#a7b6cc', margin: '2px 0' },
  reward: { fontSize: 12.5, color: '#86efac', margin: '2px 0' },
  vendorRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
    fontSize: 12.5, color: '#cbd5e1', padding: '6px 0',
    borderBottom: '1px solid rgba(148,163,184,0.12)',
  },
  vendorName: { flex: 1, minWidth: 0 },
  vendorPrice: { color: '#f0d060', whiteSpace: 'nowrap' },
  wallet: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '8px 10px', marginBottom: 8, borderRadius: 8,
    background: 'rgba(30, 41, 59, 0.6)', border: '1px solid rgba(240,208,96,0.25)',
    fontSize: 12, fontFamily: FONT, color: '#f0d060',
  },
  tradeBtn: {
    ...ghostBtn,
    padding: '4px 10px', minHeight: 28, fontSize: 11, flexShrink: 0,
  },
  tradeBtnDisabled: {
    opacity: 0.45, cursor: 'not-allowed',
  },
};

function rewardLines(quest) {
  const lines = [];
  if (quest.reward.copper > 0) lines.push(formatCopper(quest.reward.copper));
  for (const iid of quest.reward.itemIds ?? []) {
    lines.push(ITEMS[iid] ? `${ITEMS[iid].icon} ${ITEMS[iid].name}` : iid);
  }
  for (const tid of quest.reward.templateUnlockIds ?? []) {
    const t = WORKOUT_TEMPLATES.find((w) => w.id === tid);
    lines.push(`📋 Training plan: ${t?.name ?? tid}`);
  }
  return lines;
}

function copperNumber(copper) {
  const n = Number(copper ?? 0n);
  return Number.isFinite(n) ? n : 0;
}

function canBuyItem(item, copper, playerLevel) {
  const price = item.vendorPriceCopper ?? 0;
  if (price <= 0) return false;
  if (item.minLevel && playerLevel < item.minLevel) return false;
  return copperNumber(copper) >= price;
}

export default function DialoguePanel({
  npcId, myQuests, playerName, className, playerLevel = 999,
  itemCounts = {},
  serverCounts = {},
  copper = 0n,
  onAcceptQuest, onTurnInQuest, onBuyFromVendor, onSellToVendor, onToast, onClose,
}) {
  const [detailQuest, setDetailQuest] = useState(null); // { quest, mode: 'accept'|'turnIn' }
  const npc = NPCS[npcId];
  if (!npc) return null;

  const available  = availableQuestsAt(npcId, myQuests, playerLevel);
  const ready      = readyQuestsAt(npcId, myQuests, itemCounts);
  const inProgress = inProgressQuestsAt(npcId, myQuests, itemCounts);
  const isVendor = (npc.vendorItemIds?.length ?? 0) > 0;

  const sellable = isVendor
    ? Object.entries(serverCounts)
      .filter(([id, qty]) => qty > 0 && sellPriceCopper(ITEMS[id] ?? {}) > 0)
      .sort(([a], [b]) => (ITEMS[a]?.name ?? a).localeCompare(ITEMS[b]?.name ?? b))
    : [];

  const sheetStyle = IS_TOUCH
    ? { ...panel, width: '100%', maxWidth: '100%', maxHeight: '72vh', borderRadius: '16px 16px 0 0', alignSelf: 'flex-end' }
    : { ...panel, width: 'min(440px, 92vw)' };
  const backdropStyle = IS_TOUCH
    ? { ...overlayBackdrop, alignItems: 'flex-end' }
    : overlayBackdrop;

  const buy = (itemId) => {
    onBuyFromVendor?.(npcId, itemId, 1);
    const item = ITEMS[itemId];
    onToast?.(`Purchased ${item?.name ?? itemId}.`);
  };

  const sell = (itemId, qty) => {
    onSellToVendor?.(npcId, itemId, qty);
    const item = ITEMS[itemId];
    onToast?.(`Sold ${qty}× ${item?.name ?? itemId}.`);
  };

  const body = detailQuest ? (
    <>
      <h2 style={panelTitle}>{detailQuest.quest.name}</h2>
      <div style={S.questText}>
        {substituteTokens(
          detailQuest.mode === 'turnIn' ? detailQuest.quest.completionText : detailQuest.quest.text,
          playerName, className,
        )}
      </div>
      {detailQuest.mode === 'accept' && (
        <>
          <div style={S.section}>Objectives</div>
          {detailQuest.quest.objectives.map((obj, i) => (
            <div key={i} style={S.objective}>• {obj.label} (0/{objectiveTarget(obj)})</div>
          ))}
        </>
      )}
      <div style={S.section}>Rewards</div>
      {rewardLines(detailQuest.quest).map((line, i) => (
        <div key={i} style={S.reward}>{line}</div>
      ))}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        {detailQuest.mode === 'accept' ? (
          <button
            style={primaryBtn}
            onClick={() => { onAcceptQuest(detailQuest.quest.id); setDetailQuest(null); }}
          >
            Accept quest
          </button>
        ) : (
          <button
            style={primaryBtn}
            onClick={() => { onTurnInQuest(detailQuest.quest.id); setDetailQuest(null); onClose(); }}
          >
            Complete quest
          </button>
        )}
        <button style={ghostBtn} onClick={() => setDetailQuest(null)}>Back</button>
      </div>
    </>
  ) : (
    <>
      <h2 style={panelTitle}>{npc.name}</h2>
      {npc.title && <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 2 }}>{npc.title}</div>}
      <div style={S.greeting}>“{substituteTokens(npc.greeting, playerName, className)}”</div>

      {isVendor && (
        <div style={S.wallet}>
          <span>Your coin</span>
          <span style={{ fontWeight: 700 }}>{formatCopper(copper)}</span>
        </div>
      )}

      {ready.length > 0 && (
        <>
          <div style={S.section}>Ready to complete</div>
          {ready.map((q) => (
            <button key={q.id} style={S.questBtn} onClick={() => setDetailQuest({ quest: q, mode: 'turnIn' })}>
              <span style={{ color: '#f0d060', fontWeight: 800 }}>? </span>
              <span style={S.questName}>{q.name}</span>
            </button>
          ))}
        </>
      )}

      {available.length > 0 && (
        <>
          <div style={S.section}>Quests</div>
          {available.map((q) => (
            <button key={q.id} style={S.questBtn} onClick={() => setDetailQuest({ quest: q, mode: 'accept' })}>
              <span style={{ color: '#f0d060', fontWeight: 800 }}>! </span>
              <span style={S.questName}>{q.name}</span>
            </button>
          ))}
        </>
      )}

      {inProgress.length > 0 && (
        <>
          <div style={S.section}>In progress</div>
          {inProgress.map((q) => {
            const row = myQuests.get(q.id);
            const counts = row ? parseCounts(row, q, itemCounts) : [];
            return (
              <div key={q.id} style={{ ...S.questBtn, cursor: 'default' }}>
                <span style={S.questName}>{q.name}</span>
                {q.objectives.map((obj, i) => (
                  <div key={i} style={S.objective}>• {obj.label}: {counts[i] ?? 0}/{objectiveTarget(obj)}</div>
                ))}
              </div>
            );
          })}
        </>
      )}

      {isVendor && (
        <>
          <div style={S.section}>Buy</div>
          {npc.vendorItemIds.map((iid) => {
            const item = ITEMS[iid];
            if (!item) return null;
            const price = item.vendorPriceCopper ?? 0;
            const affordable = canBuyItem(item, copper, playerLevel);
            const levelOk = !item.minLevel || playerLevel >= item.minLevel;
            return (
              <div key={iid} style={S.vendorRow}>
                <span style={S.vendorName}>{item.icon} {item.name}</span>
                <span style={S.vendorPrice}>{formatCopper(price)}</span>
                <button
                  style={{
                    ...S.tradeBtn,
                    ...((!affordable || !levelOk) ? S.tradeBtnDisabled : {}),
                  }}
                  disabled={!affordable || !levelOk}
                  title={
                    !levelOk
                      ? `Requires level ${item.minLevel}`
                      : !affordable
                        ? 'Not enough coin'
                        : 'Buy 1'
                  }
                  onClick={() => buy(iid)}
                >
                  Buy
                </button>
              </div>
            );
          })}
        </>
      )}

      {sellable.length > 0 && (
        <>
          <div style={S.section}>Sell</div>
          {sellable.map(([iid, qty]) => {
            const item = ITEMS[iid];
            if (!item) return null;
            const unit = sellPriceCopper(item);
            return (
              <div key={iid} style={S.vendorRow}>
                <span style={S.vendorName}>
                  {item.icon} {item.name}
                  {qty > 1 ? <span style={{ color: '#94a3b8' }}> ×{qty}</span> : null}
                </span>
                <span style={S.vendorPrice}>{formatCopper(unit)}</span>
                <button style={S.tradeBtn} onClick={() => sell(iid, 1)}>Sell</button>
                {qty > 1 && (
                  <button style={S.tradeBtn} onClick={() => sell(iid, qty)}>All</button>
                )}
              </div>
            );
          })}
        </>
      )}
    </>
  );

  return (
    <div
      style={backdropStyle}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="presentation"
    >
      <div style={sheetStyle} role="dialog" aria-label={`Talking to ${npc.name}`}>
        <button style={closeBtn} onClick={onClose} aria-label="Close dialogue">✕</button>
        {body}
      </div>
    </div>
  );
}
