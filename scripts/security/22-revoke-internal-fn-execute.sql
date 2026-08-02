-- =============================================================================
-- 22 — Revoke EXECUTE on internal notification functions from anon/authenticated
-- =============================================================================
-- APPLIED TO PRODUCTION 2026-08-02 (via the Supabase MCP, immediately after 21).
--
-- SEVERITY: this closes an arbitrary-notification-injection and
-- email-enumeration hole that migrations 17 and 19 opened.
--
-- The mistake: those migrations used
--     REVOKE ALL ON FUNCTION ... FROM PUBLIC;
--     GRANT EXECUTE ON FUNCTION ... TO service_role;
-- which READS as locked down but is not. Supabase ships
--     ALTER DEFAULT PRIVILEGES IN SCHEMA public
--       GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
-- so every newly created function in `public` receives an EXPLICIT grant to
-- anon and authenticated at creation. Revoking from PUBLIC does not remove an
-- explicit role grant, so all of these stayed reachable over PostgREST at
-- /rest/v1/rpc/<name>. Surfaced by Supabase's own security advisors and
-- confirmed with has_function_privilege('anon', oid, 'EXECUTE') = true.
--
-- What was actually exposed (all SECURITY DEFINER, so they run as the owner):
--
--   enqueue_notification(recipient, actor, event_type, payload)
--     Anyone — including anon — could insert an arbitrary notification into ANY
--     user's inbox with attacker-controlled payload text. Worse, event_type
--     'security_alert' is exempt from preference checks in should_deliver() and
--     is therefore also EMAILED, from the project's own verified domain. That
--     is an arbitrary-email-send and phishing primitive, not just spam.
--
--   should_deliver_email(recipient, event_type)
--     Returns the recipient's email address when the verdict is 'send'. Given a
--     user id, that is address enumeration.
--
--   claim_notification_emails(batch)
--     Returns SETOF public.notifications — full rows including recipient_id and
--     payload — and flips them to 'sending'. Disclosure plus a trivial denial of
--     delivery, since claimed rows stop being picked up for 15 minutes.
--
--   produce_daily_reminders(), notif_player_name(), default_notification_pref()
--     Reminder-row spamming and display-name lookup by user id.
--
-- LESSON for every future migration in this directory: on Supabase,
-- `REVOKE ... FROM PUBLIC` is NOT sufficient to make a function internal.
-- Revoke from anon and authenticated explicitly, then grant back only what a
-- client genuinely needs.
-- =============================================================================

BEGIN;

-- Internal-only: invoked by triggers, by other SECURITY DEFINER functions, or
-- by the service role from the Netlify functions. No client should reach them.
REVOKE EXECUTE ON FUNCTION public.enqueue_notification(uuid, uuid, text, jsonb)  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_notification_emails(int)                 FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.should_deliver(uuid, text, text)               FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.should_deliver_email(uuid, text)               FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.produce_daily_reminders()                      FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notif_player_name(uuid)                        FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.default_notification_pref(text, text)          FROM anon, authenticated;

-- Trigger functions. PostgREST will not expose a function returning `trigger`,
-- so this is hygiene rather than a hole — but an unnecessary grant is exactly
-- the kind of thing that becomes a hole after a later signature change.
REVOKE EXECUTE ON FUNCTION public.notify_user_welcome()      FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_invite_for_user()  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_mfa_disabled()      FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_friend_request()    FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_friend_accepted()   FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_shared_item()       FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_message_received()  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_friend_level_up()   FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_notification_prefs() FROM anon, authenticated;

-- has_required_aal keeps `authenticated` EXECUTE ON PURPOSE. It is referenced
-- by the RLS policies on profiles, notifications and mfa_recovery_codes, and a
-- policy expression is evaluated with the QUERYING role's privileges — revoke
-- it and every one of those tables becomes unreadable for everyone. anon needs
-- nothing: all policies using it are TO authenticated.
REVOKE EXECUTE ON FUNCTION public.has_required_aal() FROM anon;

-- check_invite_token keeps anon EXECUTE ON PURPOSE: the login screen calls it
-- pre-auth to validate an emailed invite. It discloses only the invited
-- address, and only in exchange for a 32-byte random token.

COMMIT;

-- =============================================================================
-- Verification actually run after applying:
-- =============================================================================
--   SELECT proname,
--          has_function_privilege('anon', oid,'EXECUTE'),
--          has_function_privilege('authenticated', oid,'EXECUTE'),
--          has_function_privilege('service_role', oid,'EXECUTE')
--   FROM pg_proc ...;
--     enqueue_notification / claim_notification_emails / should_deliver /
--     should_deliver_email / produce_daily_reminders / notif_player_name
--                                  -> f / f / t   (service_role only)
--     has_required_aal             -> f / t / t   (RLS needs authenticated)
--     check_invite_token           -> t / t / t   (pre-auth by design)
--
-- And, impersonating a real aal1 session with no MFA factor:
--   own profile rows visible        = 1
--   get_my_conversations()          = array   (messaging still works)
--   enqueue_notification(...)       = permission denied   <-- hole closed
