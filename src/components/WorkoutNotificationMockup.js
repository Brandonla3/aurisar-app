import React, { useState, useEffect } from 'react';

const DEMO_WORKOUT = {
  name: "Upper Body Quest",
  exercises: [
    { name: "Bench Press", sets: 4, reps: 8, weight: "185 lbs", group: "Chest", icon: "🏋️" },
    { name: "Incline Dumbbell Press", sets: 3, reps: 10, weight: "60 lbs", group: "Chest", icon: "🏋️" },
    { name: "Barbell Row", sets: 4, reps: 8, weight: "155 lbs", group: "Back", icon: "💪" },
    { name: "Lat Pulldown", sets: 3, reps: 10, weight: "120 lbs", group: "Back", icon: "💪" },
    { name: "Overhead Press", sets: 3, reps: 8, weight: "95 lbs", group: "Shoulders", icon: "⚔️" },
    { name: "Lateral Raises", sets: 3, reps: 12, weight: "20 lbs", group: "Shoulders", icon: "⚔️" },
    { name: "Tricep Dips", sets: 3, reps: 12, weight: "BW", group: "Arms", icon: "🔥" },
    { name: "Bicep Curls", sets: 3, reps: 10, weight: "35 lbs", group: "Arms", icon: "🔥" },
  ]
};

const MILESTONES = ["Chest", "Back", "Shoulders", "Arms"];

function WorkoutNotificationMockup({ onClose }) {
  const [view, setView] = useState("lock");
  const [completed, setCompleted] = useState(new Set());
  const [showComplete, setShowComplete] = useState(false);
  const [clockTime, setClockTime] = useState("");
  const [clockDate, setClockDate] = useState("");

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClockTime(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      setClockDate(now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  const toggleExercise = (idx) => {
    setCompleted(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      // Check if all done
      if (next.size === DEMO_WORKOUT.exercises.length && !showComplete) {
        setTimeout(() => setShowComplete(true), 400);
      }
      return next;
    });
  };

  const pct = Math.round((completed.size / DEMO_WORKOUT.exercises.length) * 100);

  const isMilestoneDone = (group) => {
    return DEMO_WORKOUT.exercises
      .map((ex, i) => ({ ex, i }))
      .filter(({ ex }) => ex.group === group)
      .every(({ i }) => completed.has(i));
  };

  // How far the progress line should fill (based on milestone completion order)
  const milestonesCompleted = MILESTONES.filter(g => isMilestoneDone(g)).length;
  const linePct = (milestonesCompleted / MILESTONES.length) * 100;

  // Group exercises by muscle group for display
  const groups = MILESTONES.map(group => ({
    group,
    exercises: DEMO_WORKOUT.exercises
      .map((ex, i) => ({ ...ex, idx: i }))
      .filter(ex => ex.group === group)
  }));

  const hasStarted = completed.size > 0;
  const h = React.createElement;

  // Mini pizza tracker (shared between lock screen banner and tracker header)
  const miniPizzaTracker = h('div', { className: "wn-mini-pizza" },
    h('div', { className: "wn-mini-pizza-track" },
      h('div', { className: "wn-mini-pizza-fill", style: { width: linePct + "%" } })
    ),
    h('div', { className: "wn-mini-pizza-nodes" },
      MILESTONES.map((group, i) => {
        const done = isMilestoneDone(group);
        return h('div', {
          key: group,
          className: "wn-mini-node" + (done ? " done" : "")
        },
          done ? "✓" : ""
        );
      })
    ),
    h('div', { className: "wn-mini-pizza-labels" },
      MILESTONES.map(group =>
        h('div', {
          key: group,
          className: "wn-mini-label" + (isMilestoneDone(group) ? " done" : "")
        }, group)
      )
    )
  );

  // ── Lock Screen View ──
  if (view === "lock") {
    return h('div', { className: "wn-overlay", onClick: () => {} },
      // Lock screen background
      h('div', { className: "wn-lock" },
        // Time
        h('div', { className: "wn-time" }, clockTime),
        h('div', { className: "wn-date" }, clockDate),

        // Notification banner
        h('div', {
          className: "wn-banner" + (hasStarted ? " in-progress" : ""),
          onClick: () => setView("tracker")
        },
          h('div', { className: "wn-banner-row" },
            h('div', { className: "wn-banner-icon" }, "⚔️"),
            h('div', { className: "wn-banner-title" }, "AURISAR"),
            h('div', { className: "wn-banner-time" }, hasStarted ? "In Progress" : "now")
          ),
          h('div', { className: "wn-banner-workout" }, DEMO_WORKOUT.name),

          // Show mini pizza tracker in the banner
          miniPizzaTracker,

          h('div', { className: "wn-banner-sub" },
            hasStarted
              ? completed.size + "/" + DEMO_WORKOUT.exercises.length + " exercises · " + pct + "% complete · Tap to continue"
              : MILESTONES.length + " muscle groups · " + DEMO_WORKOUT.exercises.length + " exercises · Tap to begin"
          )
        ),

        // Subtle hint
        h('div', { className: "wn-lock-hint" },
          hasStarted ? "tap to continue your workout" : "tap notification to start workout"
        ),

        // Close button at bottom
        h('div', {
          className: "wn-lock-close",
          onClick: (e) => { e.stopPropagation(); onClose(); }
        }, "✕ Close Mockup")
      )
    );
  }

  // ── Tracker View ──
  return h('div', { className: "wn-overlay" },
    h('div', { className: "wn-tracker" },

      // Header
      h('div', { className: "wn-tracker-header" },
        h('div', { className: "wn-tracker-title" },
          h('span', { className: "wn-tracker-icon" }, "⚔️"),
          DEMO_WORKOUT.name
        ),
        h('div', {
          className: "wn-tracker-close",
          onClick: () => setView("lock"),
          title: "Back to lock screen"
        }, "✕")
      ),

      // Pizza Tracker Progress Bar
      h('div', { className: "wn-pizza" },
        // Background line
        h('div', { className: "wn-pizza-track" },
          h('div', { className: "wn-pizza-fill", style: { width: linePct + "%" } })
        ),
        // Milestone nodes
        h('div', { className: "wn-pizza-nodes" },
          MILESTONES.map((group, i) => {
            const done = isMilestoneDone(group);
            return h('div', {
              key: group,
              className: "wn-pizza-node-wrap",
              style: { left: (i / (MILESTONES.length - 1)) * 100 + "%" }
            },
              h('div', { className: "wn-pizza-node" + (done ? " done" : "") },
                done ? "✓" : (i + 1)
              ),
              h('div', { className: "wn-pizza-label" + (done ? " done" : "") }, group)
            );
          })
        )
      ),

      // Stats row
      h('div', { className: "wn-stats" },
        h('span', null, completed.size + "/" + DEMO_WORKOUT.exercises.length + " exercises"),
        h('span', { className: "wn-stats-pct" }, pct + "% complete")
      ),

      // Exercise list
      h('div', { className: "wn-exercises" },
        groups.map(({ group, exercises }) =>
          h('div', { key: group, className: "wn-group" },
            h('div', { className: "wn-group-header" },
              h('span', null, group),
              h('span', { className: "wn-group-count" },
                exercises.filter(ex => completed.has(ex.idx)).length + "/" + exercises.length
              )
            ),
            exercises.map(ex =>
              h('div', {
                key: ex.idx,
                className: "wn-exercise" + (completed.has(ex.idx) ? " done" : ""),
                onClick: () => toggleExercise(ex.idx)
              },
                h('div', {
                  className: "wn-check" + (completed.has(ex.idx) ? " done" : "")
                }, completed.has(ex.idx) ? "✓" : ""),
                h('div', { className: "wn-exercise-info" },
                  h('div', { className: "wn-exercise-name" },
                    h('span', { className: "wn-exercise-icon" }, ex.icon),
                    ex.name
                  ),
                  h('div', { className: "wn-exercise-detail" },
                    ex.sets + "×" + ex.reps + " @ " + ex.weight
                  )
                )
              )
            )
          )
        )
      ),

      // Completion celebration
      showComplete && h('div', { className: "wn-complete" },
        h('div', { className: "wn-complete-card" },
          h('div', { className: "wn-complete-icon" }, "🏆"),
          h('div', { className: "wn-complete-title" }, "Quest Complete!"),
          h('div', { className: "wn-complete-sub" }, "All exercises finished · +850 XP"),
          h('div', { className: "wn-complete-bar" },
            h('div', { className: "wn-complete-bar-fill" })
          ),
          h('div', {
            className: "wn-complete-btn",
            onClick: onClose
          }, "Claim Rewards")
        )
      )
    )
  );
}

export default WorkoutNotificationMockup;
