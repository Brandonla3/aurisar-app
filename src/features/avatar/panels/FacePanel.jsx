import React from 'react';
import { SliderRow } from './shared.jsx';

export default function FacePanel({ config, avatar, onChange }) {
  const set = (key, val) => {
    avatar?.setFaceMorph(key, val);
    onChange({ face: { ...config.face, [key]: val } });
  };

  return (
    <div style={{ padding: '12px 0' }}>
      <p style={{ color: '#64748b', fontSize: 11, margin: '0 0 14px' }}>
        Shape facial features. Changes apply live in the preview.
      </p>
      <SliderRow label="Jaw Width"   value={config.face.jaw}        onChange={v => set('jaw',        v)} />
      <SliderRow label="Eye Size"    value={config.face.eyeSize}    onChange={v => set('eyeSize',    v)} />
      <SliderRow label="Nose Width"  value={config.face.noseWidth}  onChange={v => set('noseWidth',  v)} />
      <SliderRow label="Brow Height" value={config.face.browHeight} onChange={v => set('browHeight', v)} />
    </div>
  );
}
