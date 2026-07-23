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
  // reps doubles as the stored minute count. When the duration is cleared to
  // zero we MUST clear reps too, otherwise a previously-entered minute value
  // stays saved (and scored for XP) and durationDisplay resurfaces it via its
  // legacy fallback. Emit an explicit empty reps at zero.
  patches.push({ field: 'reps', val: sec ? Math.max(1, Math.floor(sec / 60)) : '' });
  return patches;
}

/** Seconds field change → the field patches to apply, in order. */
export function commitSecChange(value, rawSec) {
  const patches = [{ field: '_durSecRaw', val: rawSec }];
  const hhmm = value._durHHMM || (value.durationSec ? secToHHMMSplit(value.durationSec).hhmm : '');
  const sec = combineHHMMSec(hhmm, rawSec);
  patches.push({ field: 'durationSec', val: sec });
  patches.push({ field: 'reps', val: sec ? Math.max(1, Math.floor(sec / 60)) : '' });
  return patches;
}

/** What the duration inputs should display for a given entry. */
export function durationDisplay(value) {
  // Legacy fallback: older entries stored duration only as `reps` minutes.
  // Normalize through secToHHMMSplit so reps:90 shows 01:30, not 00:90.
  const legacy = value.reps ? secToHHMMSplit(Number(value.reps) * 60) : { hhmm: '', sec: '' };
  return {
    hhmm: value._durHHMM !== undefined ? value._durHHMM
      : value.durationSec ? secToHHMMSplit(value.durationSec).hhmm
      : legacy.hhmm,
    sec: value._durSecRaw !== undefined ? String(value._durSecRaw).padStart(2, '0')
      : value.durationSec ? String(secToHHMMSplit(value.durationSec).sec).padStart(2, '0') : '',
  };
}

