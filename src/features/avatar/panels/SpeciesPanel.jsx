import React from 'react';
import { SliderRow, MeshGrid, SectionLabel } from './shared.jsx';

const HORN_OPTIONS = [
  { key: null,           label: 'None' },
  { key: 'horns_small',  label: 'Small' },
  { key: 'horns_large',  label: 'Large' },
  { key: 'horns_curved', label: 'Curved' },
];

export default function SpeciesPanel({ config, avatar, onChange, assetLibrary }) {
  const setEar = (val) => {
    avatar?.setSpeciesMorph(val);
    onChange({ species: { ...config.species, earMorph: val } });
  };

  const setHorns = (key) => {
    avatar?.setHornMesh(key, assetLibrary);
    onChange({ species: { ...config.species, hornMesh: key } });
  };

  return (
    <div style={{ padding: '12px 0' }}>
      <p style={{ color: '#64748b', fontSize: 11, margin: '0 0 14px' }}>
        Species features are morph-based (ears) or separate meshes (horns).
      </p>

      <SectionLabel>Ear Shape</SectionLabel>
      <SliderRow
        label="Elf Ears"
        value={config.species.earMorph}
        onChange={setEar}
      />

      <SectionLabel>Horns</SectionLabel>
      <MeshGrid
        items={HORN_OPTIONS}
        selected={config.species.hornMesh}
        onSelect={setHorns}
        renderItem={item => (
          <span style={{ fontSize: 11, color: '#94a3b8' }}>{item.label}</span>
        )}
      />
    </div>
  );
}
