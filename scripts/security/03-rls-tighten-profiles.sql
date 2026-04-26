-- =============================================================================
-- H-4 — STAGE 2: lock down direct peer reads of `profiles`
-- =============================================================================
-- DO NOT RUN until:
--   1. 02-rls-add-safe-views-and-rpcs.sql has been applied, AND
--   2. The matching client (commit "Phase 2 security hardening" or later) is
--      live in production. That client uses `get_friend_profiles_safe` and
--      `get_share_sender_profiles` instead of `from('profiles').select(...)`.
--
-- After this migration, `select id,data from profiles where id=<friend>` from
-- the browser returns ZERO rows (RLS denies). Self-reads still work.
-- =============================================================================

BEGIN;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Drop every existing SELECT policy on profiles (we don't know the project's
-- exact policy names — the audit in 01-rls-audit.sql lists them; adjust this
-- block accordingly if names diverge). Then add a single self-only policy.
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname FROM pg_policies
    WHERE schemaname='public' AND tablename='profiles' AND cmd='SELECT'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.profiles', pol.policyname);
  END LOOP;
END $$;

CREATE POLICY profiles_select_self
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

-- Same for INSERT/UPDATE — self-only.
DROP POLICY IF EXISTS profiles_insert_self ON public.profiles;
CREATE POLICY profiles_insert_self
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING  (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Realtime: drop `profiles` from the publication. Friend exercise notifications
-- now flow via `friend_exercise_events` (added in stage 1).
ALTER PUBLICATION supabase_realtime DROP TABLE IF EXISTS public.profiles;

-- Sanity-check the safe RPCs are present (created in stage 1).
DO $$
BEGIN
  PERFORM 1
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname='public' AND p.proname='get_friend_profiles_safe';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'get_friend_profiles_safe is missing — run 02-rls-add-safe-views-and-rpcs.sql first';
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- Verify after running:
-- =============================================================================
-- SELECT * FROM pg_policies WHERE schemaname='public' AND tablename='profiles';
--   → Should show profiles_select_self, profiles_insert_self, profiles_update_self only.
--
-- SELECT * FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='profiles';
--   → Should return 0 rows.
--
-- (As a logged-in user, in the SQL editor — set role authenticated; set request.jwt.claims; etc.)
-- SELECT id, data FROM profiles WHERE id <> auth.uid();
--   → Should return 0 rows.
