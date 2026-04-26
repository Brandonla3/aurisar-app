-- =============================================================================
-- M-5 (server) — Migrate MFA recovery codes to bcrypt-hashed storage
-- =============================================================================
-- Current state (per the audit):
--   * Client SHA-256 hashes the plaintext recovery code and sends the hex
--     digest as `code_hashes` to `store_mfa_recovery_codes`.
--   * Verification (`use_mfa_recovery_code`) hashes the user-supplied code
--     and compares. Unsalted SHA-256 → 80-bit (post Phase-1) keyspace is
--     brute-forceable if the DB ever leaks.
--
-- This migration moves the trust boundary to the server: the client sends
-- PLAINTEXT codes (still over TLS), the server bcrypt-hashes them with a
-- per-row salt before insert, and `use_mfa_recovery_code` does a constant-
-- time bcrypt compare. Old rows (SHA-256 hex) are still verifiable via a
-- legacy fallback so existing users aren't locked out.
--
-- Requires the `pgcrypto` extension (Supabase ships with it enabled).
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Schema additions to `mfa_recovery_codes` (assumes the existing table is
--    `public.mfa_recovery_codes` with columns user_id uuid, code_hash text,
--    used_at timestamptz). Add an algorithm marker so we can tell legacy
--    SHA-256 rows from bcrypt rows during the cutover window.
ALTER TABLE public.mfa_recovery_codes
  ADD COLUMN IF NOT EXISTS algo text NOT NULL DEFAULT 'sha256';

-- 2. New writer: accepts plaintext codes and bcrypt-hashes them server-side.
--    Replaces the existing `store_mfa_recovery_codes(code_hashes text[])`.
CREATE OR REPLACE FUNCTION public.store_mfa_recovery_codes(
  code_plaintexts text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  c text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- Always wipe existing codes for this user — regenerate is full-replace.
  DELETE FROM public.mfa_recovery_codes WHERE user_id = auth.uid();

  IF code_plaintexts IS NULL OR cardinality(code_plaintexts) = 0 THEN
    RETURN;
  END IF;

  FOREACH c IN ARRAY code_plaintexts LOOP
    INSERT INTO public.mfa_recovery_codes (user_id, code_hash, algo, used_at)
    VALUES (
      auth.uid(),
      crypt(c, gen_salt('bf', 12)),  -- bcrypt cost 12 ≈ 250 ms on a small CPU
      'bcrypt',
      NULL
    );
  END LOOP;
END
$$;

-- Keep the legacy signature (`code_hashes text[]`) callable for one release,
-- so a stale client doesn't 500 in the middle of a deploy. The legacy entry
-- stores the hash as the previous SHA-256 hex with `algo='sha256'`.
CREATE OR REPLACE FUNCTION public.store_mfa_recovery_codes_legacy(
  code_hashes text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  h text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  DELETE FROM public.mfa_recovery_codes WHERE user_id = auth.uid();
  IF code_hashes IS NULL OR cardinality(code_hashes) = 0 THEN
    RETURN;
  END IF;
  FOREACH h IN ARRAY code_hashes LOOP
    INSERT INTO public.mfa_recovery_codes (user_id, code_hash, algo)
    VALUES (auth.uid(), h, 'sha256');
  END LOOP;
END
$$;

REVOKE ALL ON FUNCTION public.store_mfa_recovery_codes(text[])         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.store_mfa_recovery_codes_legacy(text[])  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_mfa_recovery_codes(text[])        TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_mfa_recovery_codes_legacy(text[]) TO authenticated;

-- 3. Updated verifier: accepts plaintext, tries bcrypt rows first, then falls
--    back to legacy SHA-256 (uppercased, hex). Marks the row used and
--    unenrolls the TOTP factor on success.
CREATE OR REPLACE FUNCTION public.use_mfa_recovery_code(
  code_plaintext text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE
  matched_id  bigint;
  legacy_hex  text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- Try bcrypt rows: re-hash by extracting the salt from each candidate row.
  SELECT id INTO matched_id
  FROM public.mfa_recovery_codes
  WHERE user_id = auth.uid()
    AND used_at IS NULL
    AND algo = 'bcrypt'
    AND code_hash = crypt(code_plaintext, code_hash)
  LIMIT 1;

  IF matched_id IS NULL THEN
    -- Legacy SHA-256 fallback (matches Phase-1 client format: hex lowercase).
    legacy_hex := encode(digest(upper(code_plaintext), 'sha256'), 'hex');
    SELECT id INTO matched_id
    FROM public.mfa_recovery_codes
    WHERE user_id = auth.uid()
      AND used_at IS NULL
      AND algo = 'sha256'
      AND code_hash = legacy_hex
    LIMIT 1;
  END IF;

  IF matched_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.mfa_recovery_codes
     SET used_at = now()
   WHERE id = matched_id;

  -- Recovery-code success unenrolls the user's TOTP factor (matches existing
  -- behaviour) — the user can re-enroll afterwards.
  PERFORM auth.mfa_unenroll(f.id)
  FROM auth.mfa_factors f
  WHERE f.user_id = auth.uid()
    AND f.factor_type = 'totp'
    AND f.status = 'verified';

  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.use_mfa_recovery_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.use_mfa_recovery_code(text) TO authenticated;

-- 4. Read-only counter (already exists, but rebuild defensively).
CREATE OR REPLACE FUNCTION public.count_recovery_codes_remaining()
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM public.mfa_recovery_codes
  WHERE user_id = auth.uid() AND used_at IS NULL;
$$;
REVOKE ALL ON FUNCTION public.count_recovery_codes_remaining() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_recovery_codes_remaining() TO authenticated;

COMMIT;

-- =============================================================================
-- After this migration, the client should send PLAINTEXT codes. The Phase-1
-- client still pre-hashes with SHA-256 — that's fine because the legacy
-- function (`store_mfa_recovery_codes_legacy`) still accepts hash arrays.
-- Phase 3 client migration: have App.js call `store_mfa_recovery_codes`
-- (note: NEW signature) with the plaintext codes array instead of the
-- pre-hashed list. Until that ships, things keep working.
-- =============================================================================
