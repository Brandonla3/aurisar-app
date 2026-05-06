/**
 * WorldOverlay — full-screen overlay that wraps the game.
 *
 * Sits above the Aurisar app via position:fixed.
 * ESC key exits back to the app.
 * Passes Aurisar profile data into WorldGame as playerInfo.
 */

import React, { useEffect } from 'react';
import WorldGame from './WorldGame.jsx';

// Map Aurisar internal class names to game class keys
function toGameClass(aurisarClass) {
  if (!aurisarClass) return 'warrior';
  const c = aurisarClass.toLowerCase();
  if (c.includes('mage')   || c.includes('wizard')  || c.includes('sorcerer')) return 'mage';
  if (c.includes('archer') || c.includes('ranger')  || c.includes('hunter'))   return 'archer';
  if (c.includes('rogue')  || c.includes('assassin')|| c.includes('thief'))    return 'rogue';
  return 'warrior'; // default
}

// Map Aurisar class to avatar color for the placeholder renderer
function toAvatarColor(aurisarClass) {
  const map = {
    warrior: '#ef4444',
    mage:    '#8b5cf6',
    archer:  '#22c55e',
    rogue:   '#f59e0b',
  };
  return map[toGameClass(aurisarClass)] ?? '#60a5fa';
}

/**
 * @param {function} onClose       - called when user exits the world
 * @param {string}   username      - from Aurisar profile
 * @param {string}   aurisarClass  - Aurisar class name (mapped to game class internally)
 */
export default function WorldOverlay({ onClose, username, aurisarClass }) {
  // ── ESC to exit ──
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const playerInfo = {
    username:    username    ?? 'Adventurer',
    classType:   toGameClass(aurisarClass),
    avatarColor: toAvatarColor(aurisarClass),
  };

  return (
    <div
      style={{
        position:   'fixed',
        inset:      0,
        zIndex:     9999,
        background: '#000',
        display:    'flex',
        flexDirection: 'column',
      }}
    >
      {/* Top bar */}
      <div style={{
        display:        'flex',
        alignItems:     'center',
        justifyContent: 'space-between',
        padding:        '0 16px',
        height:         40,
        background:     '#0f172a',
        borderBottom:   '1px solid #1e293b',
        flexShrink:     0,
        fontFamily:     'Inter, system-ui, sans-serif',
        userSelect:     'none',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Aurisar flame logo placeholder */}
          <span style={{ fontSize: 18 }}>🔥</span>
          <span style={{ color: '#e2e8f0', fontSize: 13, fontWeight: 600 }}>
            Aurisar World
          </span>
          <span style={{
            color:        '#64748b',
            fontSize:     11,
            background:   '#1e293b',
            padding:      '2px 8px',
            borderRadius: 10,
          }}>
            2D Preview
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ color: '#64748b', fontSize: 11 }}>
            Playing as <span style={{ color: '#94a3b8' }}>{playerInfo.username}</span>
            {' · '}
            <span style={{
              color: { warrior:'#ef4444', mage:'#8b5cf6', archer:'#22c55e', rogue:'#f59e0b' }[playerInfo.classType] ?? '#94a3b8'
            }}>
              {playerInfo.classType}
            </span>
          </span>

          <button
            onClick={onClose}
            title="Exit world (ESC)"
            style={{
              background:   'transparent',
              border:       '1px solid #334155',
              color:        '#94a3b8',
              borderRadius: 6,
              padding:      '4px 12px',
              cursor:       'pointer',
              fontSize:     12,
              fontFamily:   'Inter, system-ui, sans-serif',
              display:      'flex',
              alignItems:   'center',
              gap:           6,
            }}
          >
            <span>Exit</span>
            <span style={{ opacity: 0.5, fontSize: 10 }}>ESC</span>
          </button>
        </div>
      </div>

      {/* Game canvas fills remaining space */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <WorldGame playerInfo={playerInfo} />
      </div>
    </div>
  );
}
