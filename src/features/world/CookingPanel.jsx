/**
 * CookingPanel — list of recipes. Craftable recipes are highlighted; others are
 * greyed out with their missing ingredients. Cook consumes inputs → adds output.
 */

import React from 'react';
import WorldModal from './ui/WorldModal.jsx';
import { ITEMS } from './game/items.js';
import { RECIPES, canCook } from './game/recipes.js';
import { FONT, primaryBtn, ghostBtn } from './ui/panelTheme.js';

export default function CookingPanel({ inv, onClose, onToast }) {
  const counts = inv.counts;

  const cook = (recipe) => {
    if (inv.cook(recipe.id)) {
      onToast?.(`You cook ${ITEMS[recipe.output.id]?.name ?? recipe.name}.`);
    }
  };

  return (
    <WorldModal title="Cooking" onClose={onClose} width={400}>
      <p style={{ color: '#94a3b8', fontSize: 12, margin: '0 0 12px', fontFamily: FONT }}>
        Combine gathered ingredients into food.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {RECIPES.map((recipe) => {
          const ok = canCook(recipe, counts);
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
                style={ok ? primaryBtn : { ...ghostBtn, cursor: 'not-allowed', opacity: 0.6 }}
                disabled={!ok}
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
