// ─── Generated metal surfaces ──────────────────────────────────────────────
// A workout has no artwork. The reference designs this redesign follows lean
// on photography for card identity, but a photo set would cost more bytes
// than the entire 3D world is budgeted (docs/ART_DIRECTION.md caps the runtime
// download ledger at 18 MB) and it would not survive going offline.
//
// So each workout grows its own face instead. A stable hash of its identity
// picks a rake angle, where the specular band sits, and a secondary sheen
// offset; those become a CSS background. Same workout, same face, every time,
// on every device, for zero bytes.
//
// Wear is the second input. A workout finished twenty times reads as polished;
// one never run reads as matte ash. It is derived from completion count at
// render time, never stored.
//
// This module returns the gradient face and the `--wear` variable only. The
// grain overlay lives in CSS (`.metal::after` in app.css) because a
// pseudo-element can modulate its opacity from `--wear`, which a background
// layer baked into a data URI cannot.

/**
 * FNV-1a. Picked over a sum-of-char-codes because the names that most need to
 * look different are the ones that differ least — "Leg Day 5/10" and
 * "Leg Day 5/9" have to land on visibly different faces, and a naive sum puts
 * them one step apart.
 */
function hash(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const clamp01 = n => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * The CSS background face for a workout (or anything else with a stable id).
 *
 * @param {string} key    stable identity — pass `${id} ${name}`, not the index
 * @param {object} opts
 * @param {number} opts.wear  0–1; 0 = never completed, 1 = well worn
 * @returns {object} a style object — spread it onto the element alongside
 *                   `className="metal"`
 *
 *   <div className="metal" style={surfaceFor(`${wo.id} ${wo.name}`, { wear })} />
 */
export function surfaceFor(key, { wear = 0 } = {}) {
  const h = hash(String(key == null ? '' : key));
  const w = clamp01(wear);

  // Rake stays in a 96°–179° arc so every face is lit broadly from the same
  // side as --light-angle (155deg). Letting it run the full 360° would put
  // some cards' highlights on the wrong edge and break the "one light source"
  // illusion the whole system rests on.
  const rake = 96 + (h % 84);
  const band = 18 + ((h >>> 7) % 54);   // 18%–71% — where the bright band sits
  const tilt = 118 + ((h >>> 15) % 44); // secondary sheen, deliberately off-axis

  // Polish rises and diffuses with wear: the band gets brighter and tighter.
  const gloss = (0.045 + w * 0.085).toFixed(3);
  const halo = (0.018 + w * 0.03).toFixed(3);
  const spread = (16 - w * 6).toFixed(1);

  return {
    backgroundImage: [
      `linear-gradient(${rake}deg,` +
        `rgba(255,255,255,0) ${Math.max(0, band - spread)}%,` +
        `rgba(255,255,255,${gloss}) ${band}%,` +
        `rgba(255,255,255,0) ${Math.min(100, band + Number(spread))}%)`,
      `linear-gradient(${tilt}deg,` +
        `rgba(255,255,255,${halo}) 0%,` +
        `rgba(0,0,0,0) 46%,` +
        `rgba(0,0,0,.14) 100%)`,
      'var(--specular)',
    ].join(','),
    '--wear': String(w),
  };
}

/**
 * Completion count → the 0–1 wear value. Saturates at 12 sessions: past that
 * the difference stops being legible, and a workout finished 200 times should
 * not read differently from one finished 30 times.
 */
export function wearFromCompletions(count) {
  return clamp01((Number(count) || 0) / 12);
}

export default surfaceFor;
