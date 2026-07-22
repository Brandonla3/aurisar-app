import React, { memo } from 'react';
import { createPortal } from 'react-dom';
import { ExIcon } from './ExIcon';
import { getMuscleColor } from '../utils/xp';
import { S, R, FS } from '../utils/tokens';

/**
 * The staging tray — the cart's one visible home.
 *
 * Mounted once at the App root so a selection made in the library is still
 * there after a trip to Calendar, and still there tomorrow. Collapsed it is a
 * single bar with a count; expanded it lists what you have picked, lets you
 * reorder and drop entries, and offers the three destinations that used to be
 * a separate action bar in each list.
 *
 * Hidden entirely when the cart is empty — a persistent empty bar would just
 * be permanent furniture eating thumb space at the bottom of every screen.
 */

const StagingTray = memo(function StagingTray({
  cartIds,
  allExById,
  isCartRoute,
  cartOpen, setCartOpen,
  removeFromCart, clearCart, moveInCart,
  onForgeWorkout,
  onAddToExisting,
  onForgePlan,
}) {
  if (!cartIds.length || !isCartRoute) return null;

  const exercises = cartIds.map(id => allExById[id]).filter(Boolean);

  return createPortal(
    <div className={`cart-tray${cartOpen ? " cart-tray-open" : ""}`} role="region" aria-label="Staged exercises">
      <button
        type="button"
        className={"cart-tray-bar"}
        aria-expanded={cartOpen}
        onClick={() => setCartOpen(o => !o)}
      >
        <span className={"cart-tray-count"} aria-hidden="true">{cartIds.length}</span>
        <span className={"cart-tray-label"}>
          {cartIds.length === 1 ? "1 exercise staged" : `${cartIds.length} exercises staged`}
        </span>
        <span className={"cart-tray-chevron"} aria-hidden="true">{cartOpen ? "▾" : "▴"}</span>
      </button>

      {cartOpen && <div className={"cart-tray-body"}>
        <ul className={"cart-tray-list"}>
          {exercises.map((ex, i) => {
            const mg = getMuscleColor(ex.muscleGroup);
            return (
              <li key={ex.id} className={"cart-tray-item"} style={{ "--mg-color": mg }}>
                <span className={"cart-tray-idx"} aria-hidden="true">{i + 1}</span>
                <span className={"cart-tray-orb"}><ExIcon ex={ex} size={"0.85rem"} color={mg} /></span>
                <span className={"cart-tray-name"}>{ex.name}</span>
                <span className={"cart-tray-actions"}>
                  <button type="button" onClick={() => moveInCart(ex.id, -1)} disabled={i === 0} aria-label={`Move ${ex.name} earlier`}>{"↑"}</button>
                  <button type="button" onClick={() => moveInCart(ex.id, 1)} disabled={i === exercises.length - 1} aria-label={`Move ${ex.name} later`}>{"↓"}</button>
                  <button type="button" onClick={() => removeFromCart(ex.id)} aria-label={`Remove ${ex.name}`}>{"✕"}</button>
                </span>
              </li>
            );
          })}
        </ul>

        <div className={"cart-tray-forge"}>
          <button type="button" className={"cart-forge-btn cart-forge-primary"} onClick={onForgeWorkout}>{"⚒ New Workout"}</button>
          <button type="button" className={"cart-forge-btn"} onClick={onAddToExisting}>{"➕ Existing"}</button>
          <button type="button" className={"cart-forge-btn"} onClick={onForgePlan}>{"📋 Plan"}</button>
        </div>
        <button type="button" className={"cart-tray-clear"} onClick={clearCart}>{"Clear staging"}</button>
      </div>}
    </div>,
    document.body
  );
});

export default StagingTray;
