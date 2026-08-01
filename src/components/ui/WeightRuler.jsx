import React from 'react';
import { pctToSlider, sliderToPct } from '../../utils/units';
import { FG, FS } from '../../utils/tokens';

// ─── Weight-intensity drag ruler ───────────────────────────────────────────────
// The Forge Glass skin over the 50–200% Weight Intensity mechanic. Same math as
// the old range slider (pctToSlider/sliderToPct, non-linear above 100%); only
// the interaction changed: a native horizontal scroll strip whose scrollLeft IS
// the slider value — browser inertia for free, no pointer math, and no gesture
// fight with the sheet (scrolling is pan-x, not a drag we have to own).
//
// A visually-hidden-but-focusable range input mirrors the value so keyboard
// and assistive tech keep the exact affordance the old slider had; the strip
// is presentation.

const STOP_PX = 9; // px per slider unit (domain 0..100)
const SNAP = 5; // slider units per detent (matches the old slider's step)

function WeightRuler({ pct, onPctChange }) {
  const scrollRef = React.useRef(null);
  const settleTimer = React.useRef(null);
  const suppressUntil = React.useRef(0);
  const sv = pctToSlider(pct);

  const syncScroll = React.useCallback((value, smooth) => {
    const el = scrollRef.current;
    if (!el) return;
    suppressUntil.current = Date.now() + 260;
    const left = value * STOP_PX;
    if (smooth && el.scrollTo) el.scrollTo({ left, behavior: 'smooth' });
    else el.scrollLeft = left;
  }, []);

  // Keep the strip in sync when the pct changes from outside (ghost repeat,
  // carry-over) — and on mount.
  React.useEffect(() => {
    syncScroll(pctToSlider(pct), false);
  }, [pct, syncScroll]);

  const onScroll = () => {
    if (Date.now() < suppressUntil.current) return;
    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const el = scrollRef.current;
      if (!el) return;
      const raw = el.scrollLeft / STOP_PX;
      const snapped = Math.max(0, Math.min(100, Math.round(raw / SNAP) * SNAP));
      const newPct = sliderToPct(snapped);
      if (newPct !== pct) onPctChange(newPct);
      syncScroll(snapped, true);
    }, 90);
  };

  React.useEffect(() => () => clearTimeout(settleTimer.current), []);

  return (
    <div style={{ position: 'relative' }}>
      {/* Accessible twin — the real input for keyboard/AT. */}
      <input
        type={'range'}
        min={'0'}
        max={'100'}
        step={String(SNAP)}
        value={sv}
        aria-label={'Weight intensity'}
        onChange={e => onPctChange(sliderToPct(Number(e.target.value)))}
        className={'sf-ruler-a11y'}
      />
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className={'sf-ruler'}
        aria-hidden={'true'}
      >
        <div className={'sf-ruler-strip'} style={{ width: 100 * STOP_PX }} />
      </div>
      <div className={'sf-ruler-fade sf-ruler-fade--l'} aria-hidden={'true'} />
      <div className={'sf-ruler-fade sf-ruler-fade--r'} aria-hidden={'true'} />
      <div className={'sf-ruler-needle'} aria-hidden={'true'} />
      <div
        aria-hidden={'true'}
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          fontSize: FS.fs58,
          color: '#8a8478',
          marginTop: 2,
          fontFamily: FG.fontCond,
          letterSpacing: '.06em',
        }}
      >
        <span>{'50% Deload'}</span>
        <span>{'100% Normal'}</span>
        <span>{'200% Max'}</span>
      </div>
    </div>
  );
}

export default React.memo(WeightRuler);
