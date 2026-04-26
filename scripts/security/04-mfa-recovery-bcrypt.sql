-- =============================================================================
-- M-5 (server) — Migrate MFA recovery codes to bcrypt-hashed storage
-- =============================================================================
-- v2 corrections (2026-04-26):
--   - matched_id is uuid (mfa_recovery_codes.id is uuid, not bigint)
--   - the table has BOTH `used` boolean and `used_at` timestamptz; consume
--     marks BOTH so existing app reads of `used` keep working
--   - the row filter for "still valid" is `used = false AND used_at IS NULL`
--     (match either flag for safety)
--
-- Strategy:
--   * Client sends PLAINTEXT codes via the new `store_mfa_recovery_codes`
--     signature (`code_plaintexts text[]`).
--   * The server bcrypt-hashes each code (cost 12 ≈ 250 ms) before insert
--     and tags algo='bcrypt'.
--   * Verification (`use_mfa_recovery_code`) tries bcrypt rows first, then
--     falls back to legacy unsalted SHA-256 hex rows so existing recovery
--     codes still verify.
-- =============================================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Add an algorithm marker so we can tell legacy SHA-256 rows from bcrypt.
ALTER TABLE public.mfa_recovery_codes
  ADD COLUMN IF NOT EXISTS algo text NOT NULL DEFAULT 'sha256';

-- 2. New writer: accepts plaintext codes and bcrypt-hashes them server-side.
DROP FUNCTION IF EXISTS public.store_mfa_recovery_codes(text[]);
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

  -- Regenerate is full-replace.
  DELETE FROM public.mfa_recovery_codes WHERE user_id = auth.uid();

  IF code_plaintexts IS NULL OR cardinality(code_plaintexts) = 0 THEN
    RETURN;
  END IF;

  FOREACH c IN ARRAY code_plaintexts LOOP
    INSERT INTO public.mfa_recovery_codes (user_id, code_hash, algo, used, used_at)
    VALUES (
      auth.uid(),
      crypt(c, gen_salt('bf', 12)),
      'bcrypt',
      false,
      NULL
    );
  END LOOP;
END
$$;

-- Keep the legacy signature callable for one release so a stale client that
-- sends pre-hashed SHA-256 doesn't 500.
DROP FUNCTION IF EXISTS public.store_mfa_recovery_codes_legacy(text[]);
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
    INSERT INTO public.mfa_recovery_codes (user_id, code_hash, algo, used, used_at)
    VALUES (auth.uid(), h, 'sha256', false, NULL);
  END LOOP;
END
$$;

REVOKE ALL    ON FUNCTION public.store_mfa_recovery_codes(text[])         FROM PUBLIC;
REVOKE ALL    ON FUNCTION public.store_mfa_recovery_codes_legacy(text[])  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.store_mfa_recovery_codes(text[])           TO authenticated;
GRANT EXECUTE ON FUNCTION public.store_mfa_recovery_codes_legacy(text[])    TO authenticated;

-- 3. Updated verifier: accepts plaintext, tries bcrypt rows first, then falls
--    back to legacy SHA-256 hex. Marks BOTH `used = true` AND `used_at = now()`
--    so existing app code that filters on either flag still works.
DROP FUNCTION IF EXISTS public.use_mfa_recovery_code(text);
CREATE OR REPLACE FUNCTION public.use_mfa_recovery_code(
  code_plaintext text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, auth
AS $$
DECLARE
  matched_id uuid;
  legacy_hex text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;

  -- Try bcrypt rows: re-hash by extracting the salt from each candidate row.
  SELECT id INTO matched_id
  FROM public.mfa_recovery_codes
  WHERE user_id = auth.uid()
    AND used = false
    AND used_at IS NULL
    AND algo = 'bcrypt'
    AND code_hash = crypt(code_plaintext, code_hash)
  LIMIT 1;

  IF matched_id IS NULL THEN
    -- Legacy SHA-256 fallback (matches Phase-1 client format: hex lowercase
    -- of the uppercase plaintext).
    legacy_hex := encode(digest(upper(code_plaintext), 'sha256'), 'hex');
    SELECT id INTO matched_id
    FROM public.mfa_recovery_codes
    WHERE user_id = auth.uid()
      AND used = false
      AND used_at IS NULL
      AND algo = 'sha256'
      AND code_hash = legacy_hex
    LIMIT 1;
  END IF;

  IF matched_id IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.mfa_recovery_codes
     SET used    = true,
         used_at = now()
   WHERE id = matched_id;

  -- Recovery-code success unenrolls the user's TOTP factor (matches existing
  -- behaviour) — the user can re-enroll afterwards.
  PERFORM auth.mfa_unenroll(f.id)
  FROM auth.mfa_factors f
  WHERE f.user_id    = auth.uid()
    AND f.factor_type = 'totp'
    AND f.status      = 'verified';

  RETURN true;
END
$$;

REVOKE ALL    ON FUNCTION public.use_mfa_recovery_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.use_mfa_recovery_code(text) TO authenticated;

-- 4. Read-only counter — defensive rebuild matching the new dual-flag filter.
DROP FUNCTION IF EXISTS public.count_recovery_codes_remaining();
CREATE OR REPLACE FUNCTION public.count_recovery_codes_remaining()
RETURNS int
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT count(*)::int
  FROM public.mfa_recovery_codes
  WHERE user_id = auth.uid()
    AND used     = false
    AND used_at IS NULL;
$$;
REVOKE ALL    ON FUNCTION public.count_recovery_codes_remaining() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_recovery_codes_remaining() TO authenticated;

COMMIT;

-- =============================================================================
-- Smoke tests after applying:
-- =============================================================================
-- Algo column exists?
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='mfa_recovery_codes' AND column_name='algo';
--
-- Functions present with the new signatures?
--   SELECT proname, pg_get_function_identity_arguments(oid) AS args
--   FROM pg_proc WHERE proname IN
--     ('store_mfa_recovery_codes','use_mfa_recovery_code','count_recovery_codes_remaining',
--      'store_mfa_recovery_codes_legacy');
--
-- A live-user check (paste into the SQL Editor while signed in as the user):
--   SELECT public.count_recovery_codes_remaining();
--   → returns 0..10 (whatever the user has).
-- =============================================================================
