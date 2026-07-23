import React from 'react';
import { NO_SETS_EX_IDS, RUNNING_EX_ID, HR_ZONES, UI_COLORS } from '../../data/constants';
import { hrRange } from '../../utils/xp';
import { isMetric, lbsToKg, kgToLbs, miToKm, kmToMi, weightLabel, distLabel } from '../../utils/units';
import { normalizeHHMM } from '../../utils/time';
import { commitDurationBlur, commitSecChange, durationDisplay } from './setsEditorDuration';
import { S, FS } from '../../utils/tokens';

/**
 * The one sets/reps/weight — duration/distance/HR editor.
 *
 * This exact field group used to exist three times (workout-builder card,
 * superset accordion, live tracker) plus a fourth sibling in the quick-log
 * sheet, each with its own markup and drifting behavior. All four surfaces
 * now render this component and differ only by the flags below.
 *
 * State contract: fully controlled. `value` is the exercise entry; every
 * change is reported as onField(field, val) — the same field vocabulary the
 * builder already persists (sets, reps, weightLbs, durationSec, _durHHMM,
 * _durSecRaw, distanceMi, hrZone, incline, speed, extraRows).
 *
 * The duration pair keeps the builder's scratch-field semantics VERBATIM:
 * `_durHHMM`/`_durSecRaw` hold the in-progress keystrokes; blur (HH:MM) or
 * change (Sec) normalizes and derives `durationSec` + minute-`reps`. These
 * two commit paths are exported as pure functions so tests can pin them —
 * corrupting this sync corrupts saved workouts.
 */

// ── Component ───────────────────────────────────────────────────────────────

const SetsEditor = React.memo(function SetsEditor({
  exD,                    // catalog entry (category, hasTreadmill, id, …)
  value,                  // the exercise entry being edited
  onField,                // (field, val) => void
  units,
  age = 30,
  variant = 'builder',    // "builder" | "live" | "quicklog" — density class
  valueMode = 'canonical',// "canonical": weightLbs in lbs / distanceMi in mi,
                          //   inputs convert per `units`.
                          // "display": weight+distance passed through raw in
                          //   the user's unit (quick-log stores display units).
  rowsCommitOn = 'blur',  // "blur" (builder/quick-log) | "change" (live)
  distKey = 'distanceMi', // extra-row distance field name ("dist" in quick-log)
  extraWeightMode = 'raw',// "raw" passthrough | "lbs" convert like primary (live)
  showHR = true,          // HR-zone selector (cardio only regardless)
  showTreadmill = true,   // incline/speed pair (treadmill exercises only)
  showPaceBonus = true,   // running pace-bonus hint line
  showDist = true,        // distance field on cardio rows
  onPrimaryBlur,          // optional blur hook (quick-log's ghost comparison)
}) {
  const isC = exD.category === 'cardio';
  const isF = exD.category === 'flexibility';
  const timed = isC || isF;
  const showW = !timed;
  const noSets = NO_SETS_EX_IDS.has(exD.id);
  const isRunning = exD.id === RUNNING_EX_ID;
  const isTread = exD.hasTreadmill || false;
  const metric = isMetric(units);
  const wUnit = weightLabel(units);
  const dUnit = distLabel(units);
  const rowLbl = timed ? 'I' : 'S';

  const canonical = valueMode === 'canonical';
  const dispW = value.weightLbs
    ? canonical && metric ? lbsToKg(value.weightLbs) : value.weightLbs
    : '';
  const dispDist = value.distanceMi
    ? canonical && metric ? String(parseFloat(miToKm(value.distanceMi)).toFixed(2)) : String(value.distanceMi)
    : '';
  const dur = durationDisplay(value);

  const distMiVal = value.distanceMi
    ? canonical ? parseFloat(value.distanceMi) : (metric ? parseFloat(kmToMi(parseFloat(value.distanceMi))) : parseFloat(value.distanceMi))
    : 0;
  const durationMin = parseFloat(value.reps || 0);
  const runPace = isRunning && distMiVal > 0 && durationMin > 0 ? durationMin / distMiVal : null;
  const runBoostPct = runPace ? (runPace <= 8 ? 20 : 5) : 0;

  const commitWeight = raw => {
    if (!canonical) return onField('weightLbs', raw || null);
    const lbs = raw && metric ? kgToLbs(raw) : raw;
    onField('weightLbs', lbs || null);
  };
  const commitDist = raw => {
    if (!canonical) return onField('distanceMi', raw || null);
    const mi = raw && metric ? kmToMi(raw) : raw;
    onField('distanceMi', mi || null);
  };
  const apply = patches => patches.forEach(p => onField(p.field, p.val));

  const rows = value.extraRows || [];
  const setRow = (ri, field, val) => {
    const rr = [...rows];
    rr[ri] = { ...rr[ri], [field]: val };
    onField('extraRows', rr);
  };
  const rowInputProps = (ri, field, mapVal = v => v) =>
    rowsCommitOn === 'change'
      ? { value: rows[ri][field] || '', onChange: e => setRow(ri, field, mapVal(e.target.value)) }
      : { defaultValue: rows[ri][field] || '', onBlur: e => setRow(ri, field, mapVal(e.target.value)) };
  // Live converts extra-row weight like the primary; builder/quick-log store raw.
  const rowWeightProps = ri =>
    extraWeightMode === 'lbs'
      ? {
          value: rows[ri].weightLbs ? (metric ? lbsToKg(rows[ri].weightLbs) : rows[ri].weightLbs) : '',
          onChange: e => {
            const v = e.target.value;
            setRow(ri, 'weightLbs', v ? (metric ? parseFloat(kgToLbs(parseFloat(v))) : parseFloat(v)) : null);
          },
        }
      : rowInputProps(ri, 'weightLbs', v => v || null);

  const addRow = () => {
    const blank = timed
      ? { hhmm: '', sec: '', [distKey]: '', incline: '', speed: '' }
      : { sets: value.sets || '', reps: value.reps || '', weightLbs: value.weightLbs || '' };
    onField('extraRows', [...rows, blank]);
  };
  const removeRow = ri => onField('extraRows', rows.filter((_, j) => j !== ri));

  const cell = (hdr, input) => (
    <div className={'se-cell'}>
      <span className={'se-col-hdr'}>{hdr}</span>
      {input}
    </div>
  );

  return (
    <div className={`se se--${variant}`}>
      {/* ── Primary row ── */}
      <div className={'se-row'}>
        <span className={'se-row-lbl'}>{`${rowLbl}1`}</span>
        {!noSets && cell('Sets', (
          <input className={'se-inp'} type={'text'} inputMode={'decimal'}
            value={value.sets === 0 || value.sets === '' ? '' : value.sets || ''}
            onChange={e => onField('sets', e.target.value)} onBlur={onPrimaryBlur} />
        ))}
        {timed ? (
          <>
            {cell('Duration (HH:MM)', (
              <input className={'se-inp se-inp--wide'} type={'text'} inputMode={'numeric'} placeholder={'00:00'}
                value={dur.hhmm}
                onChange={e => onField('_durHHMM', e.target.value)}
                onBlur={e => { apply(commitDurationBlur(value, e.target.value)); if (onPrimaryBlur) onPrimaryBlur(e); }} />
            ))}
            {cell('Sec', (
              <input className={'se-inp'} type={'number'} min={'0'} max={'59'} placeholder={'00'}
                value={dur.sec}
                onChange={e => apply(commitSecChange(value, e.target.value))} />
            ))}
            {showDist && cell(`Dist (${dUnit})`, (
              <input className={'se-inp'} type={'text'} inputMode={'decimal'} placeholder={'0'}
                value={dispDist}
                onChange={e => commitDist(e.target.value)} onBlur={onPrimaryBlur} />
            ))}
          </>
        ) : (
          <>
            {cell('Reps', (
              <input className={'se-inp'} type={'text'} inputMode={'decimal'}
                value={value.reps === 0 || value.reps === '' ? '' : value.reps || ''}
                onChange={e => onField('reps', e.target.value)} onBlur={onPrimaryBlur} />
            ))}
            {showW && cell(wUnit, (
              <input className={'se-inp'} type={'text'} inputMode={'decimal'} placeholder={'—'}
                step={metric ? '0.5' : '2.5'}
                value={dispW}
                onChange={e => commitWeight(e.target.value)} onBlur={onPrimaryBlur} />
            ))}
          </>
        )}
      </div>

      {/* ── Pace bonus ── */}
      {showPaceBonus && isRunning && runBoostPct > 0 && (
        <div className={'se-pace'} style={{ color: UI_COLORS.warning }}>
          {'⚡ +'}{runBoostPct}{'% pace bonus'}{runBoostPct === 20 ? ' (sub-8 mi!)' : ''}
        </div>
      )}

      {/* ── Treadmill ── */}
      {showTreadmill && isTread && (
        <div className={'se-row se-row--tread'}>
          <span className={'se-row-lbl'} aria-hidden={'true'} />
          {cell('Incline (0.5–15)', (
            <input className={'se-inp'} type={'number'} min={'0.5'} max={'15'} step={'0.5'} placeholder={'—'}
              value={value.incline || ''}
              onChange={e => onField('incline', e.target.value ? parseFloat(e.target.value) : null)} />
          ))}
          {cell('Speed (0.5–15)', (
            <input className={'se-inp'} type={'number'} min={'0.5'} max={'15'} step={'0.5'} placeholder={'—'}
              value={value.speed || ''}
              onChange={e => onField('speed', e.target.value ? parseFloat(e.target.value) : null)} />
          ))}
        </div>
      )}

      {/* ── Extra rows ── */}
      {rows.map((row, ri) => (
        <div key={ri} className={'se-row se-row--extra'}>
          <span className={'se-row-lbl'}>{`${rowLbl}${ri + 2}`}</span>
          {timed ? (
            <>
              <input className={'se-inp se-inp--wide'} type={'text'} inputMode={'numeric'} placeholder={'HH:MM'}
                {...rowInputProps(ri, 'hhmm', v => normalizeHHMM(v))} />
              <input className={'se-inp'} type={'number'} min={'0'} max={'59'} placeholder={'Sec'}
                {...rowInputProps(ri, 'sec')} />
              {showDist && <input className={'se-inp'} type={'text'} inputMode={'decimal'} placeholder={dUnit}
                {...rowInputProps(ri, distKey)} />}
              {isTread && showTreadmill && <input className={'se-inp'} type={'number'} min={'0.5'} max={'15'} step={'0.5'} placeholder={'Inc'}
                {...rowInputProps(ri, 'incline')} />}
              {isTread && showTreadmill && <input className={'se-inp'} type={'number'} min={'0.5'} max={'15'} step={'0.5'} placeholder={'Spd'}
                {...rowInputProps(ri, 'speed')} />}
            </>
          ) : (
            <>
              {!noSets && <input className={'se-inp'} type={'text'} inputMode={'decimal'} placeholder={'Sets'}
                {...rowInputProps(ri, 'sets')} />}
              <input className={'se-inp'} type={'text'} inputMode={'decimal'} placeholder={'Reps'}
                {...rowInputProps(ri, 'reps')} />
              {showW && <input className={'se-inp'} type={'text'} inputMode={'decimal'} placeholder={wUnit}
                {...rowWeightProps(ri)} />}
            </>
          )}
          <button type={'button'} className={'se-row-remove'} aria-label={`Remove row ${ri + 2}`}
            onClick={() => removeRow(ri)}>{'✕'}</button>
        </div>
      ))}

      {/* ── Add row ── */}
      <button type={'button'} className={'se-add-row'} onClick={addRow}>
        {'＋ Add Row ('}{timed ? 'e.g. interval' : 'e.g. progressive weight'}{')'}
      </button>

      {/* ── HR zone ── */}
      {showHR && isC && (
        <div className={'se-hr'}>
          <label style={{ fontSize: FS.sm, color: '#b0a898', marginBottom: S.s4, display: 'block' }}>
            {'Avg Heart Rate Zone '}<span style={{ opacity: .6, fontSize: FS.fs55 }}>{'(optional)'}</span>
          </label>
          <div className={'hr-zone-row'}>
            {HR_ZONES.map(z => {
              const sel = value.hrZone === z.z;
              const range = hrRange(age, z);
              return (
                <button type={'button'} key={z.z} aria-pressed={sel}
                  className={`hr-zone-btn ${sel ? 'sel' : ''}`}
                  style={{ '--zc': z.color, borderColor: sel ? z.color : 'rgba(45,42,36,.2)', background: sel ? `${z.color}22` : 'rgba(45,42,36,.12)' }}
                  onClick={() => onField('hrZone', sel ? null : z.z)}>
                  <span className={'hz-name'} style={{ color: sel ? z.color : '#8a8478' }}>{'Z'}{z.z}{' '}{z.name}</span>
                  <span className={'hz-bpm'} style={{ color: sel ? z.color : '#8a8478' }}>{range.lo}{'–'}{range.hi}</span>
                </button>
              );
            })}
          </div>
          {value.hrZone && (
            <div style={{ fontSize: FS.fs65, color: '#8a8478', fontStyle: 'italic', marginTop: S.s4 }}>
              {HR_ZONES[value.hrZone - 1].desc}
            </div>
          )}
        </div>
      )}
    </div>
  );
});

export default SetsEditor;
