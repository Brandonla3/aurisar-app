import React from 'react';
import { SliderRow, SectionLabel } from './shared.jsx';

export default function BodyPanel({ config, avatar, onChange }) {
  const set = (key, val) => {
    avatar?.setBodyMorph(key, val);
    onChange({ body: { ...config.body, [key]: val } });
  };

  return (
    <div style={{ padding: '12px 0' }}>
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
