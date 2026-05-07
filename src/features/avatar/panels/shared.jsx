/**
 * Shared UI primitives used across avatar creator panels.
 */
import React from 'react';

export function SliderRow({ label, value, onChange, min = 0, max = 1, step = 0.01 }) {
  return (
    <div style={SR.row}>
      <span style={SR.label}>{label}</span>
      <input
        type="range" min={min} max={max} step={step}
        value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={SR.slider}
      />
      <span style={SR.val}>{Math.round(value * 100)}</span>
    </div>
  );
}

export function ColorSwatch({ color, selected, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        ...SW.swatch,
        background:  color,
        outline:     selected ? `2px solid #7dd3fc` : '2px solid transparent',
        outlineOffset: 2,
      }}
    />
  );
}

export function MeshGrid({ items, selected, onSelect, renderItem }) {
  return (
    <div style={MG.grid}>
      {items.map(item => (
        <button
          key={item.key}
          onClick={() => onSelect(item.key)}
          style={{
            ...MG.cell,
            background: selected === item.key ? '#1e3a5f' : '#1e293b',
            border:     selected === item.key ? '1px solid #7dd3fc' : '1px solid #334155',
          }}
        >
          {renderItem ? renderItem(item) : (
            <span style={{ fontSize: 11, color: '#94a3b8' }}>{item.label}</span>
          )}
        </button>
      ))}
    </div>
  );
}

export function SectionLabel({ children }) {
  return <div style={{ color: '#475569', fontSize: 10, fontWeight: 600,
    letterSpacing: '0.08em', textTransform: 'uppercase',
    marginBottom: 8, marginTop: 4 }}>{children}</div>;
}

// ── Styles ──────────────────────────────────────────────────────────────────

const SR = {
  row:    { display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 },
  label:  { color: '#94a3b8', fontSize: 12, width: 90, flexShrink: 0 },
  slider: { flex: 1, accentColor: '#3b82f6', cursor: 'pointer' },
  val:    { color: '#64748b', fontSize: 11, width: 28, textAlign: 'right' },
};

const SW = {
  swatch: {
    width: 28, height: 28, borderRadius: '50%',
    cursor: 'pointer', border: 'none', padding: 0, flexShrink: 0,
  },
};

const MG = {
  grid: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 },
  cell: {
    borderRadius: 8, padding: '10px 6px', cursor: 'pointer',
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    minHeight: 56, fontFamily: 'Inter, system-ui, sans-serif',
  },
};
