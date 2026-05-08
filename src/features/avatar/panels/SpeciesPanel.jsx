import React from 'react';
import { SliderRow, MeshGrid, SectionLabel } from './shared.jsx';

const HORN_OPTIONS = [
  { key: null,           label: 'None' },
  { key: 'horns_small',  label: 'Small' },
  { key: 'horns_large',  label: 'Large' },
  { key: 'horns_curved', label: 'Curved' },
];

const TAIL_OPTIONS = [
  { key: null,          label: 'None' },
  { key: 'tail_short',  label: 'Short' },
  { key: 'tail_long',   label: 'Long' },
  { key: 'tail_fluffy', label: 'Fluffy' },
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

  const setTail = (key) => {
    avatar?.setTailMesh?.(key, assetLibrary);
    onChange({ species: { ...config.species, tailMesh: key } });
  };

  return (
    <div style={{ padding: '12px 0' }}>
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

      <div style={{ height: 16 }} />

      <SectionLabel>Tail</SectionLabel>
      <MeshGrid
        items={TAIL_OPTIONS}
        selected={config.species.tailMesh}
        onSelect={setTail}
        renderItem={item => (
          <span style={{ fontSize: 11, color: '#94a3b8' }}>{item.label}</span>
        )}
      />
    </div>
  );
}
