import React from 'react';
import { MeshGrid, SectionLabel } from './shared.jsx';

const NONE_ONLY = [{ key: null, label: 'None' }];

const LEGS = [
  { key: null,            label: 'None' },
  { key: 'legs_fantasy1', label: 'Fantasy I' },
];

export default function GearPanel({ config, avatar, assetLibrary, onChange }) {
  const set = (slot, key) => {
    avatar?.setGear(slot, key, assetLibrary);
    onChange(prev => ({ ...prev, gear: { ...prev.gear, [slot]: key } }));
  };

  return (
    <div style={{ padding: '12px 0' }}>
      <p style={{ color: '#64748b', fontSize: 11, margin: '0 0 14px' }}>
        Armor — auto-skinned via the Blender pipeline. New options land as
        more pieces are processed through scripts/blender/04_import_armor.py.
      </p>

      <SectionLabel>Helmet</SectionLabel>
      <MeshGrid items={NONE_ONLY} selected={config.gear.helmet}
        onSelect={k => set('helmet', k)}
        renderItem={i => <span style={{ fontSize: 11, color: '#94a3b8' }}>{i.label}</span>}
      />

      <div style={{ height: 16 }} />

      <SectionLabel>Chest &amp; Shoulders</SectionLabel>
      <MeshGrid items={NONE_ONLY} selected={config.gear.chest}
        onSelect={k => set('chest', k)}
        renderItem={i => <span style={{ fontSize: 11, color: '#94a3b8' }}>{i.label}</span>}
      />

      <div style={{ height: 16 }} />

      <SectionLabel>Gauntlets</SectionLabel>
      <MeshGrid items={NONE_ONLY} selected={config.gear.gauntlets}
        onSelect={k => set('gauntlets', k)}
        renderItem={i => <span style={{ fontSize: 11, color: '#94a3b8' }}>{i.label}</span>}
      />

      <div style={{ height: 16 }} />

      <SectionLabel>Legs</SectionLabel>
      <MeshGrid items={LEGS} selected={config.gear.legs}
        onSelect={k => set('legs', k)}
        renderItem={i => <span style={{ fontSize: 11, color: '#94a3b8' }}>{i.label}</span>}
      />
    </div>
  );
}
