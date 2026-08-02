import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * PR #294 review: ExerciseDetailSheet hardcoded units in two places even
 * though metric users see every other figure (Last session, PB weight)
 * converted via displayWt/displayPace —
 *   - pbText's pace branch always said "min/mi" regardless of profile.units
 *   - the History "Trend" chip always appended "lbs" to a raw weightLbs delta
 * Source guard: both are deep in a large render function, not worth a full
 * jsdom mount for this file's dependency surface.
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const src = readFileSync(ROOT + 'src/features/exercises/ExerciseDetailSheet.jsx', 'utf8');

describe('ExerciseDetailSheet respects profile.units', () => {
  it('pbText renders pace through displayPace, not a hardcoded min/mi literal', () => {
    const body = src.slice(src.indexOf('function pbText'), src.indexOf('function pbText') + src.slice(src.indexOf('function pbText')).indexOf('\n}') + 2);
    expect(body).toContain('displayPace(pb.value, units)');
    expect(body).not.toMatch(/min\/mi`;/);
  });

  it('the History Trend chip renders its delta through displayWt, not a hardcoded "lbs" literal', () => {
    const idx = src.indexOf('"Trend"');
    const chip = src.slice(idx, idx + 400);
    expect(chip).toContain('displayWt(Math.abs(trendDelta), profile.units)');
    expect(chip).not.toMatch(/\$\{Math\.abs\(trendDelta\)\}\s*lbs/);
  });
});
