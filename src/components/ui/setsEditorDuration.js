import { normalizeHHMM, secToHHMMSplit, combineHHMMSec } from '../../utils/time';

/**
 * Pure logic for SetsEditor's duration pair — separated from the component
 * so the file exports only a component (react-refresh) and so tests can pin
 * the sync without a DOM. See SetsEditor.jsx for the field contract.
 */

// ── Pure commit helpers (exported for tests) ────────────────────────────────

/**
 * HH:MM field blur → the field patches to apply, in order.
 *
 * Note: the workout builder's original expression had an operator-precedence
 * bug — `_durSecRaw || durationSec ? split(durationSec).sec : ""` grouped as
 * `(_durSecRaw || durationSec) ? …` and always re-read the STORED seconds,
 * silently discarding seconds the user had just typed. The quick-log sheet's
 * sibling implementation combined the typed value correctly; this unifies on
 * the correct behavior.
 */
export function commitDurationBlur(value, rawHHMM) {
  const hhmm = normalizeHHMM(rawHHMM);
  const patches = [{ field: '_durHHMM', val: hhmm || undefined }];
  const sec = combineHHMMSec(
    hhmm,
    value._durSecRaw !== undefined && value._durSecRaw !== ''
      ? value._durSecRaw
      : value.durationSec ? secToHHMMSplit(value.durationSec).sec : ''
  );
  patches.push({ field: 'durationSec', val: sec });
  if (sec) patches.push({ field: 'reps', val: Math.max(1, Math.floor(sec / 60)) });
  return patches;
}

/** Seconds field change → the field patches to apply, in order. */
export function commitSecChange(value, rawSec) {
  const patches = [{ field: '_durSecRaw', val: rawSec }];
  const hhmm = value._durHHMM || (value.durationSec ? secToHHMMSplit(value.durationSec).hhmm : '');
  const sec = combineHHMMSec(hhmm, rawSec);
  patches.push({ field: 'durationSec', val: sec });
  if (sec) patches.push({ field: 'reps', val: Math.max(1, Math.floor(sec / 60)) });
  return patches;
}

/** What the duration inputs should display for a given entry. */
export function durationDisplay(value) {
  return {
    hhmm: value._durHHMM !== undefined ? value._durHHMM
      : value.durationSec ? secToHHMMSplit(value.durationSec).hhmm
      : value.reps ? '00:' + String(value.reps).padStart(2, '0') : '',
    sec: value._durSecRaw !== undefined ? String(value._durSecRaw).padStart(2, '0')
      : value.durationSec ? String(secToHHMMSplit(value.durationSec).sec).padStart(2, '0') : '',
  };
}

