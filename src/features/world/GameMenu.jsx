/**
 * GameMenu — central modal listing controls + quick access to Map / Inventory /
 * Cooking, plus visibility toggles for the action-button cluster and minimap.
 * Works on all devices.
 */

import React, { useState, useEffect } from 'react';
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

// Testing aid: scrub / freeze the day-night cycle so foliage, water and sky can
// be evaluated at a fixed time. Setting any time freezes the clock; Resume lets
// it run again.
function TimeOfDayControl({ sceneRef }) {
  const [hours, setHours] = useState(12);
  const [frozen, setFrozen] = useState(false);

  // Reflect the live clock when the menu opens (without freezing it).
  useEffect(() => {
    const t = sceneRef?.current?.getTimeOfDay?.();
    if (typeof t === 'number') setHours(t);
  }, [sceneRef]);

  const set = (h) => {
    setHours(h);
    setFrozen(true);
    sceneRef?.current?.setTimeOfDay?.(h, true);
  };
  const resume = () => {
    setFrozen(false);
    sceneRef?.current?.setDayNightFrozen?.(false);
  };

  const label = `${String(Math.floor(hours)).padStart(2, '0')}:${String(Math.round((hours % 1) * 60)).padStart(2, '0')}`;
  const preset = { ...ghostBtn, padding: '4px 10px', fontSize: 12 };

  return (
    <div style={{ marginBottom: 18 }}>
      <h3 style={{ margin: '0 0 8px', fontSize: 13, color: '#94a3b8', fontFamily: FONT, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        Time of day · testing
      </h3>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <input
          type="range" min={0} max={24} step={0.25} value={hours}
          onChange={(e) => set(parseFloat(e.target.value))}
          style={{ flex: 1, accentColor: '#c49428' }}
          aria-label="Time of day"
        />
        <span style={{
          fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: frozen ? '#fbbf77' : '#7dd3fc',
          minWidth: 44, textAlign: 'right',
        }}>{label}</span>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button style={preset} onClick={() => set(8)}>🌅 Morning</button>
        <button style={preset} onClick={() => set(12.5)}>☀️ Noon</button>
        <button style={preset} onClick={() => set(18.5)}>🌇 Dusk</button>
        <button style={preset} onClick={() => set(0)}>🌙 Night</button>
        <button style={{ ...preset, color: frozen ? '#cbd5e1' : '#7ee787' }} onClick={resume}>▶ Resume cycle</button>
      </div>
    </div>
  );
}

// Volumetric clouds (Phase 6) — high graphics tier only; the scene hides the
// toggle entirely on devices that don't run the high-tier stack. State lives
// in BabylonWorldScene (persisted to localStorage), the menu just mirrors it.
function VolumetricCloudsToggle({ sceneRef }) {
  // Ref reads happen in the effect (not during render) — mirrors the live
  // scene state when the menu opens.
  const [state, setState] = useState({ supported: false, on: false });
  useEffect(() => {
    const s = sceneRef?.current;
    setState({
      supported: s?.supportsVolumetricClouds?.() ?? false,
      on: s?.getVolumetricClouds?.() ?? false,
    });
  }, [sceneRef]);
  if (!state.supported) return null;
  return (
    <Toggle
      label="Volumetric clouds"
      on={state.on}
      onClick={() => {
        const next = !state.on;
        setState((p) => ({ ...p, on: next }));
        sceneRef?.current?.setVolumetricClouds?.(next);
      }}
    />
  );
}

export default function GameMenu({ onClose, onOpenMap, onOpenInventory, onOpenCooking,
  showActionButtons, onToggleActionButtons, minimapVisible, onToggleMinimap, sceneRef, onExit }) {
  return (
    <WorldModal title="Menu" onClose={onClose} width={420}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button style={ghostBtn} onClick={onOpenMap}>🗺 World Map</button>
        <button style={ghostBtn} onClick={onOpenInventory}>🎒 Inventory</button>
        <button style={ghostBtn} onClick={onOpenCooking}>🍳 Cooking</button>
      </div>

      <h3 style={{ margin: '0 0 8px', fontSize: 13, color: '#94a3b8', fontFamily: FONT, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        Settings
      </h3>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 18 }}>
        <Toggle label="Show action buttons" on={showActionButtons} onClick={onToggleActionButtons} />
        <Toggle label="Show minimap" on={minimapVisible} onClick={onToggleMinimap} />
        <VolumetricCloudsToggle sceneRef={sceneRef} />
        <button
          onClick={onExit}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: '100%', padding: '9px 12px', borderRadius: 9, minHeight: 40,
            background: 'rgba(127, 29, 29, 0.35)',
            border: '1px solid rgba(248, 113, 113, 0.4)',
            color: '#fca5a5', fontSize: 13, fontWeight: 600, fontFamily: FONT,
            cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
          }}
        >
          Exit World
        </button>
      </div>

      <h3 style={{ margin: '0 0 8px', fontSize: 13, color: '#94a3b8', fontFamily: FONT, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
        Fast travel · testing
      </h3>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
        <button
          style={{ ...ghostBtn, padding: '4px 10px', fontSize: 12 }}
          onClick={() => { sceneRef?.current?.fastTravelToCastle?.(); onClose(); }}
        >
          🏰 Castle gates
        </button>
      </div>

      <TimeOfDayControl sceneRef={sceneRef} />

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
