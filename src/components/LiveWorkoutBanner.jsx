import React, { useState } from 'react';
import { S, FS } from '../utils/tokens';
import { isMetric, lbsToKg, kgToLbs, weightLabel } from '../utils/units';

export default function LiveWorkoutBanner({
  liveWorkout,
  onToggleExercise,
  onFinish,
  onDiscard,
  onUpdateExercise,
  onRemoveExercise,
  onAddExercise,
  allExById,
  allExercises,
  units,
}) {
  const [open, setOpen] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState(null);
  const [editVals, setEditVals] = useState({ sets: '', reps: '', weight: '' });
  const [addExOpen, setAddExOpen] = useState(false);
  const [addExSearch, setAddExSearch] = useState('');
  const [addExSelected, setAddExSelected] = useState(null);
  const [addExSets, setAddExSets] = useState('3');
  const [addExReps, setAddExReps] = useState('10');
  const [addExWeight, setAddExWeight] = useState('');

  const { exercises, name, icon } = liveWorkout;
  const doneCount = exercises.filter(e => e.done).length;
  const total = exercises.length;
  const metric = isMetric(units);
  const wLabel = weightLabel(units);

  const isStrength = (exId) => (allExById?.[exId]?.category || '').toLowerCase() === 'strength';

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
    setExpandedIdx(null);
    setAddExOpen(false);
    setAddExSearch('');
    setAddExSelected(null);
  }

  function openExpand(e, i, ex) {
    e.stopPropagation();
    if (expandedIdx === i) {
      setExpandedIdx(null);
      return;
    }
    setEditVals({
      sets: String(ex.sets || ''),
      reps: String(ex.reps || ''),
      weight: ex.weightLbs ? (metric ? lbsToKg(ex.weightLbs) : String(ex.weightLbs)) : '',
    });
    setExpandedIdx(i);
    setAddExOpen(false);
  }

  function saveEdit(i) {
    const rawWeight = parseFloat(editVals.weight);
    const weightLbs = editVals.weight && !isNaN(rawWeight)
      ? (metric ? parseFloat(kgToLbs(rawWeight)) : rawWeight)
      : null;
    onUpdateExercise(i, {
      sets: parseInt(editVals.sets) || exercises[i].sets,
      reps: parseInt(editVals.reps) || exercises[i].reps,
      weightLbs,
    });
    setExpandedIdx(null);
  }

  function handleRemove(i) {
    onRemoveExercise(i);
    setExpandedIdx(null);
  }

  // Add exercise search — requires 2+ chars
  const addExResults = addExSearch.length >= 2
    ? (allExercises || [])
        .filter(e => e.name.toLowerCase().includes(addExSearch.toLowerCase()) && e.id !== 'rest_day')
        .slice(0, 6)
    : [];

  function selectAddEx(ex) {
    setAddExSelected(ex);
    setAddExSets('3');
    setAddExReps('10');
    setAddExWeight('');
  }

  function confirmAddEx() {
    if (!addExSelected) return;
    const rawWeight = parseFloat(addExWeight);
    const weightLbs = addExWeight && !isNaN(rawWeight)
      ? (metric ? parseFloat(kgToLbs(rawWeight)) : rawWeight)
      : null;
    onAddExercise(addExSelected.id, parseInt(addExSets) || 3, parseInt(addExReps) || 10, weightLbs);
    setAddExOpen(false);
    setAddExSearch('');
    setAddExSelected(null);
    setAddExSets('3');
    setAddExReps('10');
    setAddExWeight('');
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
                const expanded = expandedIdx === i;
                const canEdit = ex.exId !== 'rest_day';
                const hasWeight = isStrength(ex.exId);
                return (
                  <React.Fragment key={i}>
                    {isFirstOfSuperset && (
                      <div className="lw-superset-label">{"⚡ Superset"}</div>
                    )}
                    <div className="lw-ex-item-wrap">
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
                          {canEdit && (
                            <div className="lw-ex-meta">
                              {ex.setsDesc || `${ex.sets}×${ex.reps}`}
                              {ex.weightLbs
                                ? ` · ${metric ? lbsToKg(ex.weightLbs) : ex.weightLbs} ${wLabel}`
                                : ''}
                            </div>
                          )}
                        </div>
                        {canEdit && (
                          <button
                            className={`lw-dots-btn${expanded ? ' active' : ''}`}
                            onClick={(e) => openExpand(e, i, ex)}
                            aria-label="Edit exercise"
                          >
                            {"···"}
                          </button>
                        )}
                      </div>

                      {expanded && (
                        <div className="lw-ex-edit">
                          <div className="lw-ex-edit-fields">
                            <label className="lw-ex-edit-field">
                              <span className="lw-ex-edit-lbl">{"Sets"}</span>
                              <input
                                className="lw-ex-edit-inp"
                                type="number"
                                min="1"
                                max="20"
                                value={editVals.sets}
                                onChange={e => setEditVals(v => ({ ...v, sets: e.target.value }))}
                              />
                            </label>
                            <label className="lw-ex-edit-field">
                              <span className="lw-ex-edit-lbl">{"Reps"}</span>
                              <input
                                className="lw-ex-edit-inp"
                                type="number"
                                min="1"
                                max="100"
                                value={editVals.reps}
                                onChange={e => setEditVals(v => ({ ...v, reps: e.target.value }))}
                              />
                            </label>
                            {hasWeight && (
                              <label className="lw-ex-edit-field">
                                <span className="lw-ex-edit-lbl">{wLabel}</span>
                                <input
                                  className="lw-ex-edit-inp"
                                  type="number"
                                  min="0"
                                  step="2.5"
                                  placeholder="0"
                                  value={editVals.weight}
                                  onChange={e => setEditVals(v => ({ ...v, weight: e.target.value }))}
                                />
                              </label>
                            )}
                          </div>
                          <div className="lw-ex-edit-actions">
                            <button className="btn btn-gold btn-sm lw-ex-edit-save" onClick={() => saveEdit(i)}>
                              {"Save"}
                            </button>
                            <button
                              className="lw-ex-edit-remove"
                              onClick={() => handleRemove(i)}
                            >
                              {"Remove"}
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  </React.Fragment>
                );
              })}

              {/* ── Add Exercise ── */}
              <div className="lw-add-ex-wrap">
                {!addExOpen ? (
                  <button
                    className="lw-add-ex-btn"
                    onClick={() => { setAddExOpen(true); setExpandedIdx(null); }}
                  >
                    {"+ Add Exercise"}
                  </button>
                ) : (
                  <div className="lw-add-ex-panel">
                    {!addExSelected ? (
                      <>
                        <div className="lw-add-ex-search-row">
                          <input
                            className="lw-add-ex-input"
                            type="text"
                            placeholder="Search exercises…"
                            autoFocus
                            value={addExSearch}
                            onChange={e => setAddExSearch(e.target.value)}
                          />
                          <button
                            className="lw-add-ex-cancel"
                            onClick={() => { setAddExOpen(false); setAddExSearch(''); }}
                          >
                            {"✕"}
                          </button>
                        </div>
                        {addExSearch.length >= 2 && addExResults.length === 0 && (
                          <div className="lw-add-ex-empty">{"No exercises found"}</div>
                        )}
                        {addExResults.map(ex => (
                          <button key={ex.id} className="lw-add-ex-result" onClick={() => selectAddEx(ex)}>
                            <span className="lw-add-ex-result-name">{ex.name}</span>
                            <span className="lw-add-ex-result-cat">{ex.category}</span>
                          </button>
                        ))}
                      </>
                    ) : (
                      <div className="lw-add-ex-config">
                        <div className="lw-add-ex-config-name">
                          <span>{addExSelected.name}</span>
                          <button
                            className="lw-add-ex-cancel"
                            onClick={() => setAddExSelected(null)}
                          >
                            {"←"}
                          </button>
                        </div>
                        <div className="lw-ex-edit-fields">
                          <label className="lw-ex-edit-field">
                            <span className="lw-ex-edit-lbl">{"Sets"}</span>
                            <input
                              className="lw-ex-edit-inp"
                              type="number"
                              min="1"
                              max="20"
                              value={addExSets}
                              onChange={e => setAddExSets(e.target.value)}
                            />
                          </label>
                          <label className="lw-ex-edit-field">
                            <span className="lw-ex-edit-lbl">{"Reps"}</span>
                            <input
                              className="lw-ex-edit-inp"
                              type="number"
                              min="1"
                              max="100"
                              value={addExReps}
                              onChange={e => setAddExReps(e.target.value)}
                            />
                          </label>
                          {isStrength(addExSelected.id) && (
                            <label className="lw-ex-edit-field">
                              <span className="lw-ex-edit-lbl">{wLabel}</span>
                              <input
                                className="lw-ex-edit-inp"
                                type="number"
                                min="0"
                                step="2.5"
                                placeholder="0"
                                value={addExWeight}
                                onChange={e => setAddExWeight(e.target.value)}
                              />
                            </label>
                          )}
                        </div>
                        <button className="btn btn-gold btn-sm" style={{ width: '100%', marginTop: 10 }} onClick={confirmAddEx}>
                          {"Add to Workout"}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
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
