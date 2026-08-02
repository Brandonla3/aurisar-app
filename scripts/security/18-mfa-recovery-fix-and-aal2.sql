-- =============================================================================
-- 18 — Fix the MFA escape hatch, THEN enforce AAL2
-- =============================================================================
-- Ordering is the whole point (docs/auth-notifications-email-plan.md, Batch F):
-- enforcing AAL2 before the recovery path works would turn every lost
-- authenticator into a permanent lockout.
--
-- ── Bug 1 (CRITICAL): use_mfa_recovery_code() has always been broken ─────────
-- Migration 04 ends with:
--     PERFORM auth.mfa_unenroll(f.id) FROM auth.mfa_factors f WHERE ...
-- but `auth.mfa_unenroll` DOES NOT EXIST in Supabase's auth schema. Verified
-- against the live database:
--     SELECT to_regprocedure('auth.mfa_unenroll(uuid)');  -- → NULL
-- PL/pgSQL resolves the function when the statement is first planned, so any
-- VALID recovery code raises "function auth.mfa_unenroll(uuid) does not
-- exist". The exception rolls back the whole function — including the UPDATE
-- that marked the code used — so the user is bounced with a raw Postgres
-- error and stays locked out. Only an INVALID code "works" (early RETURN
-- false). The recovery path has therefore never functioned.
--
-- Fix: delete the factor rows directly, which is what the neighbouring
-- admin_reset_user_mfa() already does successfully.
--
-- ── Bug 2: disable_mfa_verified() has migration-14's search_path bug ─────────
-- It is declared SET search_path TO '' but references `mfa_recovery_codes`
-- unqualified, so the DELETE raises "relation does not exist" and rolls back
-- the factor deletion — in-app "disable MFA" is broken the same way.
--
-- Fix: schema-qualify both tables.
--
-- ── Then: AAL2 enforcement in RLS ───────────────────────────────────────────
-- Scoped deliberately. The predicate is
--     aal2  OR  the caller has no verified factor
-- so the non-MFA majority (permanently aal1) is untouched, and only users who
-- opted into MFA are required to complete it. Gameplay tables are NOT gated —
-- only PII/security-sensitive surfaces — which keeps the blast radius small.
-- =============================================================================

BEGIN;

-- ── 1. Fix the recovery-code escape hatch ────────────────────────────────────
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
    -- Legacy SHA-256 fallback (Phase-1 client format).
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

  -- Redeeming a recovery code drops every verified factor, returning the user
  -- to a clean aal1 with NO verified factor — which is exactly the state the
  -- aal2 policies below allow through. Direct DELETE (mirrors
  -- admin_reset_user_mfa) replaces the nonexistent auth.mfa_unenroll().
  DELETE FROM auth.mfa_factors
  WHERE user_id = auth.uid();

  -- The remaining codes belong to a factor that no longer exists.
  DELETE FROM public.mfa_recovery_codes
  WHERE user_id = auth.uid();

  RETURN true;
END
$$;

REVOKE ALL    ON FUNCTION public.use_mfa_recovery_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.use_mfa_recovery_code(text) TO authenticated;

-- ── 2. Fix disable_mfa_verified's unqualified table reference ────────────────
CREATE OR REPLACE FUNCTION public.disable_mfa_verified(p_factor_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM auth.mfa_factors
  WHERE id = p_factor_id
    AND user_id = auth.uid();

  DELETE FROM public.mfa_recovery_codes
  WHERE user_id = auth.uid();

  RETURN true;
END;
$$;

REVOKE ALL    ON FUNCTION public.disable_mfa_verified(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.disable_mfa_verified(uuid) TO authenticated;

-- ── 3. The AAL2 predicate ────────────────────────────────────────────────────
-- TRUE when the caller is allowed to touch sensitive data:
--   * session is aal2 (MFA completed this session), OR
--   * the user has no verified factor at all (never enrolled / just recovered).
-- A user WITH a factor on an aal1 session — the refresh-bypass case — is the
-- only one this rejects.
CREATE OR REPLACE FUNCTION public.has_required_aal()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT
    COALESCE(auth.jwt()->>'aal', 'aal1') = 'aal2'
    OR NOT EXISTS (
      SELECT 1 FROM auth.mfa_factors f
      WHERE f.user_id = auth.uid() AND f.status = 'verified'
    );
$$;
REVOKE ALL    ON FUNCTION public.has_required_aal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_required_aal() TO authenticated;

-- ── 4. Apply to the sensitive surfaces only ──────────────────────────────────
-- profiles carries PII (email-adjacent identifiers, private_id recovery
-- secret, location). Rebuilds the self-only policies from migration 03
-- (profiles_select_self / profiles_update_self) as self-only AND
-- assurance-satisfied. profiles_insert_self is left alone: signup happens
-- before any factor can exist.
DROP POLICY IF EXISTS profiles_select_self ON public.profiles;
CREATE POLICY profiles_select_self
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id AND public.has_required_aal());

DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id AND public.has_required_aal())
  WITH CHECK (auth.uid() = id AND public.has_required_aal());

-- Recovery codes: an aal1 session with a live factor must not enumerate the
-- remaining codes. Only the existing self-read policy is tightened; the
-- service_role insert/update/delete policies are left untouched, and the
-- redemption path is SECURITY DEFINER (bypasses RLS), so the escape hatch
-- stays open regardless of assurance level.
DROP POLICY IF EXISTS recovery_codes_own_read ON public.mfa_recovery_codes;
CREATE POLICY recovery_codes_own_read
  ON public.mfa_recovery_codes FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id AND public.has_required_aal());

-- Notifications can name friends and quote security events.
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select
  ON public.notifications FOR SELECT
  TO authenticated
  USING (recipient_id = auth.uid() AND public.has_required_aal());

COMMIT;

-- =============================================================================
-- Smoke tests
-- =============================================================================
-- Must now resolve (was NULL before this migration):
--   SELECT to_regprocedure('auth.mfa_unenroll(uuid)');  -- still NULL, and that
--     is fine: nothing references it any more. Confirm with:
--   SELECT prosrc LIKE '%mfa_unenroll%' AS still_broken
--   FROM pg_proc WHERE proname='use_mfa_recovery_code';   -- expect false
--
-- Non-MFA user is unaffected (expect true):
--   SELECT public.has_required_aal();
--
-- End-to-end (staging): enrol TOTP → reload → challenged → redeem a recovery
-- code → land signed in, profile readable, factor gone, codes cleared.
