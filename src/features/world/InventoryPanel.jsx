/**
 * InventoryPanel — grid of held items + equipped slots.
 * Click consumables to eat; click weapons/armor to equip.
 */

import React from 'react';
import WorldModal from './ui/WorldModal.jsx';
import { ITEMS } from './content/index';
import { formatCopper } from './content/formulas/prices';
import { FONT, ghostBtn } from './ui/panelTheme.js';

const SLOT_COUNT = 24;

const EQUIP_SLOTS = [
  { slot: 'mainHand', label: 'Main hand' },
  { slot: 'chest',    label: 'Chest' },
  { slot: 'hands',    label: 'Hands' },
  { slot: 'feet',     label: 'Feet' },
  { slot: 'legs',     label: 'Legs' },
  { slot: 'head',     label: 'Head' },
];

function isEdible(item) {
  return item && (item.type === 'consumable' || item.type === 'food') && (item.heal ?? 0) > 0;
}

function isEquippable(item) {
  return item && (item.type === 'weapon' || item.type === 'armor') && item.slot;
}

export default function InventoryPanel({ inv, onClose, onToast }) {
  const owned = Object.entries(inv.counts).filter(([, n]) => n > 0);
  const slots = [...owned];
  while (slots.length < SLOT_COUNT) slots.push(null);
  const copperLabel = formatCopper(inv.copper);
  const equipped = inv.equipped ?? {};

  const eat = (id) => {
    const item = ITEMS[id];
    if (!isEdible(item)) return;
    const heal = inv.eat(id);
    if (heal > 0) onToast?.(`You eat the ${item.name}. (+${heal} HP)`);
    else if ((inv.counts[id] ?? 0) > 0) onToast?.(`You eat the ${item.name}.`);
  };

  const equip = (id) => {
    const item = ITEMS[id];
    if (!isEquippable(item)) return;
    if (inv.equip?.(id)) onToast?.(`Equipped ${item.name}.`);
  };

  const unequip = (slot) => {
    const itemId = equipped[slot];
    const item = ITEMS[itemId];
    if (!item || !inv.unequip?.(slot)) return;
    onToast?.(`Unequipped ${item.name}.`);
  };

  const handleItemClick = (id, item) => {
    if (isEdible(item)) eat(id);
    else if (isEquippable(item)) equip(id);
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

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6, fontFamily: FONT }}>
          Equipped
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {EQUIP_SLOTS.map(({ slot, label }) => {
            const itemId = equipped[slot];
            const item = itemId ? ITEMS[itemId] : null;
            return (
              <button
                key={slot}
                style={{
                  ...equipSlotBtn,
                  border: item
                    ? '1px solid rgba(240,208,96,0.45)'
                    : '1px dashed rgba(148,163,184,0.22)',
                  cursor: item ? 'pointer' : 'default',
                  opacity: item ? 1 : 0.75,
                }}
                title={item ? `${item.name} — click to unequip` : label}
                onClick={item ? () => unequip(slot) : undefined}
              >
                <span style={{ fontSize: 18, lineHeight: 1 }}>{item?.icon ?? '—'}</span>
                <span style={equipSlotLabel}>{label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {owned.length === 0 && Object.keys(equipped).length === 0 && (
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
          const equippable = isEquippable(item);
          const clickable = edible || equippable;
          const hint = edible
            ? `${item.name} — click to eat (+${item.heal} HP)`
            : equippable
              ? `${item.name} — click to equip`
              : item.name;
          return (
            <button
              key={i}
              style={{ ...filledSlot, cursor: clickable ? 'pointer' : 'default' }}
              title={hint}
              onClick={clickable ? () => handleItemClick(id, item) : undefined}
            >
              <span style={{ fontSize: 22, lineHeight: 1 }}>{item.icon}</span>
              <span style={countBadge}>{count}</span>
            </button>
          );
        })}
      </div>
      <p style={{ color: '#64748b', fontSize: 11, margin: '14px 0 0', fontFamily: FONT }}>
        Tip: cook ingredients at the Cooking station (C) near a campfire. Gear leaves your bag while equipped.
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

const equipSlotBtn = {
  ...ghostBtn,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 2,
  minHeight: 52,
  padding: '6px 4px',
  background: 'rgba(20, 27, 41, 0.85)',
};

const equipSlotLabel = {
  fontSize: 9,
  color: '#94a3b8',
  fontFamily: FONT,
  lineHeight: 1.1,
  textAlign: 'center',
};
