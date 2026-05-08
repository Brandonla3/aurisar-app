import React from 'react';
import { SliderRow, SectionLabel } from './shared.jsx';

const GENDERS = [
  { key: 'neutral', label: 'Neutral' },
  { key: 'female',  label: 'Female' },
  { key: 'male',    label: 'Male' },
];

export default function BodyPanel({ config, avatar, onChange }) {
  const set = (key, val) => {
    avatar?.setBodyMorph(key, val);
    onChange({ body: { ...config.body, [key]: val } });
  };

  // Gender swap rebuilds the entire avatar (different base body GLB), so this
  // path goes through onChange — AvatarPreview rebuilds when config changes.
  const setGender = (gender) => {
    onChange({ body: { ...config.body, gender } });
  };

  return (
    <div style={{ padding: '12px 0' }}>
      <SectionLabel>Body Type</SectionLabel>
      <div style={GR.row}>
        {GENDERS.map(g => (
          <button
            key={g.key}
            onClick={() => setGender(g.key)}
            style={{
              ...GR.btn,
              background: config.body.gender === g.key ? '#1e3a5f' : '#1e293b',
              border:     config.body.gender === g.key ? '1px solid #7dd3fc' : '1px solid #334155',
              color:      config.body.gender === g.key ? '#e2e8f0' : '#94a3b8',
            }}
          >
            {g.label}
          </button>
        ))}
      </div>

      <SectionLabel>Proportions</SectionLabel>
      <SliderRow label="Height"        value={config.body.height}        onChange={v => set('height',        v)} />
      <SliderRow label="Weight"        value={config.body.weight}        onChange={v => set('weight',        v)} />
      <SliderRow label="Muscle"        value={config.body.muscle}        onChange={v => set('muscle',        v)} />
      <SliderRow label="Age"           value={config.body.age}           onChange={v => set('age',           v)} />

      <SectionLabel>Build</SectionLabel>
      <SliderRow label="Shoulders"     value={config.body.shoulderWidth} onChange={v => set('shoulderWidth', v)} />
      <SliderRow label="Hips"          value={config.body.hipWidth}      onChange={v => set('hipWidth',      v)} />
    </div>
  );
}

const GR = {
  row: { display: 'flex', gap: 6, marginBottom: 16 },
  btn: {
    flex: 1, padding: '8px 10px', borderRadius: 8,
    fontSize: 12, fontFamily: 'Inter, system-ui, sans-serif',
    cursor: 'pointer',
  },
};
