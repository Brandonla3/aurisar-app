import React, { memo, useState } from 'react';
import { S, FS } from '../../utils/tokens';

/**
 * Fog-of-war anatomy map.
 *
 * The same training-heat data the torch strip reads, drawn on a body instead
 * of a row: regions you have never trained sit under fog, recent work burns
 * in torchlight, and staleness dims it back down. "What should I train
 * today?" becomes something you read at a glance rather than reconstruct from
 * memory.
 *
 * The figure is deliberately stylised — interlocking plates rather than an
 * anatomical illustration. A clinical muscle diagram would fight the game's
 * art direction, and fine anatomical detail is unreadable at 375px anyway.
 * It echoes the armour vocabulary already in the muscle icons
 * (chest-armor, shoulder-armor, leg-armor).
 *
 * Ships as an opt-in view: the tile grid stays the default, and the torch
 * strip remains the accessible linear reading of the same numbers. Every
 * region is a real <button>, so the map is operable by keyboard too.
 */

// Region geometry per view. Each entry is [x, y, width, height, radius] —
// rounded plates, mirrored left/right where the muscle is paired.
const FRONT = [
  { mg: 'shoulder', parts: [[46, 92, 34, 30, 13], [140, 92, 34, 30, 13]] },
  { mg: 'chest',    parts: [[82, 96, 26, 34, 8], [112, 96, 26, 34, 8]] },
  { mg: 'bicep',    parts: [[42, 128, 28, 44, 12], [150, 128, 28, 44, 12]] },
  { mg: 'abs',      parts: [[88, 136, 44, 56, 9]] },
  { mg: 'forearm',  parts: [[36, 178, 26, 46, 11], [158, 178, 26, 46, 11]] },
  { mg: 'legs',     parts: [[76, 208, 32, 82, 14], [112, 208, 32, 82, 14]] },
  { mg: 'calves',   parts: [[80, 298, 26, 56, 12], [114, 298, 26, 56, 12]] },
];

const BACK = [
  { mg: 'shoulder', parts: [[46, 92, 34, 30, 13], [140, 92, 34, 30, 13]] },
  { mg: 'back',     parts: [[82, 96, 56, 62, 10]] },
  { mg: 'tricep',   parts: [[42, 128, 28, 44, 12], [150, 128, 28, 44, 12]] },
  { mg: 'forearm',  parts: [[36, 178, 26, 46, 11], [158, 178, 26, 46, 11]] },
  { mg: 'glutes',   parts: [[80, 168, 60, 34, 13]] },
  { mg: 'legs',     parts: [[76, 208, 32, 82, 14], [112, 208, 32, 82, 14]] },
  { mg: 'calves',   parts: [[80, 298, 26, 56, 12], [114, 298, 26, 56, 12]] },
];

const WHEN = d =>
  d == null ? 'never trained'
  : d === 0 ? 'trained today'
  : d === 1 ? 'trained yesterday'
  : `last trained ${d} days ago`;

// Groups that exist in the data but have no place on a body — cardio today.
// Rendered as chips below the figure so switching to the map never costs you
// a route the strip offers, and so a new group added without a region degrades
// to a chip instead of vanishing.
const MAPPED = new Set([...FRONT, ...BACK].map(r => r.mg));

const MuscleMap = memo(function MuscleMap({ data, onPick }) {
  const [view, setView] = useState('front');
  const regions = view === 'front' ? FRONT : BACK;
  const byMg = new Map((data || []).map(d => [d.mg, d]));
  const offBody = (data || []).filter(d => !MAPPED.has(d.mg));

  return (
    <div className={"lib-home-section"} style={{ marginBottom: S.s4 }}>
      <div className={"lib-section-hdr"} style={{ display: "flex", alignItems: "center" }}>
        <span className={"lib-hdr-icon"}>{"🗺️"}</span>{"Body Map"}
        <div className={"mm-viewtoggle"} role="group" aria-label="Body view">
          {['front', 'back'].map(v => (
            <button
              key={v}
              type="button"
              className={view === v ? "on" : undefined}
              aria-pressed={view === v}
              onClick={() => setView(v)}
            >{v === 'front' ? 'Front' : 'Back'}</button>
          ))}
        </div>
      </div>

      <div className={"mm-wrap"}>
        <svg className={"mm-svg"} viewBox="0 0 220 372" role="group" aria-label={`${view} body map`}>
          <defs>
            {/* Fog over untrained regions — a soft, drifting veil rather than
                a flat grey, so "unknown" reads as atmosphere not as disabled. */}
            <filter id="mm-fog" x="-30%" y="-30%" width="160%" height="160%">
              <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="3" seed="7" />
              <feDisplacementMap in="SourceGraphic" scale="7" />
              <feGaussianBlur stdDeviation="1.6" />
            </filter>
          </defs>

          {/* Silhouette — inert scaffolding the plates sit on. */}
          <g className={"mm-frame"} aria-hidden="true">
            <ellipse cx="110" cy="52" rx="23" ry="27" />
            <rect x="100" y="76" width="20" height="16" rx="6" />
            <rect x="74" y="92" width="72" height="104" rx="18" />
            <rect x="80" y="196" width="60" height="16" rx="7" />
          </g>

          {regions.map(({ mg, parts }) => {
            const d = byMg.get(mg);
            if (!d) return null;
            const state = d.state || 'cold';
            return (
              <g
                key={mg}
                className={`mm-region mm-${state}`}
                style={{ "--mg-color": d.color, "--volume": d.volume }}
              >
                {/* One button per region; the mirrored halves share it via a
                    <title> so a screen reader hears one control, not two. */}
                <g
                  role="button"
                  tabIndex={0}
                  aria-label={`${d.label}: ${WHEN(d.daysSinceTrained)}. Show ${d.label} exercises.`}
                  onClick={() => onPick(mg)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(mg); }
                  }}
                >
                  {parts.map(([x, y, w, h, r], i) => (
                    <rect key={i} x={x} y={y} width={w} height={h} rx={r} />
                  ))}
                </g>
              </g>
            );
          })}
        </svg>

        <ul className={"mm-legend"}>
          {[['hot', 'This week'], ['warm', 'Recent'], ['fading', 'Going cold'], ['cold', 'Untrained']].map(([k, label]) => (
            <li key={k}><span className={`mm-swatch mm-${k}`} aria-hidden="true" />{label}</li>
          ))}
        </ul>
      </div>

      {offBody.length > 0 && (
        <div className={"mm-offbody"}>
          {offBody.map(d => (
            <button
              key={d.mg}
              type="button"
              className={`mm-chip mm-${d.state}`}
              style={{ "--mg-color": d.color, "--volume": d.volume }}
              aria-label={`${d.label}: ${WHEN(d.daysSinceTrained)}. Show ${d.label} exercises.`}
              onClick={() => onPick(d.mg)}
            >
              <span aria-hidden="true">{d.emoji}</span>{d.label}
            </button>
          ))}
        </div>
      )}

      <div style={{ fontSize: FS.fs55, color: "#6f6a62", marginTop: S.s4, letterSpacing: ".02em" }}>
        {"Tap a region to browse its exercises."}
      </div>
    </div>
  );
});

export default MuscleMap;
