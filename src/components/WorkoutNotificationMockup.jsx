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

  // Mini pizza tracker (shared between lock screen banner and tracker header)
  const miniPizzaTracker = (
    <div className="wn-mini-pizza">
      <div className="wn-mini-pizza-track">
        <div className="wn-mini-pizza-fill" style={{ width: linePct + "%" }} />
      </div>
      <div className="wn-mini-pizza-nodes">
        {MILESTONES.map((group) => {
          const done = isMilestoneDone(group);
          return (
            <div key={group} className={"wn-mini-node" + (done ? " done" : "")}>
              {done ? "✓" : ""}
            </div>
          );
        })}
      </div>
      <div className="wn-mini-pizza-labels">
        {MILESTONES.map(group => (
          <div key={group} className={"wn-mini-label" + (isMilestoneDone(group) ? " done" : "")}>
            {group}
          </div>
        ))}
      </div>
    </div>
  );

  // ── Lock Screen View ──
  if (view === "lock") {
    return (
      <div className="wn-overlay" onClick={() => {}}>
        <div className="wn-lock">
          <div className="wn-time">{clockTime}</div>
          <div className="wn-date">{clockDate}</div>

          <div
            className={"wn-banner" + (hasStarted ? " in-progress" : "")}
            onClick={() => setView("tracker")}
          >
            <div className="wn-banner-row">
              <div className="wn-banner-icon">⚔️</div>
              <div className="wn-banner-title">AURISAR</div>
              <div className="wn-banner-time">{hasStarted ? "In Progress" : "now"}</div>
            </div>
            <div className="wn-banner-workout">{DEMO_WORKOUT.name}</div>

            {miniPizzaTracker}

            <div className="wn-banner-sub">
              {hasStarted
                ? completed.size + "/" + DEMO_WORKOUT.exercises.length + " exercises · " + pct + "% complete · Tap to continue"
                : MILESTONES.length + " muscle groups · " + DEMO_WORKOUT.exercises.length + " exercises · Tap to begin"}
            </div>
          </div>

          <div className="wn-lock-hint">
            {hasStarted ? "tap to continue your workout" : "tap notification to start workout"}
          </div>

          <div className="wn-lock-close" onClick={(e) => { e.stopPropagation(); onClose(); }}>
            ✕ Close Mockup
          </div>
        </div>
      </div>
    );
  }

  // ── Tracker View ──
  return (
    <div className="wn-overlay">
      <div className="wn-tracker">
        <div className="wn-tracker-header">
          <div className="wn-tracker-title">
            <span className="wn-tracker-icon">⚔️</span>
            {DEMO_WORKOUT.name}
          </div>
          <div className="wn-tracker-close" onClick={() => setView("lock")} title="Back to lock screen">✕</div>
        </div>

        <div className="wn-pizza">
          <div className="wn-pizza-track">
            <div className="wn-pizza-fill" style={{ width: linePct + "%" }} />
          </div>
          <div className="wn-pizza-nodes">
            {MILESTONES.map((group, i) => {
              const done = isMilestoneDone(group);
              return (
                <div
                  key={group}
                  className="wn-pizza-node-wrap"
                  style={{ left: (i / (MILESTONES.length - 1)) * 100 + "%" }}
                >
                  <div className={"wn-pizza-node" + (done ? " done" : "")}>
                    {done ? "✓" : (i + 1)}
                  </div>
                  <div className={"wn-pizza-label" + (done ? " done" : "")}>{group}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="wn-stats">
          <span>{completed.size + "/" + DEMO_WORKOUT.exercises.length + " exercises"}</span>
          <span className="wn-stats-pct">{pct + "% complete"}</span>
        </div>

        <div className="wn-exercises">
          {groups.map(({ group, exercises }) => (
            <div key={group} className="wn-group">
              <div className="wn-group-header">
                <span>{group}</span>
                <span className="wn-group-count">
                  {exercises.filter(ex => completed.has(ex.idx)).length + "/" + exercises.length}
                </span>
              </div>
              {exercises.map(ex => (
                <div
                  key={ex.idx}
                  className={"wn-exercise" + (completed.has(ex.idx) ? " done" : "")}
                  onClick={() => toggleExercise(ex.idx)}
                >
                  <div className={"wn-check" + (completed.has(ex.idx) ? " done" : "")}>
                    {completed.has(ex.idx) ? "✓" : ""}
                  </div>
                  <div className="wn-exercise-info">
                    <div className="wn-exercise-name">
                      <span className="wn-exercise-icon">{ex.icon}</span>
                      {ex.name}
                    </div>
                    <div className="wn-exercise-detail">
                      {ex.sets + "×" + ex.reps + " @ " + ex.weight}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {showComplete && (
          <div className="wn-complete">
            <div className="wn-complete-card">
              <div className="wn-complete-icon">🏆</div>
              <div className="wn-complete-title">Quest Complete!</div>
              <div className="wn-complete-sub">All exercises finished · +850 XP</div>
              <div className="wn-complete-bar">
                <div className="wn-complete-bar-fill" />
              </div>
              <div className="wn-complete-btn" onClick={onClose}>Claim Rewards</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default WorkoutNotificationMockup;
