/**
 * WorldOverlay — full-screen world wrapper.
 *
 * Covers the full viewport (position:fixed) on both desktop and mobile.
 * Exit: floating button (top-right) + ESC key on desktop.
 */

import React, { useEffect } from 'react';
import WorldGame from './WorldGame.jsx';

function toGameClass(aurisarClass) {
  if (!aurisarClass) return 'warrior';
  const c = aurisarClass.toLowerCase();
  if (c.includes('mage')   || c.includes('wizard')  || c.includes('sorcerer')) return 'mage';
  if (c.includes('archer') || c.includes('ranger')  || c.includes('hunter'))   return 'archer';
  if (c.includes('rogue')  || c.includes('assassin')|| c.includes('thief'))    return 'rogue';
  return 'warrior';
}

function toAvatarColor(aurisarClass) {
  const map = { warrior:'#ef4444', mage:'#8b5cf6', archer:'#22c55e', rogue:'#f59e0b' };
  return map[toGameClass(aurisarClass)] ?? '#60a5fa';
}

/**
 * @param {function} onClose
 * @param {string}   username
 * @param {string}   aurisarClass
 * @param {object}   avatarConfig
 */
export default function WorldOverlay({ onClose, username, aurisarClass, avatarConfig = null }) {
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const playerInfo = {
    username:     username    ?? 'Adventurer',
    classType:    toGameClass(aurisarClass),
    avatarColor:  toAvatarColor(aurisarClass),
    avatarConfig: avatarConfig ?? null,
  };

  const classColor = {
    warrior: '#ef4444', mage: '#8b5cf6', archer: '#22c55e', rogue: '#f59e0b',
  }[playerInfo.classType] ?? '#94a3b8';

  return (
    <div
      style={{
        position:   'fixed',
        inset:      0,
        zIndex:     9999,
        background: '#000',
        // Respect notch / home-bar on iOS
        paddingTop:    'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        paddingLeft:   'env(safe-area-inset-left, 0px)',
        paddingRight:  'env(safe-area-inset-right, 0px)',
      }}
    >
      {/* Game fills the whole overlay */}
      <div style={{ position: 'absolute', inset: 0 }}>
        <WorldGame playerInfo={playerInfo} />
      </div>

      {/* Floating exit button — top-right, always on top of the canvas */}
      <button
        onClick={onClose}
        aria-label="Exit world"
        style={{
          position:     'fixed',
          top:          'calc(env(safe-area-inset-top, 0px) + 12px)',
          right:        'calc(env(safe-area-inset-right, 0px) + 12px)',
          zIndex:       10000,
          display:      'flex',
          alignItems:   'center',
          gap:          6,
          background:   'rgba(15, 23, 42, 0.82)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          border:       '1px solid rgba(148,163,184,0.25)',
          borderRadius: 24,
          color:        '#e2e8f0',
          fontFamily:   'Inter, system-ui, sans-serif',
          fontSize:     13,
          fontWeight:   600,
          // Minimum 44px touch target
          minHeight:    44,
          padding:      '0 16px',
          cursor:       'pointer',
          userSelect:   'none',
          WebkitTapHighlightColor: 'transparent',
        }}
      >
        {/* Coloured class dot */}
        <span style={{
          width: 8, height: 8, borderRadius: '50%',
          background: classColor, flexShrink: 0,
          boxShadow: `0 0 6px ${classColor}99`,
        }} />
        <span style={{ color: '#94a3b8', fontWeight: 400, fontSize: 12 }}>
          {playerInfo.username}
        </span>
        <span style={{
          width: 1, height: 14,
          background: 'rgba(148,163,184,0.25)',
          flexShrink: 0,
        }} />
        <span>Exit</span>
      </button>
    </div>
  );
}
