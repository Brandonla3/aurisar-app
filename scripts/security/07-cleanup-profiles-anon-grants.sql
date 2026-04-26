-- =============================================================================
-- 07 — Defence-in-depth cleanup after H-4 tightening (run AFTER 03)
-- =============================================================================
-- Two follow-ups cowork flagged after applying 03-rls-tighten-profiles.sql:
--
-- (1) The pre-existing "Users own their profile" policy on public.profiles
--     has cmd='ALL' so the SELECT-only loop in 03 didn't drop it. It's
--     functionally identical to the three new self-only policies (USING
--     auth.uid() = id) — but having two policies for the same effect is
--     ambiguous for future maintainers. Drop it.
--
-- (2) The pre-tightening audit (pane 4) showed `anon` had SELECT grants on
--     every column of public.profiles. RLS now blocks those reads (anon
--     never satisfies auth.uid() = id), but the COLUMN GRANTS remain. If
--     RLS is ever misconfigured in the future — e.g. by a mistakenly-added
--     `USING (true)` policy or by disabling RLS during a migration — those
--     dormant grants would re-expose every row. Revoke them.
--
-- Idempotent. Safe to re-run.
-- =============================================================================

BEGIN;

-- 1. Drop the redundant ALL-policy.
DROP POLICY IF EXISTS "Users own their profile" ON public.profiles;

-- 2. Revoke all column grants on profiles from anon and from PUBLIC. The
--    `authenticated` role keeps its grant — it's needed for the self-read
--    that profiles_select_self/profiles_update_self/profiles_insert_self
--    allow.
REVOKE ALL ON TABLE public.profiles FROM anon;
REVOKE ALL ON TABLE public.profiles FROM PUBLIC;

-- 3. Same treatment for the safe view — anon never has a session anyway,
--    so the SELECT grant on profiles_public should be authenticated-only.
REVOKE ALL ON TABLE public.profiles_public FROM anon;
REVOKE ALL ON TABLE public.profiles_public FROM PUBLIC;

COMMIT;

-- =============================================================================
-- Verification queries:
-- =============================================================================
-- Should return 3 rows (profiles_select_self, profiles_insert_self,
-- profiles_update_self) and nothing else:
--   SELECT policyname, cmd, roles
--   FROM pg_policies
--   WHERE schemaname='public' AND tablename='profiles'
--   ORDER BY cmd, policyname;
--
-- Should return 0 rows for grantee='anon' on profiles columns:
--   SELECT column_name, privilege_type, grantee
--   FROM information_schema.column_privileges
--   WHERE table_schema='public' AND table_name='profiles'
--     AND grantee IN ('anon','PUBLIC');
--
-- As an unauthenticated probe (in the SQL editor):
--   SET ROLE anon;
--   SELECT count(*) FROM public.profiles;        -- should error or return 0
--   RESET ROLE;
