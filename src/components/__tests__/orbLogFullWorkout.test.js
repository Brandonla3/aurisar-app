import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * "Log Full Workout" — the orb's 4th action, added alongside Quick Log /
 * Build Workout / Repeat Last. Opens a condensed, searchable list of the
 * user's saved (non-one-off) workouts; picking one starts it live via the
 * same startLiveWorkout path the Workouts tab and Repeat Last use. Source
 * guard, matching the rest of this file's suite — OrbCreateMenu isn't
 * jsdom-rendered anywhere in this repo.
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const orb = readFileSync(ROOT + 'src/components/OrbCreateMenu.jsx', 'utf8');
const app = readFileSync(ROOT + 'src/App.jsx', 'utf8');

describe('OrbCreateMenu — Log Full Workout', () => {
  it('is disabled when there are no saved workouts, and lists them by name on open', () => {
    const body = orb.slice(orb.indexOf('key: "workout"'), orb.indexOf('key: "repeat"'));
    expect(body).toContain('disabled: (workouts || []).length === 0');
    expect(body).toContain('setView("workouts")');
  });

  it('the workouts picker view filters by name and calls onPickWorkout, not a bare navigation', () => {
    const body = orb.slice(orb.indexOf('view === "workouts"'));
    expect(body).toContain('workoutPickList.map(wo =>');
    expect(body).toContain('onClick={() => onPickWorkout(wo)}');
  });
});

describe('App.jsx wires Log Full Workout to saved (non-one-off) workouts', () => {
  it('passes only reusable workouts, not one-off logged sessions', () => {
    const body = app.slice(app.indexOf('workouts={(profile.workouts'), app.indexOf('onPickWorkout={wo'));
    expect(body).toContain('.filter(w => !w.oneOff)');
  });

  it('picking a workout while one is already live routes through the replace-confirm, same-id or not', () => {
    // Same protection this session's review response added for Repeat Last —
    // startLiveWorkout's own id-mismatch-only check would otherwise let this
    // action silently overwrite an in-progress session that happens to share
    // the picked workout's id.
    const body = app.slice(app.indexOf('onPickWorkout={wo'), app.indexOf('repeatLast={repeatLastSession'));
    expect(body).toContain('if (liveWorkout) setPendingLiveWorkout(wo);');
    expect(body).toContain('else startLiveWorkout(wo);');
  });
});
