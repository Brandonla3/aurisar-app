/**
 * ActionButtons — row of round action buttons (Map / Quests / Bag / Cook /
 * Fire / Menu). Rendered on all devices; visibility is controlled by the
 * caller (Menu toggle). Unpositioned — the caller (WorldGame) places this
 * row inside the bottom-right toolbar, alongside the chat bubble, so both
 * read as one control strip.
 */

import React from 'react';
import { FONT } from './ui/panelTheme.js';

export const actionBtnStyle = {
  width: 52, height: 52, minWidth: 52, flexShrink: 0,
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  gap: 1,
  background: 'rgba(15, 23, 42, 0.78)',
  backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
  border: '1px solid rgba(148, 163, 184, 0.25)',
  borderRadius: 14, color: '#e2e8f0',
  cursor: 'pointer', fontFamily: FONT,
  WebkitTapHighlightColor: 'transparent', userSelect: 'none',
};
export const actionBtnLabelStyle = { fontSize: 9, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.02em' };

export default function ActionButtons({ onMap, onQuests, onInventory, onCooking, onCampfire, onMenu }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'row', gap: 8 }}>
      <button style={actionBtnStyle} onClick={onMap} aria-label="World map">
        <span style={{ fontSize: 22 }}>🗺</span><span style={actionBtnLabelStyle}>Map</span>
      </button>
      <button style={actionBtnStyle} onClick={onQuests} aria-label="Quest log">
        <span style={{ fontSize: 22 }}>📜</span><span style={actionBtnLabelStyle}>Quests</span>
      </button>
      <button style={actionBtnStyle} onClick={onInventory} aria-label="Inventory">
        <span style={{ fontSize: 22 }}>🎒</span><span style={actionBtnLabelStyle}>Bag</span>
      </button>
      <button style={actionBtnStyle} onClick={onCooking} aria-label="Cooking">
        <span style={{ fontSize: 22 }}>🍳</span><span style={actionBtnLabelStyle}>Cook</span>
      </button>
      <button style={actionBtnStyle} onClick={onCampfire} aria-label="Build campfire">
        <span style={{ fontSize: 22 }}>🔥</span><span style={actionBtnLabelStyle}>Fire</span>
      </button>
      <button style={actionBtnStyle} onClick={onMenu} aria-label="Menu">
        <span style={{ fontSize: 22 }}>☰</span><span style={actionBtnLabelStyle}>Menu</span>
      </button>
    </div>
  );
}
