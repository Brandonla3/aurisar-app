import React, { useState } from 'react';
import { S, FS } from '../utils/tokens';

export default function LiveWorkoutBanner({ liveWorkout, onToggleExercise, onFinish, onDiscard }) {
  const [open, setOpen] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);

  const { exercises, name, icon } = liveWorkout;
  const doneCount = exercises.filter(e => e.done).length;
  const total = exercises.length;

  function handleFinishPress() {
    if (total - doneCount > 0) {
      setConfirmFinish(true);
    } else {
      onFinish(exercises);
      setOpen(false);
    }
  }

  function closeSheet() {
    setOpen(false);
    setConfirmFinish(false);
  }

  return (
    <>
      <button className="lw-banner" onClick={() => setOpen(true)} aria-label="Open active workout tracker">
        <span className="lw-dot" />
        <span className="lw-banner-icon">{icon}</span>
        <span className="lw-name">{name}</span>
        <span className="lw-progress-badge">
          <span style={{ color: doneCount > 0 ? '#6dbb3a' : '#8a8478', fontWeight: 700 }}>{doneCount}</span>
          <span className="lw-progress-sep">{"/"}</span>
          {total}
        </span>
        <span className="lw-chevron">{"›"}</span>
      </button>

      {open && (
        <>
          <div className="lw-overlay" onClick={closeSheet} />
          <div className="lw-sheet" role="dialog" aria-label="Active workout tracker">
            <div className="lw-sheet-handle" />

            <div className="lw-sheet-hdr">
              <span className="lw-sheet-icon">{icon}</span>
              <span className="lw-sheet-title">{name}</span>
              <button className="lw-sheet-close-btn" onClick={closeSheet}>{"✕"}</button>
            </div>

            <div className="lw-prog-track">
              <div
                className="lw-prog-fill"
                style={{ width: total > 0 ? `${Math.round((doneCount / total) * 100)}%` : '0%' }}
              />
            </div>
            <div className="lw-prog-lbl">
              {doneCount === total && total > 0
                ? '✓ All exercises complete'
                : `${doneCount} of ${total} complete`}
            </div>

            <div className="lw-ex-list">
              {exercises.map((ex, i) => {
                const isFirstOfSuperset = ex.supersetWith !== null && ex.supersetWith > i;
                const isInSuperset = ex.supersetWith !== null;
                return (
                  <React.Fragment key={i}>
                    {isFirstOfSuperset && (
                      <div className="lw-superset-label">{"⚡ Superset"}</div>
                    )}
                    <div
                      className={`lw-ex-row${ex.done ? ' done' : ''}${isInSuperset ? ' in-superset' : ''}`}
                      onClick={() => onToggleExercise(i)}
                      role="checkbox"
                      aria-checked={ex.done}
                    >
                      <div className={`lw-ex-cb${ex.done ? ' done' : ''}`}>
                        {ex.done && <span className="lw-ex-check-mark">{"✓"}</span>}
                      </div>
                      <div className="lw-ex-info">
                        <div className="lw-ex-name">{ex.name}</div>
                        {ex.exId !== 'rest_day' && (
                          <div className="lw-ex-meta">
                            {ex.setsDesc || `${ex.sets}×${ex.reps}`}
                            {ex.weightLbs ? ` · ${ex.weightLbs} lbs` : ''}
                          </div>
                        )}
                      </div>
                    </div>
                  </React.Fragment>
                );
              })}
            </div>

            {confirmFinish ? (
              <div className="lw-confirm-panel">
                <div className="lw-confirm-msg">
                  {`${total - doneCount} exercise${total - doneCount !== 1 ? 's' : ''} still unchecked — how would you like to finish?`}
                </div>
                <div className="lw-confirm-btns">
                  <button className="btn btn-gold" onClick={() => {
                    onFinish(exercises.map(e => ({ ...e, done: true })));
                    closeSheet();
                  }}>
                    {`Log All ${total} Exercises`}
                  </button>
                  <button className="btn btn-ghost btn-sm" onClick={() => {
                    onFinish(exercises.filter(e => e.done));
                    closeSheet();
                  }}>
                    {`Log Only Checked (${doneCount})`}
                  </button>
                  <button className="btn btn-ghost btn-sm" style={{ color: '#8a8478' }} onClick={() => setConfirmFinish(false)}>
                    {"← Keep Going"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="lw-sheet-footer">
                <button className="btn btn-ghost btn-sm" style={{ color: '#8a8478' }} onClick={() => {
                  if (window.confirm(`Discard "${name}"? Your progress will be lost.`)) {
                    onDiscard();
                    closeSheet();
                  }
                }}>
                  {"Discard"}
                </button>
                <button className="btn btn-gold" style={{ flex: 1 }} onClick={handleFinishPress}>
                  {doneCount < total
                    ? `✓ Finish (${doneCount}/${total})`
                    : '✓ Finish Workout'}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
