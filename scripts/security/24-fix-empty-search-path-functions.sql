-- =============================================================================
-- 24 — Repair 12 functions that migration 12 broke with an EMPTY search_path
-- =============================================================================
-- APPLIED TO PRODUCTION 2026-08-02.
--
-- THE RECURRING BUG, FINALLY SWEPT. Migration 12's security hardening applied
-- `SET search_path = ''` to functions whose bodies reference public objects
-- WITHOUT a schema qualifier. An empty search_path resolves nothing, so every
-- such function raises `relation "x" does not exist` at runtime.
--
-- This has been found and patched one victim at a time:
--   migration 14  backup_profile_on_update      (profile saves failing silently)
--   migration 21  notify_friend_request_accepted / _rejected
--                                               (accept/reject friend request)
-- and each time the remaining instances stayed hidden. This migration finds
-- them all by construction, via a catalog sweep for functions whose config
-- contains search_path="" and whose body references a known public relation
-- unqualified.
--
-- CONFIRMED BROKEN IN PRODUCTION by calling each one before the fix:
--   get_leaderboard                 relation "profiles" does not exist
--   get_leaderboard_filters         BROKEN   -> the Leaderboard tab
--   get_leaderboard_filter_options  BROKEN
--   get_world_ranks                 BROKEN
--   lookup_email_by_private_id      BROKEN   -> pre-auth "forgot your email"
--   get_player_name                 BROKEN   } the helpers whose absence made
--   get_class_icon                  BROKEN   } the friend-request triggers in
--   user_wants_notification         BROKEN   } migration 21 fail
--   get_my_profile_ids              BROKEN
--   reset_weekly_xp                 BROKEN
--   send_phone_otp                  BROKEN   -> phone MFA enrolment
--   verify_phone_otp                BROKEN
--
-- ── WHY PIN, RATHER THAN REWRITE 12 BODIES ──────────────────────────────────
-- The security property migration 12 wanted is a PINNED search_path, not an
-- EMPTY one: the attack it defends against is an attacker creating a shadowing
-- object in a schema that appears earlier in a mutable path. `SET search_path =
-- public` is fixed, excludes `$user`, and is exactly what the healthy functions
-- in this database already use (`search_path=public`, `search_path=public, auth`).
-- Rewriting a dozen function bodies to add `public.` everywhere would touch far
-- more surface for the same guarantee, and body edits are how several of these
-- bugs were introduced in the first place.
--
-- Verified before choosing the value: none of the twelve call a bare `uid()`
-- (every auth reference is already `auth.`-qualified), and only the phone-OTP
-- pair needs `extensions` (crypt / gen_random_bytes / digest).
-- =============================================================================

BEGIN;

DO $$
DECLARE
  -- Only public objects.
  pub_only text[] := ARRAY[
    'get_class_icon', 'get_leaderboard', 'get_leaderboard_filter_options',
    'get_leaderboard_filters', 'get_my_profile_ids', 'get_player_name',
    'get_world_ranks', 'lookup_email_by_private_id', 'reset_weekly_xp',
    'user_wants_notification'
  ];
  -- Also call pgcrypto helpers, which live in `extensions` on Supabase.
  pub_ext text[] := ARRAY['send_phone_otp', 'verify_phone_otp'];
  r       record;
  n       int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname,
           'public.' || quote_ident(p.proname)
             || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig
    FROM pg_proc p JOIN pg_namespace n2 ON n2.oid = p.pronamespace
    WHERE n2.nspname = 'public'
      AND p.proname = ANY (pub_only || pub_ext)
  LOOP
    IF r.proname = ANY (pub_ext) THEN
      EXECUTE format('ALTER FUNCTION %s SET search_path = public, extensions', r.sig);
    ELSE
      EXECUTE format('ALTER FUNCTION %s SET search_path = public', r.sig);
    END IF;
    n := n + 1;
  END LOOP;

  IF n <> 12 THEN
    RAISE EXCEPTION 'expected to repair 12 functions, repaired %', n;
  END IF;
  RAISE NOTICE 'repaired search_path on % functions', n;
END $$;

COMMIT;

-- =============================================================================
-- Verification run after applying (each called directly):
-- =============================================================================
--   get_leaderboard / _filters / _filter_options / get_world_ranks  -> OK
--   lookup_email_by_private_id                                      -> OK
--   get_player_name / get_class_icon / user_wants_notification      -> OK
--
-- The sweep that found them, which should now return ZERO rows:
--   WITH pub AS (SELECT tablename t FROM pg_tables WHERE schemaname='public'
--                UNION SELECT viewname FROM pg_views WHERE schemaname='public')
--   SELECT p.proname FROM pg_proc p
--   JOIN pg_namespace n ON n.oid=p.pronamespace
--   JOIN pg_language l ON l.oid=p.prolang
--   JOIN pub ON p.prosrc ~* ('(from|join|into|update)[[:space:]]+'||pub.t||'[[:space:],;)]')
--            AND p.prosrc !~* ('(from|join|into|update)[[:space:]]+public\.'||pub.t)
--   WHERE n.nspname='public' AND l.lanname IN ('plpgsql','sql')
--     AND COALESCE(array_to_string(p.proconfig,','),'') LIKE '%search_path=""%';
--
-- NOTE for future migrations: pinning search_path is correct, but pin it to
-- `public` (plus `extensions`/`auth` when needed) — NOT to ''. An empty path is
-- only safe for a body in which every single reference is schema-qualified.
