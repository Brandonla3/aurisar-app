/**
 * InventoryPanel — grid of held items. Click a consumable to eat (server heal).
 */

import React from 'react';
import WorldModal from './ui/WorldModal.jsx';
import { ITEMS } from './content/index';
import { formatCopper } from './hooks/useServerInventory.js';
import { FONT } from './ui/panelTheme.js';

const SLOT_COUNT = 24;

function isEdible(item) {
  return item && (item.type === 'consumable' || item.type === 'food') && (item.heal ?? 0) > 0;
}

export default function InventoryPanel({ inv, onClose, onToast }) {
  const owned = Object.entries(inv.counts).filter(([, n]) => n > 0);
  const slots = [...owned];
  while (slots.length < SLOT_COUNT) slots.push(null);
  const copperLabel = formatCopper(inv.copper);

  const eat = (id) => {
    const item = ITEMS[id];
    if (!isEdible(item)) return;
    const heal = inv.eat(id);
    if (heal > 0) onToast?.(`You eat the ${item.name}. (+${heal} HP)`);
    else if ((inv.counts[id] ?? 0) > 0) onToast?.(`You eat the ${item.name}.`);
  };

  return (
    <WorldModal title="Inventory" onClose={onClose} width={360}>
      <div
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          marginBottom: 10, fontFamily: FONT, fontSize: 13, color: '#f0d060',
        }}
      >
        <span>Copper</span>
        <span style={{ fontWeight: 700 }}>{copperLabel} 🪙</span>
      </div>
      {owned.length === 0 && (
        <p style={{ color: '#94a3b8', fontSize: 13, margin: '4px 0 12px' }}>
          Your pack is empty. Slay creatures for loot or walk onto chests to gather items.
        </p>
      )}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(6, 1fr)',
          gap: 8,
        }}
      >
        {slots.map((entry, i) => {
          if (!entry) {
            return (
              <div key={i} style={emptySlot} />
            );
          }
          const [id, count] = entry;
          const item = ITEMS[id];
          if (!item) return <div key={i} style={emptySlot} />;
          const edible = isEdible(item);
          return (
            <button
              key={i}
              style={{ ...filledSlot, cursor: edible ? 'pointer' : 'default' }}
              title={edible ? `${item.name} — click to eat (+${item.heal} HP)` : item.name}
              onClick={edible ? () => eat(id) : undefined}
            >
              <span style={{ fontSize: 22, lineHeight: 1 }}>{item.icon}</span>
              <span style={countBadge}>{count}</span>
            </button>
          );
        })}
      </div>
      <p style={{ color: '#64748b', fontSize: 11, margin: '14px 0 0', fontFamily: FONT }}>
        Tip: cook ingredients at the Cooking station (C) near a campfire.
      </p>
    </WorldModal>
  );
}

const slotBase = {
  position: 'relative',
  aspectRatio: '1 / 1',
  borderRadius: 8,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

const emptySlot = {
  ...slotBase,
  background: 'rgba(2, 6, 14, 0.4)',
  border: '1px dashed rgba(148, 163, 184, 0.18)',
};

const filledSlot = {
  ...slotBase,
  background: 'rgba(30, 41, 59, 0.95)',
  border: '1px solid rgba(148, 163, 184, 0.3)',
  padding: 0,
  WebkitTapHighlightColor: 'transparent',
};

const countBadge = {
  position: 'absolute', bottom: 2, right: 4,
  fontSize: 10, fontWeight: 700, color: '#f0d060',
  textShadow: '0 1px 2px rgba(0,0,0,0.8)',
  fontFamily: FONT,
};
