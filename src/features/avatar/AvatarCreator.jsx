import React, { useState, useCallback, useRef } from 'react';
import AvatarPreview   from './AvatarPreview.jsx';
import BodyPanel       from './panels/BodyPanel.jsx';
import FacePanel       from './panels/FacePanel.jsx';
import SpeciesPanel    from './panels/SpeciesPanel.jsx';
import SkinPanel       from './panels/SkinPanel.jsx';
import HairPanel       from './panels/HairPanel.jsx';
import ClothingPanel   from './panels/ClothingPanel.jsx';
import { mergeConfig, DEFAULT_AVATAR } from '../world/game/avatarSchema.js';

const TABS = [
  { key: 'body',     label: 'Body' },
  { key: 'face',     label: 'Face' },
  { key: 'species',  label: 'Species' },
  { key: 'skin',     label: 'Skin' },
  { key: 'hair',     label: 'Hair' },
  { key: 'clothing', label: 'Clothing' },
];

export default function AvatarCreator({ initialConfig, onSave, onCancel, saving = false }) {
  const [config,    setConfig] = useState(() => mergeConfig(initialConfig));
  const [activeTab, setTab]    = useState('body');
  const avatarRef   = useRef(null);
  const assetLibRef = useRef(null);

  const patch = useCallback((partial) => {
    setConfig(prev => ({ ...prev, ...partial }));
  }, []);

  const randomise = useCallback(() => {
    const rand = (min = 0, max = 1) => Math.random() * (max - min) + min;
    const pick  = arr => arr[Math.floor(Math.random() * arr.length)];
    const tones = ['#FDDBB4','#F5C89A','#E8B07A','#D4936A','#C68642','#A0522D','#8B4513','#5C2E0E','#3B1A0A'];
    const hairs  = ['hair_short','hair_long','hair_braids','hair_ponytail','hair_bun','hair_wavy','hair_afro'];
    const hCols  = ['#2C1B0A','#5C3317','#8B4513','#C68642','#1C1C1C','#708090','#B22222','#4B0082','#D4AF37'];
    const horns  = [null, null, null, 'horns_small', 'horns_large', 'horns_curved'];
    const tails  = [null, null, 'tail_short', 'tail_long', 'tail_fluffy'];
    const tops   = ['top_casual','top_hoodie','top_tank','top_robe','top_jacket'];
    const bots   = ['bottom_jeans','bottom_shorts','bottom_skirt','bottom_leggings'];
    const shoes  = ['shoes_boots','shoes_sandals','shoes_sneakers'];

    const next = {
      body: {
        height:        rand(),
        weight:        rand(),
        muscle:        rand(),
        age:           rand(0.1, 0.6),
        shoulderWidth: rand(),
        hipWidth:      rand(),
      },
      face: {
        jaw:           rand(),
        eyeSize:       rand(),
        noseWidth:     rand(),
        browHeight:    rand(),
        cheekFullness: rand(),
        lipSize:       rand(),
      },
      skin:    { tone: pick(tones), marking: null },
      species: { earMorph: rand(0, 0.8), hornMesh: pick(horns), tailMesh: pick(tails) },
      hair:    { style: pick(hairs), color: pick(hCols) },
      clothing:{ top: pick(tops), bottom: pick(bots), shoes: pick(shoes) },
      gear:    config.gear,
    };
    setConfig(prev => ({ ...prev, ...next, version: prev.version }));
  }, [config.gear]);

  const panelProps = { config, avatar: avatarRef.current, assetLibrary: assetLibRef.current, onChange: patch };

  return (
    <div style={S.overlay}>
      {/* Header — title only */}
      <div style={S.header}>
        <span style={S.title}>Edit Appearance</span>
        <button style={S.btnClose} onClick={onCancel} title="Close">✕</button>
      </div>

      {/* Body: left panel + 3D preview */}
      <div style={S.body}>

        {/* Left — tabs + scrollable panel content + sticky action footer */}
        <div style={S.left}>
          {/* Tabs */}
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

          {/* Scrollable panel area */}
          <div style={S.panelScroll}>
            {activeTab === 'body'     && <BodyPanel     {...panelProps} />}
            {activeTab === 'face'     && <FacePanel     {...panelProps} />}
            {activeTab === 'species'  && <SpeciesPanel  {...panelProps} />}
            {activeTab === 'skin'     && <SkinPanel     {...panelProps} />}
            {activeTab === 'hair'     && <HairPanel     {...panelProps} />}
            {activeTab === 'clothing' && <ClothingPanel {...panelProps} />}
          </div>

          {/* Sticky action footer — always visible */}
          <div style={S.actionBar}>
            <button style={S.btnRandomise} onClick={randomise}>⚡ Randomise</button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button style={S.btnCancel} onClick={onCancel}>Cancel</button>
              <button
                style={{ ...S.btnSave, opacity: saving ? 0.6 : 1 }}
                onClick={() => onSave(config)}
                disabled={saving}
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
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
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const S = {
  overlay: {
    position:      'fixed',
    inset:         0,
    zIndex:        10000,
    background:    '#0d1117',
    display:       'flex',
    flexDirection: 'column',
    fontFamily:    'Inter, system-ui, sans-serif',
  },
  header: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    padding:        '0 20px',
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
    fontSize:     16,
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
    width:         380,
    flexShrink:    0,
    display:       'flex',
    flexDirection: 'column',
    borderRight:   '1px solid #1e293b',
    background:    '#0f172a',
  },
  tabRow: {
    display:       'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap:           4,
    padding:       '10px 12px',
    borderBottom:  '1px solid #1e293b',
    flexShrink:    0,
  },
  tab: {
    background:   'transparent',
    border:       '1px solid #1e293b',
    borderRadius: 8,
    color:        '#64748b',
    fontSize:     12,
    fontWeight:   500,
    padding:      '6px 4px',
    cursor:       'pointer',
    fontFamily:   'Inter, system-ui, sans-serif',
    textAlign:    'center',
    transition:   'background 0.15s, color 0.15s, border-color 0.15s',
  },
  tabActive: {
    background:  '#1e3a5f',
    border:      '1px solid #3b82f6',
    color:       '#7dd3fc',
    fontWeight:  600,
  },
  panelScroll: {
    flex:      1,
    overflowY: 'auto',
    padding:   '4px 16px 12px',
  },
  actionBar: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    padding:        '12px 16px',
    borderTop:      '1px solid #1e293b',
    background:     '#0a1120',
    flexShrink:     0,
    gap:            8,
  },
  btnRandomise: {
    background:   'transparent',
    border:       '1px solid #334155',
    borderRadius: 8,
    color:        '#94a3b8',
    fontSize:     12,
    fontWeight:   500,
    padding:      '8px 14px',
    cursor:       'pointer',
    fontFamily:   'Inter, system-ui, sans-serif',
    letterSpacing:'0.01em',
  },
  btnCancel: {
    background:   'transparent',
    border:       '1px solid #334155',
    borderRadius: 8,
    color:        '#94a3b8',
    fontSize:     13,
    padding:      '8px 16px',
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
    padding:      '8px 22px',
    cursor:       'pointer',
    fontFamily:   'Inter, system-ui, sans-serif',
  },
  preview: {
    flex:          1,
    display:       'flex',
    flexDirection: 'column',
    padding:       16,
    background:    '#0d1117',
  },
  previewHint: {
    color:     '#334155',
    fontSize:  10,
    textAlign: 'center',
    margin:    '6px 0 0',
  },
};
