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

  // Weight display helpers: stored internally as lbs, displayed in user's unit
  const dispW = (lbs) => lbs ? (metric ? String(lbsToKg(lbs)) : String(lbs)) : '';
  const fromW = (val) => val ? (metric ? parseFloat(kgToLbs(parseFloat(val))) : parseFloat(val)) : null;

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

  function toggleExpand(e, i) {
    e.stopPropagation();
    setExpandedIdx(prev => prev === i ? null : i);
    setAddExOpen(false);
  }

  function updateExField(i, field, val) {
    onUpdateExercise(i, { [field]: val });
  }

  function updateExtraRow(i, ri, field, val) {
    const rr = [...(exercises[i].extraRows || [])];
    rr[ri] = { ...rr[ri], [field]: val };
    onUpdateExercise(i, { extraRows: rr });
  }

  function removeExtraRow(i, ri) {
    const rr = (exercises[i].extraRows || []).filter((_, j) => j !== ri);
    onUpdateExercise(i, { extraRows: rr });
  }

  function addExtraRow(i) {
    const ex = exercises[i];
    const rr = [...(ex.extraRows || []), {
      sets: ex.sets || '',
      reps: ex.reps || '',
      weightLbs: ex.weightLbs || '',
    }];
    onUpdateExercise(i, { extraRows: rr });
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
    onAddExercise(addExSelected.id, addExSets, addExReps, fromW(addExWeight));
    setAddExOpen(false);
    setAddExSearch('');
    setAddExSelected(null);
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
                const isCardioOrFlex = ex.category === 'cardio' || ex.category === 'flexibility';
                const showW = !isCardioOrFlex;
                const noSets = ex.noSets;
                const rowLabel = isCardioOrFlex ? 'I' : 'S';

                return (
                  <React.Fragment key={i}>
                    {isFirstOfSuperset && (
                      <div className="lw-superset-label">{"⚡ Superset"}</div>
                    )}
                    <div className="lw-ex-item-wrap">
                      {/* ── Collapsed row ── */}
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
                                ? ` · ${dispW(ex.weightLbs)} ${wLabel}`
                                : ''}
                            </div>
                          )}
                        </div>
                        {canEdit && (
                          <button
                            className={`lw-dots-btn${expanded ? ' active' : ''}`}
                            onClick={(e) => toggleExpand(e, i)}
                            aria-label="Edit exercise"
                          >
                            {"···"}
                          </button>
                        )}
                      </div>

                      {/* ── Inline edit panel ── */}
                      {expanded && (
                        <div className="lw-ex-edit">
                          {/* Primary row (S1 / I1) */}
                          <div className="lw-ex-edit-row">
                            <span className="lw-ex-edit-row-lbl">{`${rowLabel}1`}</span>
                            {!noSets && (
                              <div className="lw-ex-edit-cell">
                                <span className="lw-ex-edit-col-hdr">{"Sets"}</span>
                                <input
                                  className="lw-ex-edit-inp"
                                  type="text"
                                  inputMode="decimal"
                                  value={ex.sets === 0 || ex.sets === '' ? '' : ex.sets || ''}
                                  onChange={e => updateExField(i, 'sets', e.target.value)}
                                />
                              </div>
                            )}
                            <div className="lw-ex-edit-cell">
                              <span className="lw-ex-edit-col-hdr">{"Reps"}</span>
                              <input
                                className="lw-ex-edit-inp"
                                type="text"
                                inputMode="decimal"
                                value={ex.reps === 0 || ex.reps === '' ? '' : ex.reps || ''}
                                onChange={e => updateExField(i, 'reps', e.target.value)}
                              />
                            </div>
                            {showW && (
                              <div className="lw-ex-edit-cell">
                                <span className="lw-ex-edit-col-hdr">{wLabel}</span>
                                <input
                                  className="lw-ex-edit-inp"
                                  type="text"
                                  inputMode="decimal"
                                  placeholder="—"
                                  value={dispW(ex.weightLbs)}
                                  onChange={e => updateExField(i, 'weightLbs', fromW(e.target.value))}
                                />
                              </div>
                            )}
                            <div className="lw-ex-edit-spacer" />
                          </div>

                          {/* Extra rows (S2, S3…) */}
                          {(ex.extraRows || []).map((row, ri) => (
                            <div key={ri} className="lw-ex-edit-row lw-ex-edit-row-extra">
                              <span className="lw-ex-edit-row-lbl">{`${rowLabel}${ri + 2}`}</span>
                              {!noSets && (
                                <div className="lw-ex-edit-cell">
                                  <input
                                    className="lw-ex-edit-inp"
                                    type="text"
                                    inputMode="decimal"
                                    placeholder="Sets"
                                    value={row.sets || ''}
                                    onChange={e => updateExtraRow(i, ri, 'sets', e.target.value)}
                                  />
                                </div>
                              )}
                              <div className="lw-ex-edit-cell">
                                <input
                                  className="lw-ex-edit-inp"
                                  type="text"
                                  inputMode="decimal"
                                  placeholder="Reps"
                                  value={row.reps || ''}
                                  onChange={e => updateExtraRow(i, ri, 'reps', e.target.value)}
                                />
                              </div>
                              {showW && (
                                <div className="lw-ex-edit-cell">
                                  <input
                                    className="lw-ex-edit-inp"
                                    type="text"
                                    inputMode="decimal"
                                    placeholder={wLabel}
                                    value={dispW(row.weightLbs)}
                                    onChange={e => updateExtraRow(i, ri, 'weightLbs', fromW(e.target.value))}
                                  />
                                </div>
                              )}
                              <button
                                className="lw-ex-edit-row-remove"
                                onClick={() => removeExtraRow(i, ri)}
                                aria-label="Remove row"
                              >
                                {"✕"}
                              </button>
                            </div>
                          ))}

                          {/* Add row */}
                          <button className="lw-add-row-btn" onClick={() => addExtraRow(i)}>
                            {"＋ Add Row"}{isCardioOrFlex ? " (e.g. interval)" : " (e.g. progressive weight)"}
                          </button>

                          {/* Actions */}
                          <div className="lw-ex-edit-actions">
                            <button className="lw-ex-edit-remove-ex" onClick={() => { onRemoveExercise(i); setExpandedIdx(null); }}>
                              {"Remove Exercise"}
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={() => setExpandedIdx(null)}>
                              {"Done ✓"}
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
                          <button className="lw-add-ex-cancel" onClick={() => setAddExSelected(null)}>{"←"}</button>
                        </div>
                        {(() => {
                          const selCat = (addExSelected.category || '').toLowerCase();
                          const selIsCardioFlex = selCat === 'cardio' || selCat === 'flexibility';
                          const selShowW = !selIsCardioFlex;
                          return (
                            <div className="lw-ex-edit-row" style={{ marginBottom: 10 }}>
                              <div className="lw-ex-edit-cell">
                                <span className="lw-ex-edit-col-hdr">{"Sets"}</span>
                                <input className="lw-ex-edit-inp" type="text" inputMode="decimal" value={addExSets} onChange={e => setAddExSets(e.target.value)} />
                              </div>
                              <div className="lw-ex-edit-cell">
                                <span className="lw-ex-edit-col-hdr">{"Reps"}</span>
                                <input className="lw-ex-edit-inp" type="text" inputMode="decimal" value={addExReps} onChange={e => setAddExReps(e.target.value)} />
                              </div>
                              {selShowW && (
                                <div className="lw-ex-edit-cell">
                                  <span className="lw-ex-edit-col-hdr">{wLabel}</span>
                                  <input className="lw-ex-edit-inp" type="text" inputMode="decimal" placeholder="—" value={addExWeight} onChange={e => setAddExWeight(e.target.value)} />
                                </div>
                              )}
                              <div className="lw-ex-edit-spacer" />
                            </div>
                          );
                        })()}
                        <button className="btn btn-gold btn-sm" style={{ width: '100%' }} onClick={confirmAddEx}>
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
