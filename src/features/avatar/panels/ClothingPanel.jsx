import React from 'react';
import { MeshGrid, SectionLabel } from './shared.jsx';

const TOPS = [
  { key: 'top_tunic',         label: 'Tunic' },
  { key: 'top_robe',          label: 'Robe' },
  { key: 'top_cloth_shirt',   label: 'Cloth Shirt' },
  { key: 'top_gambeson',      label: 'Gambeson' },
  { key: 'top_leather_vest',  label: 'Leather Vest' },
  { key: 'top_chainmail',     label: 'Chainmail' },
];

const BOTTOMS = [
  { key: 'bottom_trousers',     label: 'Trousers' },
  { key: 'bottom_kilt',         label: 'Kilt' },
  { key: 'bottom_leather_pants',label: 'Leather Pants' },
  { key: 'bottom_breeches',     label: 'Breeches' },
  { key: 'bottom_cloth_skirt',  label: 'Cloth Skirt' },
  { key: 'bottom_leggings',     label: 'Leggings' },
];

const SHOES = [
  { key: 'shoes_boots',         label: 'Boots' },
  { key: 'shoes_sandals',       label: 'Sandals' },
  { key: 'shoes_greaves',       label: 'Greaves' },
  { key: 'shoes_leather_wraps', label: 'Leather Wraps' },
];

export default function ClothingPanel({ config, avatar, assetLibrary, onChange }) {
  const set = (slot, key) => {
    avatar?.setClothing(slot, key, assetLibrary);
    onChange({ clothing: { ...config.clothing, [slot]: key } });
  };

  return (
    <div style={{ padding: '12px 0' }}>
      <p style={{ color: '#64748b', fontSize: 11, margin: '0 0 14px' }}>
        Base outfit — cosmetic only. Gear from gameplay overlays on top.
      </p>

      <SectionLabel>Top</SectionLabel>
      <MeshGrid items={TOPS} selected={config.clothing.top}
        onSelect={k => set('top', k)}
        renderItem={i => <span style={{ fontSize: 11, color: '#94a3b8' }}>{i.label}</span>}
      />

      <div style={{ height: 16 }} />

      <SectionLabel>Bottom</SectionLabel>
      <MeshGrid items={BOTTOMS} selected={config.clothing.bottom}
        onSelect={k => set('bottom', k)}
        renderItem={i => <span style={{ fontSize: 11, color: '#94a3b8' }}>{i.label}</span>}
      />

      <div style={{ height: 16 }} />

      <SectionLabel>Shoes</SectionLabel>
      <MeshGrid items={SHOES} selected={config.clothing.shoes}
        onSelect={k => set('shoes', k)}
        renderItem={i => <span style={{ fontSize: 11, color: '#94a3b8' }}>{i.label}</span>}
      />
    </div>
  );
}
