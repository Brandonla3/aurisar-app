-- =============================================================================
-- 17 — Notifications spine: outbox + typed prefs + suppressions + checkpoint
-- =============================================================================
-- Foundation for the auth/notifications/email overhaul
-- (docs/auth-notifications-email-plan.md, Batch A).
--
-- What this creates:
--   1. notification_prefs      — typed per-(user, event_type, channel) rows,
--                                replacing the client-only profiles.data->
--                                'notificationPrefs' jsonb blob that nothing
--                                server-side could read per-key.
--   2. notifications           — the append-only outbox. Single source of
--                                truth for every user-facing event. In-app
--                                (realtime) and email (scheduled drain) are
--                                projections of this table; web push can be
--                                added later as a third projection.
--   3. notification_suppressions — the "returns desk": addresses that hard-
--                                bounced or complained. Written by the Resend
--                                webhook function (service role only).
--   4. should_deliver()        — the single checkpoint every email send must
--                                pass: prefs + suppression + verified email +
--                                rate cap. Returns a verdict text rather than
--                                boolean so the drain can distinguish
--                                "skip permanently" from "retry later":
--                                  'send'  — deliver now
--                                  'skip'  — permanent (pref off / suppressed)
--                                  'defer' — not now, retry (e.g. email not
--                                            yet verified for a welcome row)
--   5. notify_friend_level_up() — REPLACED (supersedes the stub left by
--                                migration 14). Level-ups now fan one outbox
--                                row per accepted friend. Postgres never
--                                calls Resend — the Netlify drain does — so
--                                the get_resend_key() Vault follow-up from
--                                migration 12/14 is obsolete.
--
-- RLS/realtime pattern cloned from friend_exercise_events
-- (02-rls-add-safe-views-and-rpcs.sql:101-152).
-- =============================================================================

BEGIN;

-- ── 1. notification_prefs ────────────────────────────────────────────────────
-- Sparse: a row exists only where the user changed something. Absent rows fall
-- back to default_notification_pref(). channel 'push' is reserved (deferred).

CREATE TABLE IF NOT EXISTS public.notification_prefs (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  channel    text NOT NULL CHECK (channel IN ('in_app','email','push')),
  enabled    boolean NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, event_type, channel)
);

ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS notification_prefs_select ON public.notification_prefs;
CREATE POLICY notification_prefs_select
  ON public.notification_prefs FOR SELECT
  TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS notification_prefs_insert ON public.notification_prefs;
CREATE POLICY notification_prefs_insert
  ON public.notification_prefs FOR INSERT
  TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS notification_prefs_update ON public.notification_prefs;
CREATE POLICY notification_prefs_update
  ON public.notification_prefs FOR UPDATE
  TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS notification_prefs_delete ON public.notification_prefs;
CREATE POLICY notification_prefs_delete
  ON public.notification_prefs FOR DELETE
  TO authenticated USING (user_id = auth.uid());

REVOKE ALL ON public.notification_prefs FROM anon;

-- updated_at maintained server-side so clients can't backdate it.
CREATE OR REPLACE FUNCTION public.touch_notification_prefs()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS notification_prefs_touch ON public.notification_prefs;
CREATE TRIGGER notification_prefs_touch
  BEFORE UPDATE ON public.notification_prefs
  FOR EACH ROW EXECUTE FUNCTION public.touch_notification_prefs();

-- Defaults matrix. Mirrors the old client defaults in src/data/constants.js
-- (messageReceived email was default-off; everything else default-on) and
-- adds the new event types. Push is off across the board until the push
-- projection ships.
CREATE OR REPLACE FUNCTION public.default_notification_pref(
  p_event_type text,
  p_channel    text
) RETURNS boolean
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN p_channel = 'push' THEN false
    WHEN p_channel = 'email' THEN CASE p_event_type
      WHEN 'message_received'    THEN false  -- opt-in, matches old default
      WHEN 'review_battle_stats' THEN false  -- in-app-only concept
      WHEN 'workout_reminder'    THEN false  -- opt-in (Batch E)
      ELSE true
    END
    ELSE true  -- in_app: show everything unless the user turns it off
  END;
$$;
REVOKE ALL ON FUNCTION public.default_notification_pref(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.default_notification_pref(text, text) TO authenticated, service_role;

-- ── 2. notifications outbox ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.notifications (
  id            bigserial PRIMARY KEY,
  recipient_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  actor_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type    text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  read_at       timestamptz,
  email_status  text NOT NULL DEFAULT 'pending'
                CHECK (email_status IN ('pending','sending','sent','skipped','failed')),
  email_claimed_at timestamptz,
  email_sent_at timestamptz
);

-- Inbox reads (newest first) and the drain's pending scan.
CREATE INDEX IF NOT EXISTS notifications_recipient_idx
  ON public.notifications (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS notifications_email_pending_idx
  ON public.notifications (created_at)
  WHERE email_status = 'pending';

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Recipient-only SELECT. (Unlike friend_exercise_events, rows are private to
-- the recipient — friends never read each other's inboxes.)
DROP POLICY IF EXISTS notifications_select ON public.notifications;
CREATE POLICY notifications_select
  ON public.notifications FOR SELECT
  TO authenticated USING (recipient_id = auth.uid());

-- Recipients may mark their own rows read — and touch NOTHING else.
-- Column-level grant (same technique as 13-admin-panel.sql's is_admin lock):
-- UPDATE is revoked table-wide, then granted back for read_at only.
DROP POLICY IF EXISTS notifications_update_read ON public.notifications;
CREATE POLICY notifications_update_read
  ON public.notifications FOR UPDATE
  TO authenticated USING (recipient_id = auth.uid()) WITH CHECK (recipient_id = auth.uid());

REVOKE ALL ON public.notifications FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.notifications FROM authenticated;
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;
-- No INSERT policy/grant for clients at all: rows are written only by
-- SECURITY DEFINER trigger/RPC code and the service role.

-- Realtime publication (clone of the 02 block).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime'
      AND schemaname='public'
      AND tablename='notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END $$;

-- Internal enqueue helper for triggers and (Batch D) RPC producers.
-- Not callable by clients.
CREATE OR REPLACE FUNCTION public.enqueue_notification(
  p_recipient  uuid,
  p_actor      uuid,
  p_event_type text,
  p_payload    jsonb DEFAULT '{}'::jsonb
) RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  INSERT INTO public.notifications (recipient_id, actor_id, event_type, payload)
  VALUES (p_recipient, p_actor, p_event_type, COALESCE(p_payload, '{}'::jsonb))
  RETURNING id;
$$;
REVOKE ALL ON FUNCTION public.enqueue_notification(uuid, uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enqueue_notification(uuid, uuid, text, jsonb) TO service_role;

-- ── 3. notification_suppressions (the returns desk) ──────────────────────────
-- Written only by the Resend webhook (service role). RLS enabled with no
-- policies = invisible to anon/authenticated; service role bypasses RLS.

CREATE TABLE IF NOT EXISTS public.notification_suppressions (
  email      text PRIMARY KEY,
  reason     text NOT NULL,             -- 'bounce' | 'complaint' | 'manual'
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_suppressions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_suppressions FROM anon, authenticated;

-- ── 4. should_deliver — the one checkpoint ───────────────────────────────────
-- Called by the drain (service role) per row per channel before any send.
-- Reads auth.users, so SECURITY DEFINER and locked down to service_role.
--
-- Transactional event types ('welcome', 'security_alert') bypass the pref
-- lookup — a user cannot opt out of security notices — but suppression and
-- verified-email rules still apply.

CREATE OR REPLACE FUNCTION public.should_deliver(
  p_recipient  uuid,
  p_event_type text,
  p_channel    text
) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_email        text;
  v_confirmed_at timestamptz;
  v_enabled      boolean;
  v_sent_24h     int;
BEGIN
  IF p_channel = 'email' THEN
    SELECT u.email, u.email_confirmed_at
      INTO v_email, v_confirmed_at
      FROM auth.users u WHERE u.id = p_recipient;

    IF v_email IS NULL THEN
      RETURN 'skip';
    END IF;

    -- Returns desk: hard-bounced / complained addresses never get mail again.
    IF EXISTS (SELECT 1 FROM public.notification_suppressions s WHERE s.email = v_email) THEN
      RETURN 'skip';
    END IF;

    -- Unverified address: not a permanent no — the user may confirm later
    -- (this is what makes the welcome email work when confirmation is ON).
    IF v_confirmed_at IS NULL THEN
      RETURN 'defer';
    END IF;

    -- Blunt per-recipient rate cap: max 20 notification emails per 24h.
    SELECT count(*) INTO v_sent_24h
      FROM public.notifications n
      WHERE n.recipient_id = p_recipient
        AND n.email_status = 'sent'
        AND n.email_sent_at > now() - interval '24 hours';
    IF v_sent_24h >= 20 THEN
      RETURN 'defer';
    END IF;
  END IF;

  -- Transactional types are not opt-out-able.
  IF p_event_type IN ('welcome', 'security_alert') THEN
    RETURN 'send';
  END IF;

  SELECT np.enabled INTO v_enabled
    FROM public.notification_prefs np
    WHERE np.user_id = p_recipient
      AND np.event_type = p_event_type
      AND np.channel = p_channel;

  IF COALESCE(v_enabled, public.default_notification_pref(p_event_type, p_channel)) THEN
    RETURN 'send';
  END IF;
  RETURN 'skip';
END;
$$;
REVOKE ALL ON FUNCTION public.should_deliver(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.should_deliver(uuid, text, text) TO service_role;

-- Email-channel wrapper for the drain: one round-trip returning the verdict
-- plus the recipient address (only when the verdict is 'send' — the address
-- never leaves the DB for skipped/deferred rows). auth.users is not exposed
-- over PostgREST, which is why the drain can't read the email itself.
CREATE OR REPLACE FUNCTION public.should_deliver_email(
  p_recipient  uuid,
  p_event_type text
) RETURNS TABLE (verdict text, email text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_verdict text;
BEGIN
  v_verdict := public.should_deliver(p_recipient, p_event_type, 'email');
  IF v_verdict = 'send' THEN
    RETURN QUERY
      SELECT v_verdict, u.email::text FROM auth.users u WHERE u.id = p_recipient;
  ELSE
    RETURN QUERY SELECT v_verdict, NULL::text;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.should_deliver_email(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.should_deliver_email(uuid, text) TO service_role;

-- ── 4b. Atomic claim for the email drain ─────────────────────────────────────
-- FOR UPDATE SKIP LOCKED means two overlapping drain invocations can never
-- claim the same row — the at-least-once half of the duplicate-send defence
-- (the Resend idempotency key is the other half). Rows stuck in 'sending'
-- longer than 15 minutes (a crashed run) are reclaimed first.

CREATE OR REPLACE FUNCTION public.claim_notification_emails(
  p_batch int DEFAULT 25
) RETURNS SETOF public.notifications
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Recover rows a crashed run left behind.
  UPDATE public.notifications
    SET email_status = 'pending', email_claimed_at = NULL
    WHERE email_status = 'sending'
      AND email_claimed_at < now() - interval '15 minutes';

  RETURN QUERY
  UPDATE public.notifications n
    SET email_status = 'sending', email_claimed_at = now()
    WHERE n.id IN (
      SELECT id FROM public.notifications
      WHERE email_status = 'pending'
      ORDER BY created_at
      LIMIT GREATEST(1, LEAST(p_batch, 100))
      FOR UPDATE SKIP LOCKED
    )
    RETURNING n.*;
END;
$$;
REVOKE ALL ON FUNCTION public.claim_notification_emails(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_notification_emails(int) TO service_role;

-- ── 5. notify_friend_level_up — supersedes the migration-14 stub ─────────────
-- Same trigger, real fan-out: one outbox row per accepted friend. Email
-- delivery happens later in the Netlify drain; in-app delivery is instant
-- via the realtime publication above.

CREATE OR REPLACE FUNCTION public.notify_friend_level_up()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  old_xp    bigint;
  new_xp    bigint;
  old_level int;
  new_level int;
BEGIN
  old_xp := COALESCE((OLD.data->>'xp')::bigint, 0);
  new_xp := COALESCE((NEW.data->>'xp')::bigint, 0);
  IF new_xp <= old_xp THEN RETURN NEW; END IF;
  old_level := public.xp_to_level(old_xp);
  new_level := public.xp_to_level(new_xp);
  IF new_level <= old_level THEN RETURN NEW; END IF;

  INSERT INTO public.notifications (recipient_id, actor_id, event_type, payload)
  SELECT
    CASE WHEN fr.from_user_id = NEW.id THEN fr.to_user_id ELSE fr.from_user_id END,
    NEW.id,
    'friend_level_up',
    jsonb_build_object(
      'playerName', COALESCE(NEW.data->>'playerName', 'A friend'),
      'newLevel',   new_level
    )
  FROM public.friend_requests fr
  WHERE fr.status = 'accepted'
    AND (fr.from_user_id = NEW.id OR fr.to_user_id = NEW.id);

  RETURN NEW;
END;
$$;

COMMIT;

-- =============================================================================
-- Smoke-test queries to run after applying:
-- =============================================================================
-- Should return 1 row (realtime wired):
--   SELECT 1 FROM pg_publication_tables
--   WHERE pubname='supabase_realtime' AND tablename='notifications';
--
-- Should return 3 rows, all rowsecurity=true:
--   SELECT tablename, rowsecurity FROM pg_tables
--   WHERE tablename IN ('notification_prefs','notifications','notification_suppressions');
--
-- Should be 'send' (fresh user, default-on event):
--   SELECT public.should_deliver('<some-user-uuid>', 'friend_level_up', 'email');
--
-- Should be 'skip' (message_received email defaults off):
--   SELECT public.should_deliver('<some-user-uuid>', 'message_received', 'email');
--
-- Client UPDATE surface is read_at only — this should FAIL as authenticated:
--   UPDATE public.notifications SET payload='{}'::jsonb WHERE id=1;
