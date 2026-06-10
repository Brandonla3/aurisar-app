/**
 * GameMenu — central modal listing controls + quick access to Map / Inventory /
 * Cooking, plus visibility toggles for the action-button cluster and minimap.
 * Works on all devices.
 */

import React from 'react';
import WorldModal from './ui/WorldModal.jsx';
import { HOTKEYS } from './game/hotkeys.js';
import { FONT, ghostBtn } from './ui/panelTheme.js';

function Toggle({ label, on, onClick }) {
  return (
    <button
      onClick={onClick}
      role="switch"
      aria-checked={on}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        gap: 12, width: '100%', padding: '9px 12px', borderRadius: 9,
        background: 'rgba(30, 41, 59, 0.9)',
        border: '1px solid rgba(148, 163, 184, 0.25)',
        color: '#e2e8f0', fontSize: 13, fontWeight: 600, fontFamily: FONT,
        cursor: 'pointer', minHeight: 40, WebkitTapHighlightColor: 'transparent',
      }}
    >
      <span>{label}</span>
      <span
        style={{
          width: 38, height: 22, borderRadius: 11, flexShrink: 0,
          background: on ? '#c49428' : 'rgba(100,116,139,0.5)',
          position: 'relative', transition: 'background 120ms',
        }}
      >
        <span style={{
          position: 'absolute', top: 2, left: on ? 18 : 2,
          width: 18, height: 18, borderRadius: '50%', background: '#fff',
          transition: 'left 120ms',
        }} />
      </span>
    </button>
  );
}

export default function GameMenu({ onClose, onOpenMap, onOpenInventory, onOpenCooking,
  showActionButtons, onToggleActionButtons, minimapVisible, onToggleMinimap }) {
  return (
    <WorldModal title="Menu" onClose={onClose} width={420}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button style={ghostBtn} onClick={onOpenMap}>🗺 World Map</button>
        <button style={ghostBtn} onClick={onOpenInventory}>🎒 Inventory</button>
        <button style={ghostBtn} onClick={onOpenCooking}>🍳 Cooking</button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
        <Toggle label="Show action buttons" on={showActionButtons} onClick={onToggleActionButtons} />
        <Toggle label="Show minimap" on={minimapVisible} onClick={onToggleMinimap} />
      </div>

      <h3 style={{ margin: '0 0 8px', fontSize: 13, color: '#94a3b8', fontFamily: FONT, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        Controls
      </h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px' }}>
        {HOTKEYS.map((h) => (
          <React.Fragment key={h.keys}>
            <kbd style={{
              justifySelf: 'start',
              background: 'rgba(2,6,14,0.6)', border: '1px solid rgba(148,163,184,0.25)',
              borderRadius: 6, padding: '2px 8px', fontSize: 11, color: '#7dd3fc',
              fontFamily: 'JetBrains Mono, monospace', whiteSpace: 'nowrap',
            }}>{h.keys}</kbd>
            <span style={{ fontSize: 12.5, color: '#cbd5e1', alignSelf: 'center', fontFamily: FONT }}>{h.action}</span>
          </React.Fragment>
        ))}
      </div>
    </WorldModal>
  );
}
