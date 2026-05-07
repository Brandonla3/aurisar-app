import React from 'react';
import { ColorSwatch, SectionLabel } from './shared.jsx';

const SKIN_TONES = [
  '#FDDBB4', '#F5C89A', '#E8B07A', '#D4936A',
  '#C68642', '#A0522D', '#8B4513', '#5C2E0E',
  '#3B1A0A', '#1A0A00',
];

const MARKINGS = [
  { key: null,           label: 'None' },
  { key: 'scar_face',    label: 'Face Scar' },
  { key: 'tattoo_tribal',label: 'Tribal Tattoo' },
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {MARKINGS.map(m => (
          <button
            key={String(m.key)}
            onClick={() => setMarking(m.key)}
            style={{
              background:   config.skin.marking === m.key ? '#1e3a5f' : '#1e293b',
              border:       config.skin.marking === m.key ? '1px solid #7dd3fc' : '1px solid #334155',
              borderRadius: 8,
              padding:      '8px 12px',
              color:        '#94a3b8',
              fontSize:     12,
              cursor:       'pointer',
              textAlign:    'left',
              fontFamily:   'Inter, system-ui, sans-serif',
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
    </div>
  );
}
