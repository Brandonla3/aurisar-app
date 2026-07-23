import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Source guards for two extraction bugs found in PR #264 review, neither
 * reachable without a DOM:
 *   - Staging Tray → New Workout (openBuilderWithExercises) must fully reset
 *     the keep-alive builder before seeding, or an abandoned draft's
 *     duration/labels/calories/superset state leaks into the new workout.
 *   - openStatsPromptIfNeeded must read the current stats-prompt preference via
 *     the ref, not a closure over the initial profile (openCompletionFlow is
 *     memoized with [], so a stale profile would ignore the user's choice).
 */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const read = p => readFileSync(ROOT + p, 'utf8');

describe('builder fresh-start reset (P2c)', () => {
  const src = read('src/features/workouts/WorkoutsTabContainer.jsx');

  it('resetBuilderFields clears every leak-prone builder field', () => {
    const body = src.slice(src.indexOf('function resetBuilderFields()'));
    const fn = body.slice(0, body.indexOf('\n  }') + 4);
    for (const setter of [
      'setWbName', 'setWbIcon', 'setWbDesc', 'setWbExercises', 'setWbEditId',
      'setWbCopySource', 'setWbIsOneOff', 'setWbDuration', 'setWbDurSec',
      'setWbActiveCal', 'setWbTotalCal', 'setWbLabels', 'setNewLabelInput',
      'setCollapsedWbEx', 'setSsChecked', 'setSsAccordion', 'setDragWbExIdx',
    ]) {
      expect(fn, `resetBuilderFields must clear ${setter}`).toContain(setter);
    }
  });

  it('openBuilderWithExercises routes through resetBuilderFields before seeding', () => {
    const body = src.slice(src.indexOf('openBuilderWithExercises:'));
    const fn = body.slice(0, body.indexOf('},') + 2);
    expect(fn).toContain('resetBuilderFields()');
    expect(fn).toContain('setWbExercises(entries)');
    // reset must precede the seed
    expect(fn.indexOf('resetBuilderFields()')).toBeLessThan(fn.indexOf('setWbExercises(entries)'));
  });

  it('initWorkoutBuilder also starts from the shared reset', () => {
    const body = src.slice(src.indexOf('function initWorkoutBuilder('));
    const fn = body.slice(0, body.indexOf('\n  }') + 4);
    expect(fn).toContain('resetBuilderFields()');
  });
});

describe('stats-prompt preference is read live (C1)', () => {
  const app = read('src/App.jsx');

  it('openStatsPromptIfNeeded gates on notifPrefsRef.current, not the closed-over profile', () => {
    const body = app.slice(app.indexOf('function openStatsPromptIfNeeded('));
    const fn = body.slice(0, body.indexOf('\n  }') + 4);
    expect(fn).toContain('notifPrefsRef.current');
    expect(fn).toContain('reviewBattleStats');
    // must NOT re-introduce the stale read for the gate
    expect(fn).not.toMatch(/const _bsPrefs = profile\.notificationPrefs/);
  });
});
