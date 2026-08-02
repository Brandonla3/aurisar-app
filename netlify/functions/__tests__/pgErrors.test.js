import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isSchemaDriftCode, pgError, SCHEMA_DRIFT_CODES } from '../_lib/pgErrors.js';

const resp = (status, ok = false) => ({ status, ok });

describe('isSchemaDriftCode', () => {
  it('recognises the PostgREST and Postgres "object missing" codes', () => {
    // PGRST204 = column not in the schema cache; it belongs here too.
    for (const code of ['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01', '42703']) {
      expect(isSchemaDriftCode(code), code).toBe(true);
    }
  });

  it('does not treat ordinary failures as drift', () => {
    // 23505 unique_violation, 42501 insufficient_privilege, PGRST301 JWT expired
    for (const code of ['23505', '42501', 'PGRST301', '', null, undefined]) {
      expect(isSchemaDriftCode(code), String(code)).toBe(false);
    }
  });
});

describe('pgError', () => {
  it('preserves code and hint from a PostgREST JSON body', () => {
    const body = JSON.stringify({
      code: 'PGRST202',
      message: 'Could not find the function public.claim_notification_emails',
      hint: 'Perhaps you meant to call another function',
    });
    const err = pgError(resp(404), body, 'rpc claim_notification_emails');
    expect(err.code).toBe('PGRST202');
    expect(err.hint).toContain('Perhaps');
    expect(err.status).toBe(404);
    expect(err.schemaDrift).toBe(true);
    expect(err.message).toContain('claim_notification_emails');
  });

  it('flags a transient 5xx as NOT drift', () => {
    const err = pgError(resp(503), 'upstream unavailable', 'rpc x');
    expect(err.schemaDrift).toBe(false);
    expect(err.code).toBeNull();
  });

  it('survives a non-JSON body without throwing', () => {
    const err = pgError(resp(502), '<html>bad gateway</html>', 'rpc x');
    expect(err.schemaDrift).toBe(false);
    expect(err.message).toContain('bad gateway');
  });

  it('is an Error, so existing catch/rethrow paths keep working', () => {
    expect(pgError(resp(500), '', 'rpc x')).toBeInstanceOf(Error);
  });

  it('exports the code set so callers cannot drift from this definition', () => {
    expect(SCHEMA_DRIFT_CODES.has('42P01')).toBe(true);
  });
});

describe('the scheduled functions act on the classification (source guard)', () => {
  const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
  const read = p => readFileSync(ROOT + p, 'utf8');

  for (const [label, path] of [
    ['drain', 'netlify/functions/notifications-drain.js'],
    ['reminder producer', 'netlify/functions/reminders-producer.js'],
  ]) {
    it(`${label} branches on schemaDrift and logs it distinctly`, () => {
      const src = read(path);
      expect(src).toContain('schemaDrift');
      // A greppable marker matters more than the wording: it is what turns
      // "some error in the logs" into "an unapplied migration".
      expect(src).toContain('SCHEMA_DRIFT');
      // The drift branch must come before the generic transient log, or the
      // classification never changes behaviour.
      expect(src.indexOf('SCHEMA_DRIFT')).toBeLessThan(src.indexOf('(transient)'));
    });
  }

  it('the drain handles drift on the per-row RPC too, not just the claim', () => {
    // should_deliver_email drift is just as permanent as claim drift and hits
    // every remaining row identically; treating it as an ordinary row error
    // re-queued the batch and repeated it every 5 minutes with no marker.
    const src = read('netlify/functions/notifications-drain.js');
    const rowCatch = src.slice(src.indexOf('} catch (e) {', src.indexOf('for (const row of rows)')));
    expect(rowCatch).toContain('e.schemaDrift');
    expect(rowCatch).toContain('driftMessage');
    expect(rowCatch).toContain('503');
  });

  it('does not name a specific migration file in the drift message', () => {
    // The same codes fire for a missing object AND for an argument-name
    // mismatch against an existing function; pointing at one file misleads.
    const src = read('netlify/functions/notifications-drain.js');
    expect(src).not.toContain('apply scripts/security/17-notifications.sql');
  });

  it('both use the shared classifier rather than a local copy of the codes', () => {
    for (const path of [
      'netlify/functions/notifications-drain.js',
      'netlify/functions/reminders-producer.js',
    ]) {
      const src = read(path);
      expect(src).toContain('_lib/pgErrors.js');
      expect(src, 'codes must live in one place').not.toContain('PGRST202');
    }
  });
});
