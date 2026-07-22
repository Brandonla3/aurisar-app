/**
 * When a log entry was recorded, in ms since epoch.
 *
 * Entries written from the current build carry `loggedAt`. Anything logged
 * before that field existed has only `dateKey` (a date, so it parses as
 * midnight) and `time`, a localised "06:14 PM" string.
 *
 * Reading `dateKey` alone put every past entry at midnight, which made an
 * evening lift look ~18 hours old. That silently disabled the quick-log
 * carryover window — two minutes wide, so it could never open — and skewed
 * the ghost's "days ago" for same-day entries. Hence the recombination below.
 *
 * Lives in its own module rather than beside the component that uses it so
 * it stays unit-testable without exporting non-components from a .jsx file.
 */
export function entryTime(e) {
  if (!e) return NaN;
  if (Number.isFinite(e.loggedAt)) return e.loggedAt;
  if (!e.dateKey) return NaN;

  const base = new Date(e.dateKey).getTime();
  if (!Number.isFinite(base)) return NaN;

  // "6:14 PM" / "18:14" — locale-dependent, so parse defensively and treat a
  // failure as midnight rather than discarding the entry entirely.
  const m = /(\d{1,2}):(\d{2})\s*([AaPp])?/.exec(e.time || '');
  if (!m) return base;

  const rawHour = parseInt(m[1], 10);
  const meridiem = m[3];
  let h;
  if (meridiem) {
    h = rawHour % 12;                       // 12 AM → 0, 12 PM → 12
    if (/[Pp]/.test(meridiem)) h += 12;
  } else {
    h = rawHour;                            // already 24-hour
  }
  return base + (h * 60 + parseInt(m[2], 10)) * 60000;
}
