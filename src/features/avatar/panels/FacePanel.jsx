import React from 'react';
import { SliderRow, SectionLabel } from './shared.jsx';

export default function FacePanel({ config, avatar, onChange }) {
  const set = (key, val) => {
    avatar?.setFaceMorph(key, val);
    onChange({ face: { ...config.face, [key]: val } });
  };

  return (
    <div style={{ padding: '12px 0' }}>
      <SectionLabel>Structure</SectionLabel>
      <SliderRow label="Jaw Width"    value={config.face.jaw}           onChange={v => set('jaw',           v)} />
      <SliderRow label="Brow Height"  value={config.face.browHeight}    onChange={v => set('browHeight',    v)} />
      <SliderRow label="Cheek Fill"   value={config.face.cheekFullness} onChange={v => set('cheekFullness', v)} />

      <SectionLabel>Features</SectionLabel>
      <SliderRow label="Eye Size"     value={config.face.eyeSize}       onChange={v => set('eyeSize',       v)} />
      <SliderRow label="Nose Width"   value={config.face.noseWidth}     onChange={v => set('noseWidth',     v)} />
      <SliderRow label="Lip Size"     value={config.face.lipSize}       onChange={v => set('lipSize',       v)} />
    </div>
  );
}
