import React, { memo } from 'react';
import { S, FS } from '../../utils/tokens';

/**
 * Training heat, one torch per muscle group, coldest first.
 *
 * "What have I been neglecting?" was a question you answered from memory —
 * the Browse-by-Muscle grid shows how many exercises exist per group, which
 * says nothing about whether you have done any of them. Each torch burns in
 * proportion to how recently and how hard that group was worked, so a row of
 * dark runes on the left is the answer.
 *
 * Tapping a torch routes through the same muscle filter the tiles below use,
 * so this is a shortcut into the existing list rather than a new surface.
 *
 * This is the linear reading of the same data an anatomy map would render.
 * It ships first deliberately: it is legible at 375px, works with a screen
 * reader, and needs no artwork.
 */

const LABEL = {
  hot: 'trained this week',
  warm: 'trained recently',
  fading: 'going cold',
  cold: 'not trained',
};

const MuscleTorchStrip = memo(function MuscleTorchStrip({ data, onPick, viewToggle }) {
  if (!data || !data.length) return null;

  // Nothing logged at all — a strip of uniformly dark runes tells the user
  // nothing they don't already know.
  if (data.every(d => d.state === 'cold')) return null;

  return (
    <div className={"lib-home-section"} style={{ marginBottom: S.s4 }}>
      <div className={"lib-section-hdr"} style={{ display: "flex", alignItems: "center" }}>
        <span className={"lib-hdr-icon"}>{"🔥"}</span>{"Training Heat"}
        {viewToggle}
      </div>
      {/* A real list wrapping real buttons: the group is a list to a screen
          reader, each torch stays a button. */}
      <ul className={"torch-strip"}>
        {data.map(d => (
          <li key={d.mg} className={"torch-slot"}>
          <button
            type="button"
            className={`torch ${"torch-" + d.state}`}
            style={{ "--mg-color": d.color, "--volume": d.volume }}
            onClick={() => onPick(d.mg)}
            aria-label={`${d.label}: ${d.daysSinceTrained == null
              ? 'never trained'
              : d.daysSinceTrained === 0 ? 'trained today'
              : d.daysSinceTrained === 1 ? 'trained yesterday'
              : `last trained ${d.daysSinceTrained} days ago`}. Show ${d.label} exercises.`}
          >
            <span className={"torch-flame"} aria-hidden="true">{d.emoji}</span>
            <span className={"torch-name"}>{d.label}</span>
            <span className={"torch-when"}>
              {d.daysSinceTrained == null ? "—" : d.daysSinceTrained === 0 ? "today" : `${d.daysSinceTrained}d`}
            </span>
          </button>
          </li>
        ))}
      </ul>
      <div style={{ fontSize: FS.fs55, color: "#6f6a62", marginTop: S.s4, letterSpacing: ".02em" }}>
        {`Coldest first · ${LABEL[data[0].state]}`}
      </div>
    </div>
  );
});

export default MuscleTorchStrip;
