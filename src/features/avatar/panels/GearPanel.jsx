import React from 'react';
import { MeshGrid, SectionLabel } from './shared.jsx';

const HELMETS = [
  { key: null,               label: 'None' },
  { key: 'helmet_fantasy1',  label: 'Fantasy I' },
];

const CHESTS = [
  { key: null,              label: 'None' },
  { key: 'chest_fantasy1', label: 'Fantasy I' },
];

const GAUNTLETS = [
  { key: null,                  label: 'None' },
  { key: 'gauntlets_fantasy1',  label: 'Fantasy I' },
];

const LEGS = [
  { key: null,             label: 'None' },
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
        Armor — Fantasy I leather set (Kagi Vision Pack).
      </p>

      <SectionLabel>Helmet</SectionLabel>
      <MeshGrid items={HELMETS} selected={config.gear.helmet}
        onSelect={k => set('helmet', k)}
        renderItem={i => <span style={{ fontSize: 11, color: '#94a3b8' }}>{i.label}</span>}
      />

      <div style={{ height: 16 }} />

      <SectionLabel>Chest &amp; Shoulders</SectionLabel>
      <MeshGrid items={CHESTS} selected={config.gear.chest}
        onSelect={k => set('chest', k)}
        renderItem={i => <span style={{ fontSize: 11, color: '#94a3b8' }}>{i.label}</span>}
      />

      <div style={{ height: 16 }} />

      <SectionLabel>Gauntlets</SectionLabel>
      <MeshGrid items={GAUNTLETS} selected={config.gear.gauntlets}
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
