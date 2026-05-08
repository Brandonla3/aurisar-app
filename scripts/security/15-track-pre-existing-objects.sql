-- =============================================================================
-- 15 — Track pre-existing objects: xp_to_level, admin_reset_user_mfa + 3 views
-- =============================================================================
-- This migration is a no-op on production — the objects it defines already
-- exist there. It exists to bring the repo into byte-for-byte sync with prod
-- state, so future fresh-bootstraps of scripts/security/01..N succeed without
-- the IF EXISTS guards introduced in migration 12.
--
-- Background (PR #95, commit da3dda7):
--   Migration 12 (12-security-hardening.sql) references four objects that
--   pre-date this repo's SQL tracking. PR 95 worked around this with
--   DO $$ IF EXISTS … END $$ guards so a fresh bootstrap wouldn't abort on
--   missing objects. This migration closes that gap by creating the objects
--   unconditionally, so the guards in migration 12 become harmless-but-
--   redundant. The guards in migration 12 can stay — editing a merged
--   migration file would diverge from what was already applied to prod.
--
-- Objects tracked here (all verified live from project tczqtwxrnptgajxwynmg):
--   1. FUNCTION public.xp_to_level(p_xp bigint) — XP→level formula. IMMUTABLE,
--      EXECUTE granted to PUBLIC. Must precede community_leaderboard (section 4).
--   2. FUNCTION public.admin_reset_user_mfa(target_email text) — break-glass
--      MFA reset. SECURITY DEFINER, callable only via service_role / postgres.
--   3. VIEW    public.feedback_inbox       — admin view over public.feedback.
--      security_invoker=on, SELECT for service_role only.
--   4. VIEW    public.community_leaderboard — player stats leaderboard.
--      security_invoker=on, SELECT for anon + authenticated.
--      Depends on xp_to_level (section 1) — must be created after it.
--   5. VIEW    public.leaderboard_full     — ranked leaderboard joining
--      leaderboard_entries ⋈ xp_leaderboard (a regular table — no untracked
--      view in the dependency chain). security_invoker=on, SELECT for
--      anon + authenticated.
--
-- Note: public.profiles_public is already tracked in migration 02
-- (02-rls-add-safe-views-and-rpcs.sql:21) — it is not repeated here.
--
-- Idempotent. Safe to re-run (CREATE OR REPLACE throughout).
-- =============================================================================

BEGIN;

-- ── 1. Function: xp_to_level(p_xp bigint) ───────────────────────────────────
-- Converts a raw XP value to an integer level using the game's levelling
-- curve. IMMUTABLE (pure function, no side-effects). Called by
-- community_leaderboard (section 4) — must exist before that view is created.
-- EXECUTE is granted to PUBLIC (default) so any role can call it.
-- Body reproduced verbatim from pg_get_functiondef on prod as of 2026-05-08.
CREATE OR REPLACE FUNCTION public.xp_to_level(p_xp bigint)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO ''
AS $function$
declare
  lv int := 1;
  threshold bigint := 0;
  inc numeric := 20000;
  i int;
begin
  if p_xp is null or p_xp < 20000 then
    return 1;
  end if;

  for i in 2..70 loop
    threshold := threshold + round(inc);
    if p_xp >= threshold then
      lv := i;
    else
      exit;
    end if;

    if i < 10 then
      inc := inc * 1.30;
    elsif i < 30 then
      inc := inc * 1.50;
    elsif i < 40 then
      inc := inc * 2.25;
    end if;
  end loop;

  return lv;
end;
$function$;

-- EXECUTE already granted to PUBLIC by default for new functions; re-state
-- it explicitly so the grant is visible in tracked SQL.
GRANT EXECUTE ON FUNCTION public.xp_to_level(bigint) TO PUBLIC;

-- ── 2. Function: admin_reset_user_mfa(target_email text) ─────────────────────
-- Break-glass helper: finds a user by email, deletes all their MFA factors
-- and recovery codes. Intended for use from the Supabase SQL editor (postgres
-- role) or via service_role service key — never from the browser client.
-- Body is reproduced verbatim from pg_get_functiondef on prod as of 2026-05-07.
CREATE OR REPLACE FUNCTION public.admin_reset_user_mfa(target_email text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $function$
declare
  target_user_id uuid;
  factor_count   int;
begin
  -- Find user by email
  select id into target_user_id
  from auth.users
  where email = lower(target_email);

  if target_user_id is null then
    return 'ERROR: No user found with email ' || target_email;
  end if;

  -- Count existing factors
  select count(*) into factor_count
  from auth.mfa_factors
  where user_id = target_user_id;

  if factor_count = 0 then
    return 'No MFA factors found for ' || target_email || ' — nothing to reset.';
  end if;

  -- Delete all MFA factors
  delete from auth.mfa_factors
  where user_id = target_user_id;

  -- Also clear their recovery codes since MFA is being fully reset
  delete from mfa_recovery_codes
  where user_id = target_user_id;

  return 'SUCCESS: Removed ' || factor_count || ' MFA factor(s) for ' || target_email || '. User can now log in with password only and re-enroll MFA.';
end;
$function$;

REVOKE ALL     ON FUNCTION public.admin_reset_user_mfa(target_email text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_reset_user_mfa(target_email text) FROM anon, authenticated;
-- No re-grant to service_role needed: Supabase grants service_role EXECUTE on
-- all public functions at project init. service_role also bypasses RLS.
-- The postgres owner always retains access.

-- ── 3. View: feedback_inbox ──────────────────────────────────────────────────
-- Admin view over public.feedback. Shows a truncated 120-char preview so
-- admins can triage submissions without loading full message bodies.
-- security_invoker=on: the view runs as the calling role, so RLS on the
-- underlying feedback table applies. The feedback_service_all policy grants
-- service_role full access; anon/authenticated are blocked by RLS.
CREATE OR REPLACE VIEW public.feedback_inbox
  WITH (security_invoker = on)
AS
SELECT id,
       type,
       email,
       left(message, 120) AS preview,
       status,
       created_at
  FROM feedback
 ORDER BY created_at DESC;

REVOKE ALL   ON TABLE public.feedback_inbox FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.feedback_inbox TO service_role;

-- ── 4. View: community_leaderboard ──────────────────────────────────────────
-- Public-facing player leaderboard. Extracts display fields from profiles.data
-- jsonb and filters to players who have chosen a class and set a player name.
-- security_invoker=on (default; explicitly set for clarity). Read access via
-- RLS on the underlying profiles table.
CREATE OR REPLACE VIEW public.community_leaderboard
  WITH (security_invoker = on)
AS
SELECT id                                                          AS user_id,
       data ->> 'playerName'                                      AS player_name,
       data ->> 'chosenClass'                                     AS chosen_class,
       COALESCE((data ->> 'xp')::bigint, 0)                      AS total_xp,
       xp_to_level(COALESCE((data ->> 'xp')::bigint, 0))         AS level,
       COALESCE((data ->> 'checkInStreak')::integer, 0)          AS streak,
       COALESCE((data ->> 'totalCheckIns')::integer, 0)          AS total_checkins,
       data ->> 'state'                                           AS state,
       data ->> 'country'                                         AS country,
       data ->> 'gym'                                             AS gym,
       data -> 'exercisePBs'                                      AS exercise_pbs,
       updated_at
  FROM profiles p
 WHERE (data ->> 'chosenClass') IS NOT NULL
   AND (data ->> 'playerName')  IS NOT NULL
   AND (data ->> 'playerName')  <> ''
 ORDER BY COALESCE((data ->> 'xp')::bigint, 0) DESC;

REVOKE ALL   ON TABLE public.community_leaderboard FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.community_leaderboard TO anon, authenticated;

-- ── 5. View: leaderboard_full ────────────────────────────────────────────────
-- Ranked leaderboard: joins leaderboard_entries (per-category records) with
-- xp_leaderboard (a regular table — relkind='r', verified 2026-05-07) to
-- attach user profile data alongside each entry. Computes per-category rank
-- via window function.
-- security_invoker=on. SELECT granted to anon + authenticated for public
-- leaderboard reads.
CREATE OR REPLACE VIEW public.leaderboard_full
  WITH (security_invoker = on)
AS
SELECT lb.filter_category,
       lb.value,
       lb.display_value,
       lb.achieved_at,
       xp.user_id,
       xp.username,
       xp.avatar_url,
       xp.chosen_class,
       xp.total_xp,
       xp.weekly_xp,
       xp.longest_streak,
       rank() OVER (PARTITION BY lb.filter_category ORDER BY lb.value DESC) AS rank
  FROM leaderboard_entries lb
  JOIN xp_leaderboard xp ON lb.user_id = xp.user_id;

REVOKE ALL   ON TABLE public.leaderboard_full FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.leaderboard_full TO anon, authenticated;

COMMIT;

-- =============================================================================
-- Manual rollback (if needed):
--
-- NOTE: These four objects pre-existed in production. A DROP here removes only
-- the repo tracking; the objects themselves would need to be manually
-- re-created in Supabase to restore prod state.
--
-- BEGIN;
--   DROP VIEW     IF EXISTS public.feedback_inbox;
--   DROP VIEW     IF EXISTS public.community_leaderboard;
--   DROP VIEW     IF EXISTS public.leaderboard_full;
--   DROP FUNCTION IF EXISTS public.admin_reset_user_mfa(target_email text);
--   DROP FUNCTION IF EXISTS public.xp_to_level(bigint);
-- COMMIT;
-- =============================================================================
