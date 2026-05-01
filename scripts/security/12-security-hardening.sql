-- =============================================================================
-- 12 — Security hardening: lock down 7 advisor-flagged surfaces
-- =============================================================================
-- Closes the highest-impact items found while reviewing Supabase advisors
-- on the production project (tczqtwxrnptgajxwynmg).
--
-- Items (severity → action):
--   1. CRITICAL  Drop `get_resend_key()` — leaked Resend API key as plaintext
--                via RPC, callable by `anon`. (See PRE-APPLY note below.)
--   2. CRITICAL  Lock down `admin_reset_user_mfa(text)` — anyone could reset
--                any user's MFA + recovery codes. Revoke from anon/auth.
--   3. HIGH      `feedback_inbox` view leaked all feedback emails to anon
--                via SECURITY DEFINER + over-broad GRANTs. Switch to
--                SECURITY INVOKER and restrict to service_role.
--   4. HIGH      Strip the over-broad GRANT ALL on the three leaderboard /
--                public-profile views down to SELECT-only.
--   5. HIGH      Drop `find_user_by_email(text)` (user-enumeration RPC,
--                no callers in src/). Auth-gate `find_user_for_friend_request`
--                so anon can no longer enumerate accounts by email.
--   6. MEDIUM    Drop the two stale `get_leaderboard` overloads. The live
--                signature called from src/App.js:1519 is the 5-arg version
--                (p_scope, p_states, p_countries, p_limit, p_user_id).
--   7. MEDIUM    Lock down `anon_request_counters_sweep()` — should be cron-
--                only, was reachable by anon.
--   8. LOW       Drop the dead 'your@email.com' admin-read policy on
--                `public.feedback`. Placeholder was never replaced; covered
--                by `feedback_read_own` and `feedback_service_all`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- PRE-APPLY (manual, NOT in this migration):
--   • Rotate the Resend API key at https://resend.com/api-keys
--   • Update RESEND_API_KEY in Netlify env vars (Site → Settings → Environment
--     variables) for production AND each deploy context that needs it.
--   • Redeploy so the Netlify Functions pick up the new key.
-- Only then apply this migration. Section 1 below drops the function that
-- exposes the OLD key; if you apply before rotating, attackers retain access
-- until rotation completes.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- POST-APPLY verification:
--   • Re-run Supabase advisors — the 4 ERROR-level `security_definer_view`
--     lints should drop to 3 (or 0 if you decide to invoker the leaderboards
--     too — see the comment in section 3); the `rls_policy_always_true` lint
--     remains by design (anonymous feedback submission is intentional, gated
--     by the Netlify perimeter — see audit #2).
--   • Smoke test:
--       - Send a friend request from a logged-in account → should succeed.
--       - Hit /api/send-support-email from the live site → should succeed
--         (uses RESEND_API_KEY env, not the dropped RPC).
--   • Audit logs (manual): grep Resend send logs and Supabase logs for any
--     prior calls to `get_resend_key`, `admin_reset_user_mfa`, or
--     `find_user_by_email` to assess whether prior abuse occurred.
--
-- Idempotent. Safe to re-run.
-- =============================================================================

BEGIN;

-- ── 1. Drop get_resend_key() ────────────────────────────────────────────────
-- Returned the Resend API key as a literal string. Anyone with the anon JWT
-- (which ships in the browser bundle) could call it and exfiltrate the key.
-- Netlify Functions read RESEND_API_KEY from process.env, so dropping this
-- function does NOT break the support / welcome email handlers.
DROP FUNCTION IF EXISTS public.get_resend_key();

-- ── 2. Lock down admin_reset_user_mfa(text) ─────────────────────────────────
-- Function deletes auth.mfa_factors + mfa_recovery_codes for any email passed
-- in, with no caller authorization. Keeping the body unchanged so it remains
-- usable as a break-glass tool from the Supabase SQL editor (postgres role)
-- or via service_role; only revoking the public/anon/authenticated grants.
-- The function isn't created in any tracked migration (it pre-dates this
-- repo's SQL tracking), so guard with IF EXISTS so a fresh-bootstrap run of
-- 01→12 doesn't abort the transaction on the missing object.
DO $$
BEGIN
  IF to_regprocedure('public.admin_reset_user_mfa(text)') IS NOT NULL THEN
    REVOKE ALL    ON FUNCTION public.admin_reset_user_mfa(text) FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION public.admin_reset_user_mfa(text) FROM anon, authenticated;
    -- (No re-grant. service_role bypasses GRANT checks; postgres owns it.)
    -- Pin search_path while we're here (advisor: function_search_path_mutable).
    ALTER FUNCTION public.admin_reset_user_mfa(text) SET search_path = public, auth;
  END IF;
END $$;

-- ── 3. feedback_inbox: stop leaking emails to anon ──────────────────────────
-- This is the actual data leak. The view was SECURITY DEFINER + GRANT SELECT
-- to anon, so any caller with the anon JWT could SELECT every feedback row
-- (including the email column). Switching to SECURITY INVOKER makes the view
-- respect the underlying `public.feedback` RLS, and revoking SELECT from
-- anon/authenticated leaves only service_role (admin tooling) able to read.
-- View definition isn't in tracked SQL; guard with IF EXISTS for fresh bootstraps.
DO $$
BEGIN
  IF to_regclass('public.feedback_inbox') IS NOT NULL THEN
    ALTER VIEW public.feedback_inbox SET (security_invoker = on);
    REVOKE ALL ON TABLE public.feedback_inbox FROM PUBLIC, anon, authenticated;
    GRANT  SELECT ON public.feedback_inbox TO service_role;
  END IF;
END $$;

-- The other three views project intentionally-public columns and aggregate
-- across users (which is why they're SECURITY DEFINER). They were not
-- exploited the way feedback_inbox was — but each had GRANT ALL (incl.
-- INSERT/UPDATE/DELETE/TRUNCATE) for anon and authenticated, which is bad
-- hygiene even though it's a no-op on simple views without INSTEAD OF
-- triggers. Strip everything and re-grant only SELECT.
--
-- Follow-up (intentionally not in this PR): consider replacing these with
-- SECURITY DEFINER RPC functions like get_friend_profiles_safe() in
-- migration 02. The client already calls get_leaderboard() RPC and never
-- references these views directly (verified: zero matches in src/).

-- community_leaderboard and leaderboard_full aren't in tracked SQL either;
-- guard them too. profiles_public IS tracked (02-rls-add-safe-views-and-rpcs.sql)
-- so its grants run unconditionally.
DO $$
BEGIN
  IF to_regclass('public.community_leaderboard') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.community_leaderboard FROM PUBLIC, anon, authenticated;
    GRANT  SELECT ON public.community_leaderboard TO anon, authenticated;
  END IF;

  IF to_regclass('public.leaderboard_full') IS NOT NULL THEN
    REVOKE ALL ON TABLE public.leaderboard_full FROM PUBLIC, anon, authenticated;
    GRANT  SELECT ON public.leaderboard_full TO anon, authenticated;
  END IF;
END $$;

REVOKE ALL ON TABLE public.profiles_public FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.profiles_public TO authenticated;

-- ── 4. Drop find_user_by_email; auth-gate find_user_for_friend_request ─────
-- find_user_by_email had zero callers in src/ but exposed user-enumeration
-- by email to anon. Removing entirely.
DROP FUNCTION IF EXISTS public.find_user_by_email(text);

-- find_user_for_friend_request is used by the friend-add flow at
-- src/App.js:1758. The flow always runs from a logged-in client, so adding
-- an auth.uid() check at the top is a no-op for legitimate use, but it
-- closes the anon enumeration path. Also pin search_path.
CREATE OR REPLACE FUNCTION public.find_user_for_friend_request(p_identifier text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $function$
DECLARE
  found_user RECORD;
  clean_id   TEXT;
BEGIN
  -- Auth gate: friend-request lookup must come from a logged-in user.
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth required'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  clean_id := upper(trim(both from p_identifier));
  IF left(clean_id, 1) = '#' THEN
    clean_id := substr(clean_id, 2);
  END IF;

  -- Try public Account ID first (6 chars, A-Z0-9).
  IF length(clean_id) = 6 AND clean_id ~ '^[A-Z0-9]+$' THEN
    SELECT p.id,
           p.public_id,
           p.data->>'playerName'  AS player_name,
           p.data->>'chosenClass' AS chosen_class
      INTO found_user
      FROM public.profiles p
     WHERE p.public_id = clean_id;

    IF found_user IS NOT NULL THEN
      RETURN jsonb_build_object(
        'found',        true,
        'user_id',      found_user.id,
        'public_id',    found_user.public_id,
        'player_name',  found_user.player_name,
        'chosen_class', found_user.chosen_class,
        'match_type',   'account_id'
      );
    END IF;
  END IF;

  -- Fall back to email (case-insensitive).
  SELECT p.id,
         p.public_id,
         p.data->>'playerName'  AS player_name,
         p.data->>'chosenClass' AS chosen_class
    INTO found_user
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.id
   WHERE lower(u.email) = lower(trim(p_identifier));

  IF found_user IS NOT NULL THEN
    RETURN jsonb_build_object(
      'found',        true,
      'user_id',      found_user.id,
      'public_id',    found_user.public_id,
      'player_name',  found_user.player_name,
      'chosen_class', found_user.chosen_class,
      'match_type',   'email'
    );
  END IF;

  RETURN jsonb_build_object('found', false);
END
$function$;

REVOKE ALL    ON FUNCTION public.find_user_for_friend_request(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.find_user_for_friend_request(text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.find_user_for_friend_request(text) TO authenticated;

-- ── 5. Drop stale get_leaderboard overloads ─────────────────────────────────
-- Live signature kept (called from src/App.js:1519 with p_user_id):
--   public.get_leaderboard(p_scope text, p_states text[], p_countries text[],
--                          p_limit integer, p_user_id uuid)
-- Drop the two leftover signatures so a future caller can't accidentally
-- bind to one of them — old function bodies that survive a refactor are a
-- classic vector for security regressions long after a fix ships.
DROP FUNCTION IF EXISTS public.get_leaderboard(text, text[], text[], integer);
DROP FUNCTION IF EXISTS public.get_leaderboard(text, text[], text[], text, integer);

-- ── 6. Lock down anon_request_counters_sweep() ──────────────────────────────
-- Maintenance helper that deletes rate-limit rows older than 24 hours.
-- Calling it doesn't help an attacker bypass the rate limit (only purges
-- rows that have already expired), but it's still public-facing noise that
-- shouldn't be reachable. Should be invoked by pg_cron or service_role.
REVOKE ALL    ON FUNCTION public.anon_request_counters_sweep() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.anon_request_counters_sweep() FROM anon, authenticated;
-- (search_path is already pinned in 05-anon-rate-limit.sql.)

-- ── 7. Drop dead admin-read policy on public.feedback ───────────────────────
-- The qual is `auth.uid() = (SELECT id FROM auth.users WHERE email =
-- 'your@email.com')`. The literal placeholder was never replaced, so the
-- policy has never matched anyone. The other policies on the table cover
-- legitimate access:
--   - feedback_read_own       : users can read their own rows
--   - feedback_service_all    : service_role has full access (admin tooling)
--   - "Anyone can submit ..."  : INSERT WITH CHECK (true) — intentional;
--                                 the rate-limit + Turnstile perimeter in
--                                 the Netlify functions is the gate.
DROP POLICY IF EXISTS "Only admins can read feedback" ON public.feedback;

COMMIT;

-- =============================================================================
-- Manual rollback (if needed) — paste into a fresh transaction:
--
-- BEGIN;
--   -- Resend key: don't recreate get_resend_key(); roll back by reverting
--   -- the Netlify env var to the old key in the dashboard.
--
--   -- admin_reset_user_mfa: re-grant if the lock-down breaks anything you
--   -- relied on (it shouldn't — admin work goes via service_role / SQL editor).
--   GRANT EXECUTE ON FUNCTION public.admin_reset_user_mfa(text) TO authenticated;
--
--   -- Views: revert to SECURITY DEFINER reads for feedback_inbox if the
--   -- admin tooling relied on anon SELECT (it shouldn't — service_role works).
--   ALTER VIEW public.feedback_inbox SET (security_invoker = off);
--   GRANT SELECT ON public.feedback_inbox TO authenticated;
--
--   -- find_user_for_friend_request: drop the auth.uid() guard by reapplying
--   -- the original body from PR review.
--
--   -- get_leaderboard overloads: re-create from a Supabase point-in-time
--   -- restore if a stale caller breaks. Both overloads were unused per
--   -- src/ grep at PR-author time.
-- COMMIT;
-- =============================================================================
