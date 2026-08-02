/**
 * fetchResult — the browser twin of netlify/functions/_lib/pgErrors.js.
 *
 * WHY THIS EXISTS. In electronics, a signal being LOW and the wire being CUT
 * both read as zero volts; you fix it with a pull-up resistor so a disconnected
 * input reads a DEFINED value instead of floating. This app had no pull-ups:
 * every `catch { return [] }` made a dead feature indistinguishable from an
 * empty one. That is not a hypothetical — it is why seven user-facing features
 * sat broken in production for months without anyone noticing:
 *
 *   * the entire leaderboard tab raised `relation "profiles" does not exist`
 *     and rendered as an empty leaderboard;
 *   * the notification inbox could never populate and rendered as "no
 *     notifications";
 *   * friend-request accept/reject, MFA recovery, MFA removal, pre-auth
 *     "forgot your email" and phone MFA enrolment all failed silently.
 *
 * So every read returns a DISCRIMINATED result — ok / empty / unavailable —
 * and the UI must draw all three. "Nothing to show" and "I could not ask" stop
 * being the same pixels.
 *
 * TWO AXES, deliberately separate:
 *   permanent  — is this structural (schema/permission) or a passing blip?
 *                Drives how LOUD the UI is. A user on a train must never be
 *                told the feature is broken.
 *   report     — should the developer hear about it? Broader than `permanent`,
 *                because an UNKNOWN error is exactly the thing worth learning
 *                about, while being too uncertain to shout about on screen.
 */

// Mirrors SCHEMA_DRIFT_CODES in netlify/functions/_lib/pgErrors.js. Kept as a
// separate literal on purpose: that module is server-only (it is imported by
// Netlify functions), and bundling it into the browser to share five strings
// would drag serverless plumbing into the client build.
//   PGRST202 no function matches the name/args in the schema cache
//   PGRST204 column not found in the schema cache
//   PGRST205 no table matches
//   42883    undefined_function
//   42P01    undefined_table
//   42703    undefined_column
export const SCHEMA_CODES = new Set([
  'PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01', '42703',
]);

// 42501 insufficient_privilege — a missing GRANT or an RLS policy the caller
// cannot satisfy. Structural: retrying changes nothing.
//
// CALLER CONTRACT: only classify a call the caller is actually ENTITLED to
// make. Signed out, `sb.from('notifications')` legitimately returns 42501
// (migration 17 revoked anon), and calling that "broken" would be a false
// alarm. Verified against the live database — an anon read returns exactly
// `42501 permission denied for table notifications`. Consumers must gate on
// session state first; `useNotifications` does this via its `active` flag.
export const PERMISSION_CODES = new Set(['42501']);

// PGRST301 JWT expired / invalid. Not structural — signing in again fixes it —
// so it must not render as "this feature is broken".
export const AUTH_CODES = new Set(['PGRST301']);

export const KIND = {
  SCHEMA: 'schema',
  PERMISSION: 'permission',
  AUTH: 'auth',
  TRANSIENT: 'transient',
  UNKNOWN: 'unknown',
};

const TRANSIENT_MESSAGE = /failed to fetch|networkerror|network request failed|load failed|timeout|aborted/i;

function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * @param {{code?: string, message?: string, status?: number}|Error|null} error
 * @returns {{kind: string, code: string|null, permanent: boolean, report: boolean}}
 */
export function classifyError(error) {
  if (!error) return { kind: null, code: null, permanent: false, report: false };

  const code = error.code != null ? String(error.code) : null;
  const message = String(error.message || '');
  const status = Number(error.status || error.statusCode || 0);

  if (code && SCHEMA_CODES.has(code)) {
    return { kind: KIND.SCHEMA, code, permanent: true, report: true };
  }
  if (code && PERMISSION_CODES.has(code)) {
    return { kind: KIND.PERMISSION, code, permanent: true, report: true };
  }
  if (code && AUTH_CODES.has(code)) {
    // Recoverable by re-authenticating; noisy to report and not the user's fault.
    return { kind: KIND.AUTH, code, permanent: false, report: false };
  }
  if (isOffline() || TRANSIENT_MESSAGE.test(message) || status >= 500 || status === 408) {
    return { kind: KIND.TRANSIENT, code, permanent: false, report: false };
  }
  // Unknown: too uncertain to shout about on screen, too interesting to drop.
  // Misreading a permanent failure as transient is the mode that recreates the
  // original bug, so the default leans toward telling the developer.
  return { kind: KIND.UNKNOWN, code, permanent: false, report: true };
}

export const STATUS = { OK: 'ok', EMPTY: 'empty', UNAVAILABLE: 'unavailable' };

export function ok(rows) {
  return { status: STATUS.OK, rows, checkedAt: new Date().toISOString() };
}

/** A PROVEN empty: the query succeeded and returned nothing. */
export function empty() {
  return { status: STATUS.EMPTY, rows: [], checkedAt: new Date().toISOString() };
}

export function unavailable(error, { surface } = {}) {
  const c = classifyError(error);
  return {
    status: STATUS.UNAVAILABLE,
    rows: [],
    checkedAt: new Date().toISOString(),
    surface: surface || null,
    ...c,
    message: String((error && error.message) || 'unknown error'),
  };
}

/**
 * Normalise a supabase-js `{ data, error }` pair into a discriminated result.
 * The whole point is that this NEVER collapses an error into an empty array.
 */
export function toResult({ data, error }, { surface } = {}) {
  if (error) return unavailable(error, { surface });
  const rows = data || [];
  return rows.length === 0 ? empty() : ok(rows);
}

/** True when the UI should render a loud, unmissable broken state. */
export function isBroken(result) {
  return !!result && result.status === STATUS.UNAVAILABLE && result.permanent === true;
}

/** True when the UI should render a calm "can't reach the server" state. */
export function isUnreachable(result) {
  return !!result && result.status === STATUS.UNAVAILABLE && result.permanent !== true;
}
