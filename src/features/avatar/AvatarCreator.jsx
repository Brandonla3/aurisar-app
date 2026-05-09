import React, { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import AvatarPreview   from './AvatarPreview.jsx';
import BodyPanel       from './panels/BodyPanel.jsx';
import FacePanel       from './panels/FacePanel.jsx';
import SpeciesPanel    from './panels/SpeciesPanel.jsx';
import SkinPanel       from './panels/SkinPanel.jsx';
import HairPanel       from './panels/HairPanel.jsx';
import ClothingPanel   from './panels/ClothingPanel.jsx';
import GearPanel       from './panels/GearPanel.jsx';
import { mergeConfig, DEFAULT_AVATAR } from '../world/game/avatarSchema.js';

const TABS = [
  { key: 'body',     label: 'Body' },
  { key: 'face',     label: 'Face' },
  { key: 'species',  label: 'Species' },
  { key: 'skin',     label: 'Skin' },
  { key: 'hair',     label: 'Hair' },
  { key: 'clothing', label: 'Clothing' },
  { key: 'armor',    label: 'Armor' },
];

// Default panel width: fill up to 380px but never more than 65% of viewport
// so the character preview is always visible even on narrow phones.
const defaultPanelWidth = () => Math.min(380, Math.round(window.innerWidth * 0.65));

export default function AvatarCreator({ initialConfig, onSave, onCancel, saving = false }) {
  const [config,     setConfig]     = useState(() => mergeConfig(initialConfig));
  const [activeTab,  setTab]        = useState('body');
  const [panelWidth, setPanelWidth] = useState(defaultPanelWidth);
  const [saveError,  setSaveError]  = useState(null);

  const avatarRef    = useRef(null);
  const assetLibRef  = useRef(null);
  const widthAtDragStart = useRef(0);
  const xAtDragStart     = useRef(0);

  const patch = useCallback((partialOrFn) => {
    if (typeof partialOrFn === 'function') {
      setConfig(partialOrFn);
    } else {
      setConfig(prev => ({ ...prev, ...partialOrFn }));
    }
  }, []);

  // ── Drag-to-resize divider ───────────────────────────────────────────────
  const onHandlePointerDown = useCallback((e) => {
    e.preventDefault();
    xAtDragStart.current = e.touches ? e.touches[0].clientX : e.clientX;
    widthAtDragStart.current = panelWidth;

    const onMove = (ev) => {
      const x = ev.touches ? ev.touches[0].clientX : ev.clientX;
      const next = Math.max(160, Math.min(window.innerWidth - 80,
        widthAtDragStart.current + (x - xAtDragStart.current)));
      setPanelWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup',   onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend',  onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup',   onUp);
    window.addEventListener('touchmove', onMove, { passive: true });
    window.addEventListener('touchend',  onUp);
  }, [panelWidth]);

  // ── Randomise ────────────────────────────────────────────────────────────
  const randomise = useCallback(() => {
    const rand = (min = 0, max = 1) => Math.random() * (max - min) + min;
    const pick  = arr => arr[Math.floor(Math.random() * arr.length)];
    const tones = ['#FDDBB4','#F5C89A','#E8B07A','#D4936A','#C68642','#A0522D','#8B4513','#5C2E0E','#3B1A0A'];
    const hairs  = ['hair_short','hair_long','hair_braids','hair_ponytail','hair_bun','hair_wavy','hair_afro'];
    const hCols  = ['#2C1B0A','#5C3317','#8B4513','#C68642','#1C1C1C','#708090','#B22222','#4B0082','#D4AF37'];
    const horns  = [null, null, null, 'horns_small', 'horns_large', 'horns_curved'];
    const tails  = [null, null, 'tail_short', 'tail_long', 'tail_fluffy'];
    const tops   = ['top_tunic','top_robe','top_cloth_shirt','top_gambeson','top_leather_vest','top_chainmail'];
    const bots   = ['bottom_trousers','bottom_kilt','bottom_leather_pants','bottom_breeches','bottom_cloth_skirt','bottom_leggings'];
    const shoes  = ['shoes_boots','shoes_sandals','shoes_greaves','shoes_leather_wraps'];

    const next = {
      body: {
        height: rand(), weight: rand(), muscle: rand(), age: rand(0.1, 0.6),
        shoulderWidth: rand(), hipWidth: rand(),
      },
      face: {
        jaw: rand(), eyeSize: rand(), noseWidth: rand(), browHeight: rand(),
        cheekFullness: rand(), lipSize: rand(),
      },
      skin:    { tone: pick(tones), marking: null },
      species: { earMorph: rand(0, 0.8), hornMesh: pick(horns), tailMesh: pick(tails) },
      hair:    { style: pick(hairs), color: pick(hCols) },
      clothing:{ top: pick(tops), bottom: pick(bots), shoes: pick(shoes) },
      gear:    config.gear,
    };
    setSaveError(null);
    setConfig(prev => ({ ...prev, ...next, version: prev.version }));
  }, [config.gear]);

  const panelProps = { config, avatar: avatarRef.current, assetLibrary: assetLibRef.current, onChange: patch };

  // Render via portal so the overlay sits above ALL app stacking contexts
  // (the nav panel, HUD, etc.) regardless of where CharacterTab is mounted.
  return createPortal(
    <div style={S.overlay}>

      {/* Header */}
      <div style={S.header}>
        <span style={S.title}>Edit Appearance</span>
        <button style={S.btnClose} onClick={onCancel} title="Close">✕</button>
      </div>

      {/* Body: resizable left panel + drag handle + 3D preview */}
      <div style={S.body}>

        {/* Left panel */}
        <div style={{ ...S.left, width: panelWidth }}>
          <div style={S.tabRow}>
            {TABS.map(t => (
              <button
                key={t.key}
                style={{ ...S.tab, ...(activeTab === t.key ? S.tabActive : {}) }}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div style={S.panelScroll}>
            {activeTab === 'body'     && <BodyPanel     {...panelProps} />}
            {activeTab === 'face'     && <FacePanel     {...panelProps} />}
            {activeTab === 'species'  && <SpeciesPanel  {...panelProps} />}
            {activeTab === 'skin'     && <SkinPanel     {...panelProps} />}
            {activeTab === 'hair'     && <HairPanel     {...panelProps} />}
            {activeTab === 'clothing' && <ClothingPanel {...panelProps} />}
            {activeTab === 'armor'    && <GearPanel     {...panelProps} />}
          </div>

          {/* Sticky action footer */}
          <div style={S.actionBar}>
            <div style={S.actionRow}>
              <button style={S.btnRandomise} onClick={randomise}>⚡ Randomise</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={S.btnCancel} onClick={onCancel}>Cancel</button>
                <button
                  style={{ ...S.btnSave, opacity: saving ? 0.6 : 1 }}
                  onClick={async () => {
                    setSaveError(null);
                    const ok = await onSave(config);
                    if (ok === false) setSaveError('Save failed — please try again.');
                  }}
                  disabled={saving}
                >
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </div>
            {saveError && <p style={S.saveError}>{saveError}</p>}
          </div>
        </div>

        {/* Drag handle */}
        <div
          style={S.dragHandle}
          onMouseDown={onHandlePointerDown}
          onTouchStart={onHandlePointerDown}
          title="Drag to resize"
        >
          <div style={S.dragGrip} />
        </div>

        {/* Right — 3D preview */}
        <div style={S.preview}>
          <AvatarPreview
            config={config}
            onAvatarReady={(av, lib) => { avatarRef.current = av; assetLibRef.current = lib; }}
            style={{ borderRadius: 12 }}
          />
          <p style={S.previewHint}>Drag to rotate · Scroll to zoom</p>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const S = {
  overlay: {
    position:      'fixed',
    inset:         0,
    zIndex:        99999,
    background:    '#0d1117',
    display:       'flex',
    flexDirection: 'column',
    fontFamily:    'Inter, system-ui, sans-serif',
  },
  header: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    padding:        '0 16px',
    height:         48,
    background:     '#0f172a',
    borderBottom:   '1px solid #1e293b',
    flexShrink:     0,
  },
  title: { color: '#e2e8f0', fontSize: 15, fontWeight: 600, letterSpacing: '0.01em' },
  btnClose: {
    background:   'transparent',
    border:       'none',
    color:        '#475569',
    fontSize:     18,
    cursor:       'pointer',
    padding:      '4px 8px',
    borderRadius: 6,
    lineHeight:   1,
    fontFamily:   'Inter, system-ui, sans-serif',
  },
  body: {
    flex:     1,
    display:  'flex',
    overflow: 'hidden',
  },
  left: {
    flexShrink:    0,
    display:       'flex',
    flexDirection: 'column',
    borderRight:   '1px solid #1e293b',
    background:    '#0f172a',
    minWidth:      160,
  },
  tabRow: {
    display:             'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap:                 4,
    padding:             '10px 10px',
    borderBottom:        '1px solid #1e293b',
    flexShrink:          0,
  },
  tab: {
    background:   'transparent',
    border:       '1px solid #1e293b',
    borderRadius: 8,
    color:        '#64748b',
    fontSize:     11,
    fontWeight:   500,
    padding:      '6px 2px',
    cursor:       'pointer',
    fontFamily:   'Inter, system-ui, sans-serif',
    textAlign:    'center',
  },
  tabActive: {
    background: '#1e3a5f',
    border:     '1px solid #3b82f6',
    color:      '#7dd3fc',
    fontWeight: 600,
  },
  panelScroll: {
    flex:      1,
    overflowY: 'auto',
    padding:   '4px 14px 12px',
  },
  actionBar: {
    display:        'flex',
    flexDirection:  'column',
    gap:            8,
    padding:        '10px 12px calc(10px + env(safe-area-inset-bottom, 0px))',
    borderTop:      '1px solid #1e293b',
    background:     '#0a1120',
    flexShrink:     0,
  },
  actionRow: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    gap:            6,
  },
  saveError: {
    color:      '#f87171',
    fontSize:   11,
    margin:     0,
    textAlign:  'center',
  },
  btnRandomise: {
    background:    'transparent',
    border:        '1px solid #334155',
    borderRadius:  8,
    color:         '#94a3b8',
    fontSize:      12,
    fontWeight:    500,
    padding:       '8px 10px',
    cursor:        'pointer',
    fontFamily:    'Inter, system-ui, sans-serif',
    whiteSpace:    'nowrap',
  },
  btnCancel: {
    background:   'transparent',
    border:       '1px solid #334155',
    borderRadius: 8,
    color:        '#94a3b8',
    fontSize:     13,
    padding:      '8px 12px',
    cursor:       'pointer',
    fontFamily:   'Inter, system-ui, sans-serif',
  },
  btnSave: {
    background:   '#3b82f6',
    border:       'none',
    borderRadius: 8,
    color:        '#fff',
    fontSize:     13,
    fontWeight:   600,
    padding:      '8px 18px',
    cursor:       'pointer',
    fontFamily:   'Inter, system-ui, sans-serif',
  },
  // ── Drag handle ──────────────────────────────────────────────────────────
  dragHandle: {
    width:          12,
    flexShrink:     0,
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'center',
    background:     '#0d1117',
    cursor:         'col-resize',
    userSelect:     'none',
    touchAction:    'none',
  },
  dragGrip: {
    width:        4,
    height:       40,
    borderRadius: 4,
    background:   '#1e293b',
  },
  // ── Preview ──────────────────────────────────────────────────────────────
  preview: {
    flex:          1,
    display:       'flex',
    flexDirection: 'column',
    padding:       12,
    background:    '#0d1117',
    minWidth:      0,
  },
  previewHint: {
    color:     '#334155',
    fontSize:  10,
    textAlign: 'center',
    margin:    '6px 0 0',
  },
};
