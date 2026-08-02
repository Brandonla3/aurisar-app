/**
 * Classify PostgREST / Postgres error responses.
 *
 * The distinction that matters operationally is "the schema is not what this
 * code expects" versus "something went wrong this time". The first is
 * permanent until a human applies SQL and will recur on every invocation; the
 * second is worth retrying. Collapsing a PostgREST error body into a status
 * string erases that difference, which is exactly how migrations 17-20 being
 * unapplied looked identical to noise in the logs.
 */

//   PGRST202  no function matches the name/arguments in the schema cache
//   PGRST204  column not found in the schema cache
//   PGRST205  no table matches
//   42883     undefined_function
//   42P01     undefined_table
//   42703     undefined_column
//
// NOTE: these mean "the database does not have what this code asked for". That
// is USUALLY an unapplied migration, but PGRST202 also fires when the argument
// NAMES or types don't match an existing function — i.e. a caller bug. Log the
// code and hint and let a human decide; do not assert a specific migration file.
export const SCHEMA_DRIFT_CODES = new Set([
  "PGRST202",
  "PGRST204",
  "PGRST205",
  "42883",
  "42P01",
  "42703",
]);

/** @param {string|null|undefined} code */
export function isSchemaDriftCode(code) {
  return !!code && SCHEMA_DRIFT_CODES.has(code);
}

/**
 * Build an Error that keeps the PostgREST body's `code`/`hint` intact.
 * @param {Response} res    the failed fetch Response
 * @param {string} raw      the response body text
 * @param {string} label    what was being called, for the message
 */
export function pgError(res, raw, label) {
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    /* not JSON — keep the raw text */
  }
  const err = new Error(`${label} failed: ${res.status} ${parsed?.message || raw}`.trim());
  err.status = res.status;
  err.code = parsed?.code || null;
  err.hint = parsed?.hint || null;
  err.schemaDrift = isSchemaDriftCode(err.code);
  return err;
}
