-- =============================================================================
-- 19 — Unblock MFA factor deletion + welcome email via the outbox
-- =============================================================================
-- ── Bug 3 (CRITICAL): every MFA removal path is blocked by a trigger ────────
-- `on_mfa_factor_deleted` on auth.mfa_factors runs notify_mfa_disabled(),
-- which calls get_resend_key() AND build_aurisar_email() — both DROPPED in
-- migration 12. Verified on the live database:
--     SELECT to_regprocedure('public.get_resend_key()');                 -- NULL
--     SELECT to_regprocedure('public.build_aurisar_email(text,text,text)'); -- NULL
--
-- So ANY delete from auth.mfa_factors raises "function ... does not exist"
-- and rolls back. That blocks all three removal paths at once:
--     * use_mfa_recovery_code()  (as fixed in migration 18)
--     * disable_mfa_verified()   (in-app "Disable MFA")
--     * admin_reset_user_mfa()   (the support break-glass)
-- i.e. once a user enrolls MFA there is currently NO way to remove it, and
-- migration 18's escape hatch cannot work until this is fixed.
--
-- Fix: notify_mfa_disabled enqueues a security_alert row on the notifications
-- outbox instead of calling Resend from inside Postgres. The drain sends it.
-- This is the same move that revived the level-up email in migration 17 and
-- retires the "Vault-backed get_resend_key()" follow-up for good — no DB
-- function needs the API key any more.
--
-- It also delivers the out-of-band credential-change alert from the plan:
-- security_alert bypasses notification prefs in should_deliver(), so a user
-- always hears that MFA was removed from their account.
--
-- ── Welcome email on BOTH signup branches ───────────────────────────────────
-- send-welcome-email was only called when Supabase email-confirmation was
-- OFF (the branch where signUp returns a session). With confirmation ON, new
-- users got nothing. An AFTER INSERT trigger on auth.users enqueues a
-- 'welcome' row for every signup; should_deliver() returns 'defer' while
-- email_confirmed_at is NULL, so the drain simply holds the row and sends it
-- once the address is confirmed. One path, both configurations.
-- =============================================================================

BEGIN;

-- ── 1. Unblock factor deletion ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_mfa_disabled()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Enqueue only; delivery is the drain's job. Wrapped so that a notification
  -- failure can NEVER block the security action the user asked for — being
  -- unable to remove a factor is worse than a missing alert.
  BEGIN
    INSERT INTO public.notifications (recipient_id, event_type, payload)
    VALUES (
      OLD.user_id,
      'security_alert',
      jsonb_build_object(
        'text',
        'Multi-factor authentication was removed from your account. '
        || 'If this was not you, reset your password immediately and re-enable MFA.'
      )
    );
  EXCEPTION WHEN others THEN
    RAISE WARNING 'notify_mfa_disabled: could not enqueue alert for %: %',
      OLD.user_id, SQLERRM;
  END;
  RETURN OLD;
END;
$$;

-- ── 2. Welcome row for every new signup ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_user_welcome()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  BEGIN
    INSERT INTO public.notifications (recipient_id, event_type, payload)
    VALUES (NEW.id, 'welcome', '{}'::jsonb);
  EXCEPTION WHEN others THEN
    -- Never let a notification problem fail account creation.
    RAISE WARNING 'notify_user_welcome: could not enqueue for %: %', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_welcome ON auth.users;
CREATE TRIGGER on_auth_user_created_welcome
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.notify_user_welcome();

-- ── 3. Make mailed invite tokens mean something ──────────────────────────────
-- admin-send-invite has always mailed https://aurisargames.com?invite=<token>,
-- but no client code ever read the parameter, so an invite granted nothing and
-- the row was never marked used. This RPC lets the signup screen validate a
-- token pre-auth; `invites` itself stays fully locked down (migration 13
-- revokes it from anon/authenticated), and the function returns only the
-- invited email — never the token, the inviter, or why validation failed.
CREATE OR REPLACE FUNCTION public.check_invite_token(p_token text)
RETURNS TABLE (valid boolean, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_email text;
BEGIN
  SELECT i.email INTO v_email
  FROM public.invites i
  WHERE i.token = p_token
    AND i.used_at IS NULL
    AND i.expires_at > now()
  LIMIT 1;

  IF v_email IS NULL THEN
    RETURN QUERY SELECT false, NULL::text;
  ELSE
    RETURN QUERY SELECT true, v_email;
  END IF;
END;
$$;
REVOKE ALL    ON FUNCTION public.check_invite_token(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_invite_token(text) TO anon, authenticated;

-- Burn the token once the invited address actually signs up. Keyed on email
-- rather than the token so it cannot be replayed by a different account.
CREATE OR REPLACE FUNCTION public.consume_invite_for_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  BEGIN
    UPDATE public.invites
      SET used_at = now()
      WHERE lower(email) = lower(NEW.email)
        AND used_at IS NULL
        AND expires_at > now();
  EXCEPTION WHEN others THEN
    RAISE WARNING 'consume_invite_for_user: % (%)', NEW.id, SQLERRM;
  END;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_invite ON auth.users;
CREATE TRIGGER on_auth_user_created_invite
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.consume_invite_for_user();

COMMIT;

-- =============================================================================
-- Smoke tests
-- =============================================================================
-- Executable body must no longer reference the dropped helpers (expect false):
--   SELECT prosrc LIKE '%get_resend_key%' OR prosrc LIKE '%build_aurisar_email%'
--   FROM pg_proc WHERE proname = 'notify_mfa_disabled';
--
-- Factor deletion now succeeds end-to-end (staging): enrol TOTP, then run
-- disable_mfa_verified(<factor_id>) — expect true, the factor gone, and one
-- security_alert row in public.notifications for that user.
--
-- Signup enqueues a welcome row in both configurations:
--   SELECT event_type, email_status FROM public.notifications
--   WHERE recipient_id = '<new-user-uuid>';   -- expect ('welcome','pending')
-- With confirmation ON, should_deliver(...,'email') returns 'defer' until the
-- user confirms, then 'send' on a later drain run.
