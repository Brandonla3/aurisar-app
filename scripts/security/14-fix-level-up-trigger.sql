-- =============================================================================
-- 14 — Fix three broken profile trigger functions after migration 12
-- =============================================================================
-- Migration 12 (security_hardening_12) set search_path='' on several trigger
-- functions and dropped get_resend_key(). This broke three functions called
-- during profile upserts, causing every sb.from("profiles").upsert() from
-- the app to fail silently (doSave() catches errors with console.warn only).
--
-- Bug 1 — notify_friend_level_up(): called get_resend_key() which was DROPPED
-- in migration 12. Any profile UPDATE where XP crossed a level boundary failed:
--   ERROR: function get_resend_key() does not exist
-- Fix: remove the http_post email block. Level-up detection preserved for a
-- future Vault-backed re-implementation.
--
-- Bug 2 — backup_profile_on_update(): had SET search_path='' applied but still
-- used unqualified "profile_backups". Every profile UPDATE triggered:
--   ERROR: relation "profile_backups" does not exist
-- Fix: qualify all table references as public.profile_backups.
--
-- Bug 3 — trigger_set_profile_ids(): had SET search_path='' applied but still
-- called generate_public_id() and generate_private_id() without schema prefix,
-- and referenced "profiles" unqualified. This trigger fires on every INSERT
-- attempt in an upsert (including the INSERT→conflict→UPDATE path), so it
-- blocked ALL profile upserts with:
--   ERROR: function generate_public_id() does not exist
-- Fix: qualify all function calls and table references with public.
-- =============================================================================

-- ── 1. Fix notify_friend_level_up ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.notify_friend_level_up()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
declare
  old_xp    bigint;
  new_xp    bigint;
  old_level int;
  new_level int;
begin
  old_xp := coalesce((OLD.data->>'xp')::bigint, 0);
  new_xp := coalesce((NEW.data->>'xp')::bigint, 0);
  if new_xp <= old_xp then return NEW; end if;
  old_level := public.xp_to_level(old_xp);
  new_level := public.xp_to_level(new_xp);
  if new_level <= old_level then return NEW; end if;
  -- Level-up detected. Email notification disabled until get_resend_key() is
  -- replaced with a Vault-backed secret (follow-up task).
  return NEW;
end;
$$;

-- ── 2. Fix backup_profile_on_update ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.backup_profile_on_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profile_backups(user_id, data, source)
  VALUES (OLD.id, OLD.data, 'trigger');

  DELETE FROM public.profile_backups pb
  WHERE pb.user_id = OLD.id
    AND pb.id NOT IN (
      SELECT id FROM public.profile_backups
      WHERE user_id = OLD.id AND backed_up_at >= now() - interval '7 days'

      UNION

      SELECT id FROM (
        SELECT DISTINCT ON (backed_up_at::date) id
        FROM public.profile_backups
        WHERE user_id = OLD.id
          AND backed_up_at >= now() - interval '30 days'
          AND backed_up_at <  now() - interval '7 days'
        ORDER BY backed_up_at::date, backed_up_at DESC
      ) d

      UNION

      SELECT id FROM (
        SELECT DISTINCT ON (date_trunc('week', backed_up_at)) id
        FROM public.profile_backups
        WHERE user_id = OLD.id
          AND backed_up_at >= now() - interval '6 months'
          AND backed_up_at <  now() - interval '30 days'
        ORDER BY date_trunc('week', backed_up_at), backed_up_at DESC
      ) w

      UNION

      SELECT id FROM (
        SELECT DISTINCT ON (date_trunc('month', backed_up_at)) id
        FROM public.profile_backups
        WHERE user_id = OLD.id
          AND backed_up_at < now() - interval '6 months'
        ORDER BY date_trunc('month', backed_up_at), backed_up_at DESC
      ) m
    );

  RETURN NEW;
END;
$$;

-- ── 3. Fix trigger_set_profile_ids ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trigger_set_profile_ids()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  new_public TEXT;
  new_private TEXT;
  attempts INT := 0;
BEGIN
  IF NEW.public_id IS NULL THEN
    LOOP
      new_public := public.generate_public_id();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE public_id = new_public);
      attempts := attempts + 1;
      IF attempts > 50 THEN RAISE EXCEPTION 'Could not generate unique public_id'; END IF;
    END LOOP;
    NEW.public_id := new_public;
  END IF;

  IF NEW.private_id IS NULL THEN
    LOOP
      new_private := public.generate_private_id();
      EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE private_id = new_private);
      attempts := attempts + 1;
      IF attempts > 100 THEN RAISE EXCEPTION 'Could not generate unique private_id'; END IF;
    END LOOP;
    NEW.private_id := new_private;
  END IF;

  RETURN NEW;
END;
$$;
