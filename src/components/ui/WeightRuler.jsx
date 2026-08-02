import React from 'react';
import { pctToSlider, sliderToPct } from '../../utils/units';
import { FG, FS } from '../../utils/tokens';

// ─── Weight-intensity wheel ────────────────────────────────────────────────────
// The Forge Glass skin over the 50–200% Weight Intensity mechanic. Same math as
// the old range slider (pctToSlider/sliderToPct, non-linear above 100%); the
// interaction is a native horizontal scroll strip read CONTINUOUSLY — the value
// live-updates while the wheel spins (momentum included), nothing snaps back.
//
// A plain tap on the strip nudges the weight one plate-step (±2.5 lbs /
// ±1.25 kg) via onTapStep: left of the needle steps down, right steps up.
//
// A visually-hidden-but-focusable range input mirrors the value so keyboard
// and assistive tech keep the exact affordance the old slider had; the strip
// is presentation.

const STOP_PX = 9; // px per slider unit (domain 0..100)
const TAP_SLOP_PX = 7; // movement beyond this is a scroll, not a tap
const TAP_MAX_MS = 350;

function WeightRuler({ pct, onPctChange, onTapStep, stepLabel }) {
  const scrollRef = React.useRef(null);
  const lastUserScrollAt = React.useRef(0);
  const suppressUntil = React.useRef(0);
  // onScroll compares against the latest committed pct without re-binding the
  // handler; the ref is only ever read in event handlers.
  const pctRef = React.useRef(pct);
  React.useEffect(() => {
    pctRef.current = pct;
  }, [pct]);
  const tapStart = React.useRef(null);

  const syncScroll = React.useCallback(value => {
    const el = scrollRef.current;
    if (!el) return;
    suppressUntil.current = Date.now() + 160;
    el.scrollLeft = value * STOP_PX;
  }, []);

  // Follow EXTERNAL pct changes (ghost repeat, carry-over, mount) — never
  // fight a live spin: skip while the user scrolled within the last 400ms,
  // and skip when the strip already sits on the value.
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (Date.now() - lastUserScrollAt.current < 400) return;
    const target = pctToSlider(pct);
    const current = el.scrollLeft / STOP_PX;
    if (Math.abs(current - target) > 0.5) syncScroll(target);
  }, [pct, syncScroll]);

  // Continuous read — scroll events are already frame-paced by the browser
  // and the math is trivial, so no extra throttle: the value tracks the strip
  // live while it spins, momentum included.
  const onScroll = () => {
    if (Date.now() < suppressUntil.current) return;
    lastUserScrollAt.current = Date.now();
    const el = scrollRef.current;
    if (!el) return;
    const sv = Math.max(0, Math.min(100, el.scrollLeft / STOP_PX));
    const newPct = Math.round(sliderToPct(sv));
    if (newPct !== pctRef.current) onPctChange(newPct);
  };

  const onPointerDown = e => {
    tapStart.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  };
  const onPointerUp = e => {
    const s = tapStart.current;
    tapStart.current = null;
    if (!s || !onTapStep) return;
    if (Date.now() - s.t > TAP_MAX_MS) return;
    if (Math.abs(e.clientX - s.x) > TAP_SLOP_PX || Math.abs(e.clientY - s.y) > TAP_SLOP_PX) return;
    const rect = scrollRef.current ? scrollRef.current.getBoundingClientRect() : null;
    if (!rect) return;
    onTapStep(e.clientX >= rect.left + rect.width / 2 ? 1 : -1);
  };

  return (
    <div style={{ position: 'relative' }}>
      {/* Accessible twin — the real input for keyboard/AT. */}
      <input
        type={'range'}
        min={'0'}
        max={'100'}
        step={'1'}
        value={pctToSlider(pct)}
        aria-label={'Weight intensity'}
        // The 0-100 slider domain is a non-linear remap (pctToSlider), so its
        // raw value doesn't match what's shown — at the visually-displayed
        // 100%, the underlying value is 50, and AT would announce "50 of
        // 100" instead of the real percentage.
        aria-valuetext={`${pct}%`}
        onChange={e => onPctChange(sliderToPct(Number(e.target.value)))}
        className={'sf-ruler-a11y'}
      />
      <div
        ref={scrollRef}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
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
      {onTapStep && (
        <div
          aria-hidden={'true'}
          style={{
            textAlign: 'center',
            fontSize: FS.fs48,
            letterSpacing: '.16em',
            textTransform: 'uppercase',
            color: 'rgba(228,222,211,.32)',
            marginTop: 2,
            fontFamily: FG.fontCond,
          }}
        >
          {`spin to scale · tap sides to nudge ${stepLabel || '±2.5 lbs'}`}
        </div>
      )}
    </div>
  );
}

export default React.memo(WeightRuler);
