-- =============================================================================
-- 10 — ADMIN: bulk-invalidate legacy SHA-256 MFA recovery codes
-- =============================================================================
-- ⚠️ DESTRUCTIVE. Run ONLY when:
--   * You want to FORCE every user with pre-bcrypt recovery codes to
--     regenerate (e.g. after a suspected database compromise), AND
--   * Users have been notified — the in-app banner from 09 is live, OR you
--     have sent email warnings.
--
-- Effect: every still-valid sha256-algo row is marked used (used=true,
-- used_at=now()) so it can no longer be redeemed. Users with no remaining
-- valid codes will see "0 recovery codes remaining" and must regenerate via
-- Profile → Security → Regenerate Recovery Codes.
--
-- Why marking used vs deleting:
--   * Audit trail — you can `SELECT count(*) ... WHERE algo='sha256' AND
--     used_at > 'YYYY-MM-DD'` to see exactly when each code was retired.
--   * Same code path the verifier uses, so behavior matches a normal code use.
--
-- Run in Supabase SQL Editor. Wrap in a transaction so you can roll back if
-- the count surprises you.
-- =============================================================================

BEGIN;

-- Preview first — copy this row count and confirm before COMMIT.
SELECT count(*) AS will_invalidate
FROM public.mfa_recovery_codes
WHERE algo    = 'sha256'
  AND used    = false
  AND used_at IS NULL;

-- Now do it. (Comment out the preview above if you want to run as one block.)
UPDATE public.mfa_recovery_codes
   SET used    = true,
       used_at = now()
WHERE algo    = 'sha256'
  AND used    = false
  AND used_at IS NULL;

-- Sanity: should be zero after the UPDATE.
SELECT count(*) AS remaining_legacy_valid
FROM public.mfa_recovery_codes
WHERE algo    = 'sha256'
  AND used    = false
  AND used_at IS NULL;

-- Inspect the row count before committing. If acceptable, COMMIT. Otherwise
-- ROLLBACK and investigate.
COMMIT;
-- ROLLBACK;
