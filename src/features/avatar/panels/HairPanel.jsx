import React from 'react';
import { ColorSwatch, MeshGrid, SectionLabel } from './shared.jsx';

const HAIR_STYLES = [
  { key: 'hair_short',    label: 'Short' },
  { key: 'hair_long',     label: 'Long' },
  { key: 'hair_braids',   label: 'Braids' },
  { key: 'hair_ponytail', label: 'Ponytail' },
  { key: 'hair_bun',      label: 'Bun' },
  { key: 'hair_wavy',     label: 'Wavy' },
  { key: 'hair_afro',     label: 'Afro' },
  { key: 'hair_mohawk',   label: 'Mohawk' },
  { key: 'hair_shaved',   label: 'Shaved' },
];

const HAIR_COLORS = [
  '#2C1B0A', '#5C3317', '#8B4513', '#A0522D',
  '#C68642', '#D4AF37', '#F5DEB3', '#FFFACD',
  '#1C1C1C', '#708090', '#FFFFFF', '#B22222',
  '#800020', '#4B0082', '#000080', '#006400',
  '#FF69B4', '#00CED1', '#FF4500', '#7B68EE',
];

export default function HairPanel({ config, avatar, assetLibrary, onChange }) {
  const setStyle = (style) => {
    avatar?.setHair(style, config.hair.color, assetLibrary);
    onChange({ hair: { ...config.hair, style } });
  };

  const setColor = (color) => {
    avatar?.setHair(config.hair.style, color, assetLibrary);
    onChange({ hair: { ...config.hair, color } });
  };

  return (
    <div style={{ padding: '12px 0' }}>
      <SectionLabel>Style</SectionLabel>
      <MeshGrid
        items={HAIR_STYLES}
        selected={config.hair.style}
        onSelect={setStyle}
        renderItem={item => (
          <span style={{ fontSize: 11, color: '#94a3b8' }}>{item.label}</span>
        )}
      />

      <div style={{ height: 16 }} />

      <SectionLabel>Color</SectionLabel>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {HAIR_COLORS.map(hex => (
          <ColorSwatch
            key={hex}
            color={hex}
            selected={config.hair.color === hex}
            onClick={() => setColor(hex)}
          />
        ))}
      </div>
    </div>
  );
}
