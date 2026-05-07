import React from 'react';
import { SliderRow } from './shared.jsx';

export default function BodyPanel({ config, avatar, onChange }) {
  const set = (key, val) => {
    avatar?.setBodyMorph(key, val);
    onChange({ body: { ...config.body, [key]: val } });
  };

  return (
    <div style={S.wrap}>
      <p style={S.hint}>Drag sliders to shape your body proportions.</p>
      <SliderRow label="Height"  value={config.body.height}  onChange={v => set('height',  v)} />
      <SliderRow label="Weight"  value={config.body.weight}  onChange={v => set('weight',  v)} />
      <SliderRow label="Muscle"  value={config.body.muscle}  onChange={v => set('muscle',  v)} />
      <SliderRow label="Age"     value={config.body.age}     onChange={v => set('age',     v)} />
    </div>
  );
}

const S = {
  wrap: { padding: '12px 0' },
  hint: { color: '#64748b', fontSize: 11, margin: '0 0 14px' },
};
