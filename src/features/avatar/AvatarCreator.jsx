/**
 * AvatarCreator — full-screen character creator modal.
 *
 * Props:
 *   initialConfig  — AvatarConfig to start from (null → DEFAULT_AVATAR)
 *   onSave(config) — called when user clicks Save
 *   onCancel()     — called when user cancels
 *   saving         — boolean, disables save button while saving
 */

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
  const [config,   setConfig]   = useState(() => mergeConfig(initialConfig));
  const [activeTab, setTab]     = useState('body');
  const avatarRef = useRef(null);

  const patch = useCallback((partial) => {
    setConfig(prev => ({ ...prev, ...partial }));
  }, []);

  const randomise = useCallback(() => {
    const rand = (min = 0, max = 1) => Math.random() * (max - min) + min;
    const pick  = arr => arr[Math.floor(Math.random() * arr.length)];
    const tones = ['#FDDBB4','#E8B07A','#C68642','#A0522D','#8B4513','#5C2E0E'];
    const hairs  = ['hair_short','hair_long','hair_braids'];
    const hCols  = ['#2C1B0A','#5C3317','#8B4513','#C68642','#1C1C1C','#708090','#B22222'];
    const horns  = [null, null, null, 'horns_small', 'horns_large', 'horns_curved'];
    const tops   = ['top_casual','top_hoodie'];
    const bots   = ['bottom_jeans','bottom_shorts'];

    const next = {
      body:    { height: rand(), weight: rand(), muscle: rand(), age: rand(0.1, 0.6) },
      face:    { jaw: rand(), eyeSize: rand(), noseWidth: rand(), browHeight: rand() },
      skin:    { tone: pick(tones), marking: null },
      species: { earMorph: rand(0, 0.8), hornMesh: pick(horns) },
      hair:    { style: pick(hairs), color: pick(hCols) },
      clothing:{ top: pick(tops), bottom: pick(bots), shoes: 'shoes_boots' },
      gear:    config.gear,
    };
    setConfig(prev => ({ ...prev, ...next, version: prev.version }));
  }, [config.gear]);

  const panelProps = { config, avatar: avatarRef.current, onChange: patch };

  return (
    <div style={S.overlay}>
      {/* Header */}
      <div style={S.header}>
        <span style={S.title}>Appearance</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={S.btnGhost} onClick={randomise}>Randomise</button>
          <button style={S.btnGhost} onClick={onCancel}>Cancel</button>
          <button
            style={{ ...S.btnPrimary, opacity: saving ? 0.6 : 1 }}
            onClick={() => onSave(config)}
            disabled={saving}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Body: left panel + 3D preview */}
      <div style={S.body}>
        {/* Left — tabs + panel */}
        <div style={S.left}>
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
          </div>
        </div>

        {/* Right — 3D preview */}
        <div style={S.preview}>
          <AvatarPreview
            config={config}
            onAvatarReady={av => { avatarRef.current = av; }}
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
    position:   'fixed',
    inset:      0,
    zIndex:     10000,
    background: '#0d1117',
    display:    'flex',
    flexDirection: 'column',
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  header: {
    display:        'flex',
    alignItems:     'center',
    justifyContent: 'space-between',
    padding:        '0 20px',
    height:         52,
    background:     '#0f172a',
    borderBottom:   '1px solid #1e293b',
    flexShrink:     0,
  },
  title: { color: '#e2e8f0', fontSize: 15, fontWeight: 600 },
  body: {
    flex:    1,
    display: 'flex',
    overflow: 'hidden',
  },
  left: {
    width:          300,
    flexShrink:     0,
    display:        'flex',
    flexDirection:  'column',
    borderRight:    '1px solid #1e293b',
    background:     '#0f172a',
  },
  tabRow: {
    display:        'flex',
    flexWrap:       'wrap',
    gap:            2,
    padding:        '10px 10px 0',
    borderBottom:   '1px solid #1e293b',
    paddingBottom:  10,
  },
  tab: {
    background:   'transparent',
    border:       '1px solid #334155',
    borderRadius: 6,
    color:        '#64748b',
    fontSize:     11,
    padding:      '4px 10px',
    cursor:       'pointer',
    fontFamily:   'Inter, system-ui, sans-serif',
  },
  tabActive: {
    background: '#1e3a5f',
    border:     '1px solid #3b82f6',
    color:      '#7dd3fc',
  },
  panelScroll: {
    flex:       1,
    overflowY:  'auto',
    padding:    '0 14px 20px',
  },
  preview: {
    flex:       1,
    display:    'flex',
    flexDirection: 'column',
    padding:    16,
    background: '#0d1117',
  },
  previewHint: {
    color:     '#334155',
    fontSize:  10,
    textAlign: 'center',
    margin:    '6px 0 0',
  },
  btnPrimary: {
    background:   '#3b82f6',
    border:       'none',
    borderRadius: 8,
    color:        '#fff',
    fontSize:     13,
    fontWeight:   600,
    padding:      '6px 18px',
    cursor:       'pointer',
    fontFamily:   'Inter, system-ui, sans-serif',
  },
  btnGhost: {
    background:   'transparent',
    border:       '1px solid #334155',
    borderRadius: 8,
    color:        '#94a3b8',
    fontSize:     13,
    padding:      '6px 14px',
    cursor:       'pointer',
    fontFamily:   'Inter, system-ui, sans-serif',
  },
};
