// ─── Design tokens ─────────────────────────────────────────────────────────────
// Single source of truth for the values inline JSX styles repeat across the app.
// CSS files (src/styles/*.css) keep their literal values — class-based styling
// already gives them a single edit point. Tokens here are for inline `style={{}}`.
//
// Audit history:
//   #74 introduced this module with 8 FS, 6 R, 12 S tokens, and migrated the top
//   3 most-frequent inline values for each scale (329 sites total).
//   The token-sweep follow-up adds two parallel naming systems:
//     • Numeric tokens (FS.fs50, R.r4, S.s4) — one per unique value, for
//       mechanical migration of stragglers with zero visual change.
//     • Semantic aliases (FS.sm, R.md, S.s8) — for code that wants to express
//       intent. Aliases are preserved from #74 with their original values, so
//       earlier migrations keep working.

// ── Font size ────────────────────────────────────────────────────────────────
// Two parallel naming systems share the same underlying values:
//   1. Numeric tokens: fs44, fs45, …, fs95 — 100 × the rem value. Use for
//      straggler migration.
//   2. Semantic aliases: xxs, xs, sm, base, md, lg, xl, xxl — preserved from
//      #74. Prefer these in new code.
const FS = {
  // Numeric (one per unique rem value found in the codebase)
  fs44: ".44rem",
  fs45: ".45rem",
  fs46: ".46rem",
  fs48: ".48rem",
  fs50: ".5rem",
  fs52: ".52rem",
  fs54: ".54rem",
  fs55: ".55rem",
  fs56: ".56rem",
  fs58: ".58rem",
  fs60: ".6rem",
  fs62: ".62rem",
  fs63: ".63rem",
  fs64: ".64rem",
  fs65: ".65rem",
  fs66: ".66rem",
  fs68: ".68rem",
  fs70: ".7rem",
  fs72: ".72rem",
  fs74: ".74rem",
  fs75: ".75rem",
  fs76: ".76rem",
  fs78: ".78rem",
  fs80: ".8rem",
  fs82: ".82rem",
  fs83: ".83rem",
  fs84: ".84rem",
  fs85: ".85rem",
  fs86: ".86rem",
  fs88: ".88rem",
  fs90: ".9rem",
  fs92: ".92rem",
  fs93: ".93rem",
  fs95: ".95rem",
  // Semantic aliases (preserved from #74)
  xxs:  ".5rem",   // micro badges, caps labels
  xs:   ".55rem",  // small chip labels
  sm:   ".6rem",   // form labels, secondary text
  base: ".65rem",  // body small
  md:   ".7rem",   // body
  lg:   ".72rem",  // body emphasised
  xl:   ".8rem",   // small headings
  xxl:  ".9rem",   // headings
};

// ── Border radius ────────────────────────────────────────────────────────────
// Numeric tokens for every unique px value, plus the semantic aliases from #74.
const R = {
  // Numeric (one per unique value)
  r0:   0,
  r2:   2,
  r3:   3,
  r4:   4,
  r5:   5,
  r6:   6,
  r7:   7,
  r8:   8,
  r9:   9,
  r10:  10,
  r11:  11,
  r12:  12,
  r16:  16,
  r20:  20,
  // Semantic aliases (preserved from #74)
  sm:   4,
  md:   6,    // cards, chips
  lg:   8,    // inputs, buttons
  xl:   9,    // larger cards
  xxl:  12,   // sections
  full: 9999, // pills
};

// ── Spacing ──────────────────────────────────────────────────────────────────
// Unitless — React inline styles interpret as px. After the Option B snap
// migration, the canonical scale is even-step (2,4,6,8,10,12,14,16,18,20,24,
// 28,32). Off-by-1 values from the original codebase (1,3,5,7,9,11,13) snap
// to the nearest even token. Negative tokens (sNeg4/6/8) preserve intentional
// overlap effects.
//
// Snap rules applied in the migration PR (kept here for future reference):
//   1  → s2  | 3 → s4 | 5 → s6  | 7 → s8 | 9 → s8 | 11 → s12 | 13 → s14
const S = {
  s0:  0,
  s2:  2,
  s4:  4,
  s6:  6,
  s8:  8,
  s10: 10,
  s12: 12,
  s14: 14,
  s16: 16,
  s18: 18,
  s20: 20,
  s24: 24,
  s28: 28,
  s32: 32,
  // Negative — kept distinct for intentional overlap (hero text, etc.)
  sNeg4: -4,
  sNeg6: -6,
  sNeg8: -8,
};

const TOKENS = { FS, R, S };

export { TOKENS, FS, R, S };
