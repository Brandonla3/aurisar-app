import { describe, it, expect } from 'vitest';
import { entryTime } from '../logEntryTime';

/**
 * The quick-log carryover window is two minutes wide, so it is entirely at the
 * mercy of how precisely a log entry's timestamp is recovered. Reading only
 * `dateKey` put every past entry at midnight, which made an evening lift look
 * ~18 hours old and silently disabled carryover altogether.
 */

const AT = (dateKey, time) => entryTime({ dateKey, time });
const midnight = dateKey => new Date(dateKey).getTime();

describe('entryTime', () => {
  it('prefers the explicit loggedAt stamp', () => {
    expect(entryTime({ loggedAt: 1700000000000, dateKey: '2026-07-21' })).toBe(1700000000000);
  });

  it('recovers the hour from a 12-hour clock string on legacy entries', () => {
    const base = midnight('2026-07-21');
    expect(AT('2026-07-21', '06:14 PM')).toBe(base + (18 * 60 + 14) * 60000);
    expect(AT('2026-07-21', '07:30 AM')).toBe(base + (7 * 60 + 30) * 60000);
  });

  it('treats 12 AM as midnight and 12 PM as noon', () => {
    const base = midnight('2026-07-21');
    expect(AT('2026-07-21', '12:00 AM')).toBe(base);
    expect(AT('2026-07-21', '12:00 PM')).toBe(base + 12 * 60 * 60000);
  });

  it('handles a 24-hour locale', () => {
    const base = midnight('2026-07-21');
    expect(AT('2026-07-21', '18:14')).toBe(base + (18 * 60 + 14) * 60000);
  });

  it('falls back to midnight rather than discarding an entry with no parsable time', () => {
    expect(AT('2026-07-21', '')).toBe(midnight('2026-07-21'));
    expect(AT('2026-07-21', undefined)).toBe(midnight('2026-07-21'));
  });

  it('returns NaN when there is nothing to work with', () => {
    expect(Number.isNaN(entryTime(null))).toBe(true);
    expect(Number.isNaN(entryTime({}))).toBe(true);
  });

  it('puts two entries logged minutes apart inside the carryover window', () => {
    // The regression: before the fix these both collapsed to midnight and the
    // gap read as 0 only by accident, while a same-session pair logged either
    // side of midnight-relative parsing could read as hours apart.
    const now = Date.now();
    const a = entryTime({ loggedAt: now });
    const b = entryTime({ loggedAt: now - 90 * 1000 });
    expect(a - b).toBeLessThan(2 * 60 * 1000);
  });

  it('puts a legacy evening entry far outside the window, as it should', () => {
    const morning = AT('2026-07-21', '07:30 AM');
    const evening = AT('2026-07-21', '06:14 PM');
    expect(evening - morning).toBeGreaterThan(2 * 60 * 1000);
  });
});
