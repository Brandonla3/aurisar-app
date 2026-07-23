/**
 * WorldOverlay — full-screen world wrapper.
 *
 * Covers the full viewport (position:fixed) on both desktop and mobile.
 * Exit: "Exit World" button in the in-game Settings menu + ESC key on desktop.
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
export default function WorldOverlay({ onClose, username, aurisarClass, avatarConfig = null, fitnessXp = 0, fitnessXpBaseline = 0 }) {
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
    fitnessXp:    fitnessXp ?? 0,
    fitnessXpBaseline: fitnessXpBaseline ?? 0,
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0, right: 0, bottom: 0, left: 0,
        zIndex:   9999,
        background: '#000',
        display: 'flex',
        // Respect notch / home-bar on iOS. The game wrapper below is in-flow
        // (flex child) so this padding actually shrinks it — an absolutely
        // positioned inset:0 child would fill the padding box and make these
        // insets a no-op, leaving the HUD controls at the raw screen edges.
        paddingTop:    'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        paddingLeft:   'env(safe-area-inset-left, 0px)',
        paddingRight:  'env(safe-area-inset-right, 0px)',
      }}
    >
      {/* Game fills the safe area; its HUD (WorldGame root is position:relative,
          width/height 100%) is inset with it. */}
      <div style={{ position: 'relative', flex: 1, minWidth: 0, minHeight: 0 }}>
        <WorldGame playerInfo={playerInfo} onExit={onClose} />
      </div>
    </div>
  );
}
