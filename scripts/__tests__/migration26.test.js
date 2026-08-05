import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Migration 26 exists because three security-relevant RPCs ran in production
 * for months with no tracked source — and reading their live bodies revealed
 * real defects (enumeration oracle, seedable-PRNG OTP, unlimited code
 * guesses, an RLS policy exposing code hashes to brute-force). These guards
 * pin the fixes so a later CREATE OR REPLACE can't quietly regress them.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const sql = readFileSync(
  ROOT + 'scripts/security/26-declare-and-harden-untracked-auth-rpcs.sql',
  'utf8'
);

describe('migration 26 — the three RPCs are declared in tracked SQL', () => {
  it('declares all three functions and the table that backs the phone pair', () => {
    for (const obj of [
      'FUNCTION public.lookup_email_by_private_id',
      'FUNCTION public.send_phone_otp',
      'FUNCTION public.verify_phone_otp',
      'TABLE IF NOT EXISTS public.phone_verification_codes',
    ]) {
      expect(sql).toContain(obj);
    }
  });

  it('pins grants: lookup is pre-auth (anon), the phone pair is not', () => {
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.lookup_email_by_private_id\(text\) TO anon, authenticated/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.send_phone_otp\(text, text\) TO authenticated;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.verify_phone_otp\(text, text\) TO authenticated;/);
    // The phone pair must never gain an anon grant.
    expect(sql).not.toMatch(/send_phone_otp\(text, text\) TO anon/);
    expect(sql).not.toMatch(/verify_phone_otp\(text, text\) TO anon/);
  });
});

describe('defect 1 — lookup_email_by_private_id enumeration oracle', () => {
  it('rate-limits inside the function (the only perimeter a direct PostgREST call has)', () => {
    expect(sql).toMatch(/check_anon_rate_limit\('forgot_email'/);
    // Per-IP: derived from PostgREST's request headers, first x-forwarded-for hop.
    expect(sql).toContain("'x-forwarded-for'");
  });

  it('returns ONE not-found message — never the old found-but-no-email variant', () => {
    expect(sql).toContain('No account matches that Private ID');
    // The two messages that made it an oracle:
    expect(sql).not.toContain('No account found with that Private ID');
    expect(sql).not.toContain('Account found but no email on file');
  });
});

describe('defect 2 — send_phone_otp', () => {
  it('generates the code with pgcrypto, not the seedable random()', () => {
    expect(sql).toContain('gen_random_bytes');
    expect(sql).not.toMatch(/floor\(random\(\)/);
  });

  it('rate-limits sends per user before touching Twilio', () => {
    expect(sql).toMatch(/check_anon_rate_limit\('phone_otp_send', auth\.uid\(\)::text\)/);
    // The limit check must come before the SMS dispatch.
    expect(sql.indexOf("check_anon_rate_limit('phone_otp_send'"))
      .toBeLessThan(sql.indexOf('api.twilio.com'));
  });
});

describe('defect 3 — verify_phone_otp brute-force', () => {
  it('adds the attempts column and burns the code after 5 wrong guesses', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0/);
    expect(sql).toMatch(/attempts \+ 1 >= 5/);
  });

  it('fetches the newest active code THEN compares — selecting by hash cannot count misses', () => {
    const body = sql.slice(sql.indexOf('verify_phone_otp'), sql.indexOf('-- 4. Grants'));
    expect(body).toMatch(/ORDER BY created_at DESC/);
    expect(body).toMatch(/code_row\.code_hash <> input_hash/);
    // The active-row lookup must not filter by code_hash.
    const select = body.slice(body.indexOf('SELECT * INTO code_row'), body.indexOf('LIMIT 1'));
    expect(select).not.toContain('code_hash');
  });
});

describe('defect 4 — code_hash exposure via RLS', () => {
  it('drops the own-read policy that let a session holder brute-force the hash offline', () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS phone_codes_own_read ON public\.phone_verification_codes/);
  });
});
