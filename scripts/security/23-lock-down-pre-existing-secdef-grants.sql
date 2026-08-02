-- =============================================================================
-- 23 — Lock down EXECUTE on the pre-existing SECURITY DEFINER functions
-- =============================================================================
-- Follow-up to migration 22, which fixed only the functions migrations 17/19
-- created. Supabase's security advisors flag every SECURITY DEFINER function in
-- `public` that anon or authenticated can reach over PostgREST; 36 of them were
-- exposed, and most pre-date this whole effort.
--
-- ── A SECOND, SHARPER LESSON THAN MIGRATION 22'S ────────────────────────────
-- Migration 22 said: on Supabase, `REVOKE ... FROM PUBLIC` is not sufficient,
-- because default privileges grant EXECUTE to anon/authenticated explicitly.
-- That is true but INCOMPLETE, and migration 22 was itself partially ineffective
-- as a result. Inspecting proacl afterwards:
--
--   consume_invite_for_user =>  =X/postgres          <- PUBLIC still has EXECUTE
--                               postgres=X/postgres
--                               service_role=X/postgres
--
--   enqueue_notification    =>  postgres=X/postgres  <- no PUBLIC entry
--                               service_role=X/postgres
--
-- `enqueue_notification` is genuinely locked because migration 17 revoked
-- PUBLIC *and* migration 22 revoked the roles. `consume_invite_for_user` is NOT,
-- because 22 revoked only the roles while PostgreSQL's own default (EXECUTE to
-- PUBLIC on CREATE FUNCTION) remained — and anon inherits PUBLIC, so
-- has_function_privilege('anon', ...) is still true.
--
--   THE RULE: revoke from PUBLIC **and** from anon, authenticated. Either one
--   alone leaves the function reachable. Grant back explicitly where a client
--   genuinely needs it, so intent is visible in the ACL rather than inherited.
--
-- ── HOW THE THREE BUCKETS WERE DECIDED ──────────────────────────────────────
-- Not by guesswork: config/db-contract.json lists every RPC the application
-- actually calls (derived from source). Anything absent from it has no caller
-- in src/ or netlify/ and is therefore internal or dead. Each entry below was
-- additionally checked by hand for how it is invoked.
-- =============================================================================

BEGIN;

DO $$
DECLARE
  -- A. INTERNAL — no caller in src/ or netlify/. Trigger functions (invoked by
  --    the trigger, never by a client) and helpers called only from inside
  --    other SECURITY DEFINER functions, which run as the owner and so do not
  --    need the caller to hold EXECUTE.
  --    disable_mfa_verified is here deliberately: the app disables MFA through
  --    sb.auth.mfa.unenroll(), not this RPC — its only mention in the repo is a
  --    test assertion. It is self-scoped (auth.uid()) so it was never
  --    exploitable cross-user, but dead surface should still be closed.
  internal text[] := ARRAY[
    'backup_profile_on_update', 'consume_invite_for_user', 'notify_friend_accepted',
    'notify_message_received', 'notify_user_welcome', 'trigger_set_profile_ids',
    'notify_friend_request', 'notify_shared_item', 'notify_mfa_disabled',
    'notify_friend_level_up', 'touch_notification_prefs', 'update_channel_timestamp',
    'get_class_icon', 'get_player_name', 'user_wants_notification',
    'get_my_profile_ids', 'get_leaderboard_filter_options',
    'store_mfa_recovery_codes_legacy', 'disable_mfa_verified'
  ];

  -- B. AUTHENTICATED ONLY — called from the browser with a user JWT. anon has
  --    no business reaching them; several were anon-reachable purely by
  --    default-privilege inheritance (the leaderboard trio in particular).
  authed_only text[] := ARRAY[
    'count_recovery_codes_remaining', 'find_user_for_friend_request',
    'get_channel_messages', 'get_friend_profiles_safe', 'get_my_conversations',
    'get_or_create_dm_channel', 'get_recent_friend_events',
    'get_share_sender_profiles', 'get_total_unread_count',
    'has_legacy_mfa_recovery_codes', 'mark_channel_read', 'send_message',
    'send_phone_otp', 'store_mfa_recovery_codes', 'use_mfa_recovery_code',
    'verify_phone_otp', 'has_required_aal',
    'get_leaderboard', 'get_leaderboard_filters', 'get_world_ranks'
  ];

  -- C. GENUINELY PRE-AUTH — must stay reachable by anon, verified individually:
  --    check_anon_rate_limit   netlify/functions/send-support-email.js calls it
  --                            with the ANON key (apikey + Bearer = anon), so
  --                            revoking anon would break the support form's own
  --                            rate limiter.
  --    check_invite_token      login screen validates an emailed invite before
  --                            any session exists.
  --    lookup_email_by_private_id  "forgot which email" on the login screen.
  --                            Still untracked and still owed a migration that
  --                            re-declares it (see config/db-contract.json).
  --    These are re-granted EXPLICITLY after revoking PUBLIC, so the ACL states
  --    the intent instead of relying on inheritance.
  preauth text[] := ARRAY[
    'check_anon_rate_limit', 'check_invite_token', 'lookup_email_by_private_id'
  ];

  r        record;
  fname    text;
  n_int    int := 0;
  n_auth   int := 0;
  n_pre    int := 0;
  missing  text[] := '{}';
BEGIN
  -- Signatures are resolved from the catalog rather than typed out, so
  -- overloads are handled and a typo fails loudly instead of silently missing.
  FOREACH fname IN ARRAY (internal || authed_only || preauth) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = fname
    ) THEN
      missing := missing || fname;
    END IF;
  END LOOP;
  IF array_length(missing, 1) > 0 THEN
    RAISE EXCEPTION 'aborting: named function(s) not found: %', array_to_string(missing, ', ');
  END IF;

  FOR r IN
    SELECT p.oid, p.proname,
           'public.' || quote_ident(p.proname)
             || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY (internal || authed_only || preauth)
  LOOP
    -- Always strip BOTH the PUBLIC grant and the explicit role grants first.
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', r.sig);

    IF r.proname = ANY (authed_only) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
      n_auth := n_auth + 1;
    ELSIF r.proname = ANY (preauth) THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.sig);
      n_pre := n_pre + 1;
    ELSE
      n_int := n_int + 1;
    END IF;

    -- The service role runs the Netlify functions and must keep reaching
    -- everything it already could; it bypasses RLS but not function grants.
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;

  RAISE NOTICE 'locked: % internal, % authenticated-only, % pre-auth', n_int, n_auth, n_pre;
END $$;

COMMIT;

-- =============================================================================
-- Verification to run after applying:
-- =============================================================================
-- Expect ZERO rows — nothing SECURITY DEFINER should be anon-reachable except
-- the three pre-auth functions:
--   SELECT p.proname
--   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public' AND p.prosecdef
--     AND has_function_privilege('anon', p.oid, 'EXECUTE')
--     AND p.proname NOT IN ('check_anon_rate_limit','check_invite_token',
--                           'lookup_email_by_private_id');
--
-- And the app must still work for a normal signed-in user: own profile
-- readable, get_my_conversations() returns an array, get_leaderboard() runs.
