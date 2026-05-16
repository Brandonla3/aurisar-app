import { startTransition } from 'react';
import { uid, todayStr } from '../utils/helpers';
import { calcExXP, checkQuestCompletion } from '../utils/xp';
import { formatXP } from '../utils/format';
import { QUESTS } from '../data/constants';

const MARK_START = 'workout-completion:start';
const MARK_END = 'workout-completion:end';
const MEASURE = 'workout-completion';

// Yield to the browser so the urgent modal-close render commits and paints
// before the heavy entries/XP/log compute runs. requestIdleCallback is the
// audit's preferred primitive (it lets the browser pick a quiet moment) and
// setTimeout(0) is the Safari fallback. Either way the heavy work runs in a
// new task, after the urgent setCompletionModal(null) frame has already
// painted — `startTransition` alone can't do this because its callback body
// still runs synchronously inside the click handler.
const scheduleAfterPaint = typeof requestIdleCallback === 'function'
  ? (cb) => requestIdleCallback(cb, { timeout: 200 })
  : (cb) => setTimeout(cb, 0);

/**
 * Workout-completion handler for finding #3 in docs/performance-audit.md.
 *
 * Three-layer responsiveness strategy:
 *   1. Urgent: setCompletionModal(null) + completion-form resets fire
 *      synchronously in the click handler so React queues them as urgent
 *      updates and the modal-close frame paints first.
 *   2. After-paint: the entries/XP/log/quests compute runs inside
 *      requestIdleCallback (setTimeout(0) fallback) so it lands in a NEW
 *      task — the modal-close paint has already happened by then.
 *   3. Transition: the resulting setProfile/setXpFlash/showToast cluster
 *      runs inside startTransition so the App-wide re-render driven by the
 *      new profile is interruptible if the user taps something else.
 *
 * Adds a performance.measure span ("workout-completion") so before/after
 * commit time is queryable from PerformanceObserver / the Performance panel.
 */
export function useWorkoutCompletion({
  profile, setProfile,
  allExById, applyAutoCheckIn, getMult,
  showToast, setXpFlash, setWorkoutSubTab,
  completionModal, setCompletionModal,
  completionDate, setCompletionDate,
  completionAction, setCompletionAction,
  setScheduleWoDate,
}) {
  function confirmWorkoutComplete() {
    const wo = completionModal && completionModal.workout;
    if (!wo) return;

    // Snapshot the form state before resetting it — the deferred work below
    // needs the action/date the user actually picked, not the post-reset values.
    const action = completionAction;
    const pickedDate = completionDate;

    // Layer 1 — urgent: close the modal and reset the completion form. These
    // commit and paint before the heavy work runs (deferred below).
    setCompletionModal(null);
    setCompletionDate("");
    setCompletionAction("today");
    setScheduleWoDate("");

    // Layer 2 — after-paint: schedule the heavy compute in a new task so the
    // modal-close frame can flush first.
    scheduleAfterPaint(() => {
      try { performance.mark(MARK_START); } catch { /* noop */ }

      const dateStr = action === "past" && pickedDate && pickedDate !== "pick" ? pickedDate : todayStr();
      const dateObj = new Date(dateStr + "T12:00:00");
      const displayDate = dateObj.toLocaleDateString();
      const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const batchId = uid();

      const entries = wo.exercises.flatMap(ex => {
        const exData = allExById[ex.exId];
        if (!exData) return [];
        const isC = exData.category === "cardio";
        const isF = exData.category === "flexibility";
        const allRows = [{
          sets: ex.sets || 3,
          reps: ex.reps || 10,
          weightLbs: ex.weightLbs || null
        }, ...(ex.extraRows || [])];
        const extraCount = (ex.extraRows || []).length;
        return allRows.map(row => {
          const xp = calcExXP(ex.exId, row.sets || 3, row.reps || 10, profile.chosenClass, allExById, null, null, null, extraCount);
          return {
            exId: ex.exId,
            exercise: exData.name,
            icon: exData.icon,
            xp,
            mult: getMult(exData),
            sets: parseInt(row.sets) || 3,
            reps: parseInt(row.reps) || 10,
            weightLbs: !isC && !isF ? row.weightLbs || null : null,
            weightPct: 100,
            hrZone: ex.hrZone || null,
            distanceMi: ex.distanceMi || null,
            seconds: ex.seconds || null,
            time: now,
            date: displayDate,
            dateKey: dateStr,
            sourceWorkoutId: wo.id,
            sourceWorkoutName: wo.name,
            sourceWorkoutIcon: wo.icon,
            sourceWorkoutType: wo.oneOff ? "oneoff" : "reusable",
            sourceGroupId: batchId,
            sourceTotalCal: wo.totalCal || null,
            sourceActiveCal: wo.activeCal || null,
            sourceDurationSec: wo.durationMin || null
          };
        });
      }).filter(Boolean);

      if (entries.length === 0) {
        showToast("No valid exercises to log.");
        return;
      }

      const totalXP = entries.reduce((s, e) => s + e.xp, 0);
      const newLog = [...entries, ...profile.log];
      const newQuests = { ...(profile.quests || {}) };
      QUESTS.filter(q => q.auto && !newQuests[q.id] && !newQuests[q.id]).forEach(q => {
        if (checkQuestCompletion(q, newLog, profile.checkInStreak)) newQuests[q.id] = {
          completed: true,
          completedAt: todayStr(),
          claimed: false
        };
      });

      const newWorkouts = wo.oneOff ? (() => {
        const existing = (profile.workouts || []).find(w => w.id === wo.id);
        const saved = {
          ...wo,
          completedAt: dateStr,
          oneOff: wo.makeReusable ? false : true
        };
        delete saved.makeReusable;
        if (existing) return (profile.workouts || []).map(w => w.id === wo.id ? saved : w);
        return [...(profile.workouts || []), saved];
      })() : profile.workouts || [];

      if (wo.makeReusable) {
        entries.forEach(e => {
          e.sourceWorkoutType = "reusable";
        });
      }

      // Layer 3 — transition: the App re-render driven by the new profile
      // is interruptible. xpFlash + toast are queued in the same transition
      // so they batch with the profile update.
      let _ciResult = {
        checkInApplied: false,
        checkInXP: 0,
        checkInStreak: 0
      };
      startTransition(() => {
        setProfile(p => {
          const base = {
            ...p,
            xp: p.xp + totalXP,
            log: newLog,
            quests: newQuests,
            workouts: newWorkouts,
            scheduledWorkouts: wo.oneOff ? (p.scheduledWorkouts || []).filter(sw => sw.sourceWorkoutId !== wo.id) : p.scheduledWorkouts || []
          };
          const ci = applyAutoCheckIn(base, dateStr);
          _ciResult = ci;
          return ci.profile;
        });
        setXpFlash({
          amount: totalXP + _ciResult.checkInXP,
          mult: 1,
          prevXp: profile.xp
        });
        setTimeout(() => setXpFlash(null), 2500);
        if (wo.makeReusable) {
          setWorkoutSubTab("reusable");
        }
        const label = dateStr === todayStr() ? "today" : displayDate;
        const reusableNote = wo.makeReusable ? " · Saved to Re-Usable tab!" : "";
        const ciSuffix = _ciResult.checkInApplied ? ` · Checked in! +${_ciResult.checkInXP} XP · ${_ciResult.checkInStreak} day streak 🔥` : "";
        showToast(wo.icon + " " + wo.name + " completed " + label + "! " + formatXP(totalXP, {
          signed: true
        }) + " ⚡" + reusableNote + ciSuffix);
      });

      try {
        performance.mark(MARK_END);
        performance.measure(MEASURE, MARK_START, MARK_END);
        if (import.meta.env.DEV) {
          const m = performance.getEntriesByName(MEASURE);
          const last = m[m.length - 1];
          if (last) console.log(`[wc] ${last.duration.toFixed(1)}ms (${entries.length} entries, log size ${newLog.length})`);
        }
      } catch { /* noop */ }
    });
  }

  return { confirmWorkoutComplete };
}
