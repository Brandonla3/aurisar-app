import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * PR #294 review, two findings on the Set Forge weight-intensity ruler:
 *
 *   1. Its accessible <input type="range"> mirrors pctToSlider(pct) — a
 *      non-linear remap (pctToSlider(100) === 50) — with no aria-valuetext,
 *      so AT announced "50 of 100" at the visually-shown 100%. Needs
 *      aria-valuetext carrying the real percentage.
 *   2. .sf-ruler set touch-action:pan-x, which (per the touch-action spec's
 *      ancestor-intersection rule) blocks a vertical swipe starting on the
 *      38px strip from reaching the sheet's own vertical scroll — pan-x
 *      alone opts the element OUT of native y-panning rather than leaving it
 *      unclaimed for an ancestor to handle.
 *
 * Source guard: no jsdom layout/touch-action engine exists to reproduce
 * either behaviorally, matching rowInvariants.test.js's rationale.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = p => readFileSync(ROOT + p, 'utf8');

describe('WeightRuler accessible value', () => {
  const src = read('src/components/ui/WeightRuler.jsx');

  it('the a11y range input carries the real displayed percentage via aria-valuetext', () => {
    const body = src.slice(src.indexOf("type={'range'}"), src.indexOf('onChange={e => onPctChange'));
    expect(body).toMatch(/aria-valuetext=\{`\$\{pct\}%`\}/);
  });
});

describe('WeightRuler vertical scroll pass-through', () => {
  const css = read('src/styles/app.css');

  it('.sf-ruler does not claim vertical panning exclusively (pan-x alone blocks the sheet\'s scroll)', () => {
    const rule = css.slice(css.indexOf('.sf-ruler{'), css.indexOf('.sf-ruler{') + 400);
    expect(rule).not.toMatch(/touch-action:\s*pan-x\s*;/);
    expect(rule).toMatch(/touch-action:\s*pan-x pan-y/);
  });
});
