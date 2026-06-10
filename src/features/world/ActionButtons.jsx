/**
 * ActionButtons — right-edge vertical cluster of round action buttons
 * (Map / Inventory / Cooking / Menu). Rendered on all devices; visibility is
 * controlled by the caller (Menu toggle). Placement clears the left-half
 * joystick, the top-right Exit button, and the bottom-left chat button.
 */

import React from 'react';
import { FONT } from './ui/panelTheme.js';

const btn = {
  width: 52, height: 52, minWidth: 52,
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
  gap: 1,
  background: 'rgba(15, 23, 42, 0.78)',
  backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
  border: '1px solid rgba(148, 163, 184, 0.25)',
  borderRadius: 14, color: '#e2e8f0',
  cursor: 'pointer', fontFamily: FONT,
  WebkitTapHighlightColor: 'transparent', userSelect: 'none',
};
const label = { fontSize: 9, fontWeight: 600, color: '#94a3b8', letterSpacing: '0.02em' };

export default function ActionButtons({ onMap, onInventory, onCooking, onCampfire, onMenu }) {
  return (
    <div
      style={{
        position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
        zIndex: 15, display: 'flex', flexDirection: 'column', gap: 10,
      }}
    >
      <button style={btn} onClick={onMap} aria-label="World map">
        <span style={{ fontSize: 22 }}>🗺</span><span style={label}>Map</span>
      </button>
      <button style={btn} onClick={onInventory} aria-label="Inventory">
        <span style={{ fontSize: 22 }}>🎒</span><span style={label}>Bag</span>
      </button>
      <button style={btn} onClick={onCooking} aria-label="Cooking">
        <span style={{ fontSize: 22 }}>🍳</span><span style={label}>Cook</span>
      </button>
      <button style={btn} onClick={onCampfire} aria-label="Build campfire">
        <span style={{ fontSize: 22 }}>🔥</span><span style={label}>Fire</span>
      </button>
      <button style={btn} onClick={onMenu} aria-label="Menu">
        <span style={{ fontSize: 22 }}>☰</span><span style={label}>Menu</span>
      </button>
    </div>
  );
}
