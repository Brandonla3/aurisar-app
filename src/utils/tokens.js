// ─── Design tokens ─────────────────────────────────────────────────────────────
// Single source of truth for the values inline JSX styles repeat across the app.
// Audit (#59) found 22 distinct font sizes, 7 borderRadius values, and dozens of
// gap/padding magic numbers with no documented scale. These tokens replace the
// most-frequent values so future code stays consistent.
//
// CSS files (src/styles/*.css) keep their literal values — class-based styling
// already gives them a single edit point. Tokens here are for inline `style={{}}`.

// Font size scale. rem-based to scale with browser settings.
const FS = {
  xxs:  ".5rem",   // micro labels (caps badges)
  xs:   ".55rem",  // small chip labels
  sm:   ".6rem",   // form labels, secondary text  ← most common (107)
  base: ".65rem",  // body small
  md:   ".7rem",   // body                            ← 2nd most common (47)
  lg:   ".72rem",  // body emphasised                ← 3rd most common (86)
  xl:   ".8rem",   // small headings
  xxl:  ".9rem",   // headings
};

// Border radius scale.
const R = {
  sm:   4,
  md:   6,    // cards, chips         ← 22 occurrences
  lg:   8,    // inputs, buttons      ← 32 occurrences
  xl:   9,    // larger cards         ← 35 occurrences (most common)
  xxl:  12,   // sections
  full: 9999, // pills
};

// Spacing scale (4px-based). React inline styles interpret unitless numbers as px.
const S = {
  s2:  2,
  s4:  4,
  s6:  6,
  s8:  8,
  s10: 10,
  s12: 12,
  s14: 14,
  s16: 16,
  s20: 20,
  s24: 24,
  s28: 28,
  s32: 32,
};

const TOKENS = { FS, R, S };

export { TOKENS, FS, R, S };
