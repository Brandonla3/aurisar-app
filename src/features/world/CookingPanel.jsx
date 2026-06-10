/**
 * CookingPanel — list of recipes. Craftable recipes are highlighted; others are
 * greyed out with their missing ingredients. Cook consumes inputs → adds output.
 */

import React, { useEffect, useState } from 'react';
import WorldModal from './ui/WorldModal.jsx';
import { ITEMS } from './game/items.js';
import { RECIPES, canCook } from './game/recipes.js';
import { FONT, primaryBtn, ghostBtn } from './ui/panelTheme.js';

// Cooking requires standing near a lit campfire. A campfire only exists in the
// scene while it is burning, so proximity to any tracked campfire is enough.
const NEAR_FIRE_RADIUS = 4.5;

export default function CookingPanel({ inv, sceneRef, onClose, onToast }) {
  const counts = inv.counts;
  const [nearFire, setNearFire] = useState(false);

  // Poll the live scene for a nearby lit campfire. Cheap (a handful of fires,
  // a few times a second) and avoids threading per-frame state through React.
  useEffect(() => {
    const check = () => {
      const scene = sceneRef?.current;
      const pose = scene?.getPose?.();
      const fires = scene?.getCampfires?.() ?? [];
      if (!pose) { setNearFire(false); return; }
      const near = fires.some((f) => {
        const dx = f.x - pose.x, dz = f.z - pose.z;
        return dx * dx + dz * dz <= NEAR_FIRE_RADIUS * NEAR_FIRE_RADIUS;
      });
      setNearFire(near);
    };
    check();
    const id = setInterval(check, 400);
    return () => clearInterval(id);
  }, [sceneRef]);

  const cook = (recipe) => {
    if (!nearFire) return;
    if (inv.cook(recipe.id, { nearFire })) {
      onToast?.(`You cook ${ITEMS[recipe.output.id]?.name ?? recipe.name}.`);
    }
  };

  return (
    <WorldModal title="Cooking" onClose={onClose} width={400}>
      <p style={{ color: '#94a3b8', fontSize: 12, margin: '0 0 12px', fontFamily: FONT }}>
        Combine gathered ingredients into food.
      </p>
      {!nearFire && (
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '9px 12px', marginBottom: 12, borderRadius: 10,
            background: 'rgba(120, 53, 15, 0.35)',
            border: '1px solid rgba(240, 138, 60, 0.45)',
            color: '#fbbf77', fontSize: 12, fontFamily: FONT,
          }}
        >
          <span style={{ fontSize: 18 }}>🔥</span>
          Stand near a lit campfire to cook. Build one with the Fire button or the F key.
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {RECIPES.map((recipe) => {
          const ok = canCook(recipe, counts);
          const canCookNow = ok && nearFire;
          const out = ITEMS[recipe.output.id];
          return (
            <div
              key={recipe.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 12px', borderRadius: 10,
                background: ok ? 'rgba(30, 41, 59, 0.95)' : 'rgba(20, 27, 41, 0.7)',
                border: `1px solid ${ok ? 'rgba(240,208,96,0.35)' : 'rgba(148,163,184,0.18)'}`,
                opacity: ok ? 1 : 0.65,
              }}
            >
              <span style={{ fontSize: 26 }}>{out?.icon ?? '🍳'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0' }}>
                  {recipe.name}
                  {out?.heal ? <span style={{ color: '#7ee787', fontSize: 11, fontWeight: 600 }}> · +{out.heal} HP</span> : null}
                </div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 3 }}>
                  {recipe.inputs.map((inp) => {
                    const have = counts[inp.id] ?? 0;
                    const enough = have >= inp.qty;
                    const item = ITEMS[inp.id];
                    return (
                      <span key={inp.id} style={{ color: enough ? '#cbd5e1' : '#f87171', marginRight: 10 }}>
                        {item?.icon} {item?.name ?? inp.id} {have}/{inp.qty}
                      </span>
                    );
                  })}
                </div>
              </div>
              <button
                style={canCookNow ? primaryBtn : { ...ghostBtn, cursor: 'not-allowed', opacity: 0.6 }}
                disabled={!canCookNow}
                onClick={() => cook(recipe)}
              >
                Cook
              </button>
            </div>
          );
        })}
      </div>
      <p style={{ color: '#64748b', fontSize: 11, margin: '14px 0 0', fontFamily: FONT }}>
        Eating restores HP once server healing is enabled — for now it's a taste of things to come.
      </p>
    </WorldModal>
  );
}
