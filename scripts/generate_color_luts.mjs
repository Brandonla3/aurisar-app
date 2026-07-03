/**
 * generate_color_luts.mjs — authors the Phase 0 color-grading LUTs into
 * /public/luts/ (overworld.3dl, dungeon.3dl).
 *
 *   node scripts/generate_color_luts.mjs
 *
 * Format notes (matched against Babylon's ColorGradingTexture 3dl parser):
 * the first non-comment line's TOKEN COUNT sets the LUT size N (the ramp
 * values themselves are ignored); then N^3 "R G B" integer lines ordered
 * red-slowest / blue-fastest. Values are normalized by the file's peak, so
 * the 0..4095 scale is convention, not contract.
 *
 * Grades (deliberately gentle — they sit on top of ACES tone mapping):
 *   overworld — warm/vibrant: mild S-curve, +12% saturation, teal-leaning
 *               shadows, warm highlights.
 *   dungeon   — cold/oppressive: -25% saturation, cool shadows+mids, gentle
 *               shadow crush, highlights kept warm so torchlight still reads.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'luts');
const N = 17;
const MAX = 4095;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const smooth = (v) => v * v * (3 - 2 * v);

function overworldGrade(r, g, b) {
  // mild S-curve contrast
  const k = 0.22;
  r = lerp(r, smooth(r), k);
  g = lerp(g, smooth(g), k);
  b = lerp(b, smooth(b), k);
  // +12% saturation
  const y = luma(r, g, b);
  r = lerp(y, r, 1.12);
  g = lerp(y, g, 1.12);
  b = lerp(y, b, 1.12);
  // split tone: teal-leaning shadows, warm highlights
  const sh = 1 - y, hi = y;
  r += -0.020 * sh + 0.030 * hi;
  g += +0.004 * sh + 0.012 * hi;
  b += +0.022 * sh - 0.018 * hi;
  return [r, g, b];
}

function dungeonGrade(r, g, b) {
  // steeper curve with a gentle shadow crush
  const k = 0.30;
  r = lerp(r, smooth(r), k);
  g = lerp(g, smooth(g), k);
  b = lerp(b, smooth(b), k);
  const crush = 0.045;
  r = Math.max(0, r - crush * (1 - r));
  g = Math.max(0, g - crush * (1 - g));
  b = Math.max(0, b - crush * (1 - b));
  // -25% saturation
  const y = luma(r, g, b);
  r = lerp(y, r, 0.75);
  g = lerp(y, g, 0.75);
  b = lerp(y, b, 0.75);
  // cool cast in shadows/mids; leave highlights warm for torchlight
  const sh = 1 - y, hi = y * y;
  r += -0.030 * sh + 0.026 * hi;
  g += -0.008 * sh + 0.008 * hi;
  b += +0.034 * sh - 0.016 * hi;
  return [r, g, b];
}

function write3dl(name, grade) {
  const ramp = Array.from({ length: N }, (_, i) => Math.round((i / (N - 1)) * 1023));
  const lines = [ramp.join(' ')];
  for (let ri = 0; ri < N; ri++) {
    for (let gi = 0; gi < N; gi++) {
      for (let bi = 0; bi < N; bi++) {
        const [r, g, b] = grade(ri / (N - 1), gi / (N - 1), bi / (N - 1));
        lines.push(
          `${Math.round(clamp01(r) * MAX)} ${Math.round(clamp01(g) * MAX)} ${Math.round(clamp01(b) * MAX)}`,
        );
      }
    }
  }
  const path = join(OUT, name);
  writeFileSync(path, lines.join('\n') + '\n');
  console.log(`wrote ${path} (${lines.length} lines)`);
}

mkdirSync(OUT, { recursive: true });
write3dl('overworld.3dl', overworldGrade);
write3dl('dungeon.3dl', dungeonGrade);
