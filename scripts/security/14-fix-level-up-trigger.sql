-- =============================================================================
-- 14 — Fix two broken profile UPDATE triggers that silently blocked all saves
-- =============================================================================
-- Two trigger functions were broken after migration 12 (security_hardening_12),
-- causing every sb.from("profiles").upsert() from the app to fail silently.
-- doSave() catches the Postgres error and only console.warns, so users saw
-- no error but their workouts, XP, and profile changes never reached Supabase.
--
-- Bug 1: notify_friend_level_up() called get_resend_key() which was DROPPED
-- in migration 12. Any profile UPDATE where XP increased enough to cross a
-- level boundary would fail with:
--   ERROR: function get_resend_key() does not exist
-- Fix: remove the http_post email block. Level-up detection is preserved;
-- email notification will be re-wired via a Vault secret in a follow-up.
--
-- Bug 2: backup_profile_on_update() had SET search_path='' applied by
-- migration 12's security hardening, but its body still used the unqualified
-- table name "profile_backups" instead of "public.profile_backups". Every
-- profile UPDATE triggered:
--   ERROR: relation "profile_backups" does not exist
-- Fix: qualify all table references with the public schema.
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
