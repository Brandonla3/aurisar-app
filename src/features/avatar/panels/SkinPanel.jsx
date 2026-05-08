import React from 'react';
import { ColorSwatch, MeshGrid, SectionLabel } from './shared.jsx';

const SKIN_TONES = [
  '#FDDBB4', '#F5C89A', '#E8B07A', '#D4936A',
  '#C68642', '#A0522D', '#8B4513', '#5C2E0E',
  '#3B1A0A', '#1A0A00',
];

const MARKINGS = [
  { key: null,              label: 'None' },
  { key: 'scar_face',       label: 'Face Scar' },
  { key: 'tattoo_tribal',   label: 'Tribal Tattoo' },
  { key: 'freckles',        label: 'Freckles' },
  { key: 'vitiligo',        label: 'Vitiligo' },
  { key: 'scales_partial',  label: 'Scales' },
  { key: 'glow_marks',      label: 'Glow Marks' },
];

export default function SkinPanel({ config, avatar, onChange }) {
  const setTone = (hex) => {
    avatar?.setSkinTone(hex);
    onChange({ skin: { ...config.skin, tone: hex } });
  };

  const setMarking = (key) => {
    avatar?.setMarking(key);
    onChange({ skin: { ...config.skin, marking: key } });
  };

  return (
    <div style={{ padding: '12px 0' }}>
      <SectionLabel>Skin Tone</SectionLabel>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        {SKIN_TONES.map(hex => (
          <ColorSwatch
            key={hex}
            color={hex}
            selected={config.skin.tone === hex}
            onClick={() => setTone(hex)}
          />
        ))}
      </div>

      <SectionLabel>Markings</SectionLabel>
      <MeshGrid
        items={MARKINGS}
        selected={config.skin.marking}
        onSelect={setMarking}
        renderItem={item => (
          <span style={{ fontSize: 11, color: '#94a3b8' }}>{item.label}</span>
        )}
      />
    </div>
  );
}
