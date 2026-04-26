-- =============================================================================
-- 09 — RPC: detect whether the current user has legacy SHA-256 recovery codes
-- =============================================================================
-- Used by the client to show an in-app nudge ("Your recovery codes are using
-- a legacy format. Regenerate them for stronger security.") to users whose
-- existing codes were stored before script 04 (M-5 server, bcrypt) shipped.
--
-- Read-only and idempotent.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.has_legacy_mfa_recovery_codes()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.mfa_recovery_codes
    WHERE user_id = auth.uid()
      AND used    = false
      AND used_at IS NULL
      AND algo    = 'sha256'
  );
$$;

REVOKE ALL    ON FUNCTION public.has_legacy_mfa_recovery_codes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_legacy_mfa_recovery_codes() TO authenticated;
