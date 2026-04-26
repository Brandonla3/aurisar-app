-- =============================================================================
-- H-4 — STAGE 1: additive RLS hardening (safe to run anytime)
-- =============================================================================
-- v2 corrections (2026-04-26): real schema has `profiles.data` jsonb with the
-- friendly fields nested as camelCase keys (playerName, chosenClass, xp,
-- state, country). The earlier draft assumed top-level columns. Also
-- shared_items.id is uuid, not bigint.
--
-- Apply order:
--   1. Run 01-rls-audit.sql + 01b-discover-schema.sql first.
--   2. Apply this file (02). Additive only — does not break existing reads.
--   3. Later (after a follow-up client PR): apply 03-rls-tighten-profiles.sql.
-- =============================================================================

BEGIN;

-- 1. Public-safe view of `profiles`. Pulls the friendly fields out of the
--    `data` jsonb so peer code can read them without seeing real name, phone,
--    log, or any other PII still in `data`. Casts xp to bigint and falls back
--    to 0 when missing/non-numeric.
CREATE OR REPLACE VIEW public.profiles_public AS
SELECT
  p.id,
  p.public_id,
  COALESCE(p.data->>'playerName', 'Unknown Warrior')   AS player_name,
  p.data->>'chosenClass'                                AS chosen_class,
  COALESCE(NULLIF(p.data->>'xp', '')::bigint, 0)       AS xp,
  p.data->>'state'                                      AS state,
  p.data->>'country'                                    AS country
FROM public.profiles p;

GRANT SELECT ON public.profiles_public TO authenticated;

-- 2. RPC: return safe rows for a list of user-IDs, restricted to the caller's
--    accepted friends. Used by friend list, share-targets, friend-request
--    sender enrichment, and incoming-share sender enrichment.
DROP FUNCTION IF EXISTS public.get_friend_profiles_safe(uuid[]);
CREATE OR REPLACE FUNCTION public.get_friend_profiles_safe(p_user_ids uuid[])
RETURNS TABLE (
  id            uuid,
  public_id     text,
  player_name   text,
  chosen_class  text,
  xp            bigint,
  state         text,
  country       text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT pp.id, pp.public_id, pp.player_name, pp.chosen_class, pp.xp, pp.state, pp.country
  FROM public.profiles_public pp
  WHERE pp.id = ANY (p_user_ids)
    AND (
      pp.id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.friend_requests fr
        WHERE fr.status = 'accepted'
          AND (
            (fr.from_user_id = auth.uid() AND fr.to_user_id   = pp.id)
            OR
            (fr.to_user_id   = auth.uid() AND fr.from_user_id = pp.id)
          )
      )
    );
$$;

REVOKE ALL    ON FUNCTION public.get_friend_profiles_safe(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_friend_profiles_safe(uuid[]) TO authenticated;

-- 3. RPC: return the senders of a list of pending shares the caller has
--    received. Used by `loadIncomingShares` once the client migrates off
--    `from('profiles').select('id,data').in('id', senderIds)`.
--    p_share_ids is uuid[] (not bigint[]) — shared_items.id is uuid.
DROP FUNCTION IF EXISTS public.get_share_sender_profiles(uuid[]);
CREATE OR REPLACE FUNCTION public.get_share_sender_profiles(p_share_ids uuid[])
RETURNS TABLE (
  id            uuid,
  player_name   text,
  chosen_class  text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT DISTINCT pp.id, pp.player_name, pp.chosen_class
  FROM public.profiles_public pp
  JOIN public.shared_items s ON s.from_user_id = pp.id
  WHERE s.id = ANY (p_share_ids)
    AND s.to_user_id = auth.uid();
$$;

REVOKE ALL    ON FUNCTION public.get_share_sender_profiles(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_share_sender_profiles(uuid[]) TO authenticated;

-- 4. Friend exercise event table — replaces the broken realtime subscription
--    on `profiles.UPDATE`. The actor inserts a row when they complete an
--    exercise; only friends can SELECT it; realtime publication is scoped
--    so peers never see anyone else's payload.
CREATE TABLE IF NOT EXISTS public.friend_exercise_events (
  id            bigserial PRIMARY KEY,
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  exercise_name text,
  exercise_id   text,
  exercise_icon text,
  is_pb         boolean DEFAULT false,
  pb_value      numeric,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS friend_exercise_events_user_idx
  ON public.friend_exercise_events (user_id, created_at DESC);

ALTER TABLE public.friend_exercise_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS friend_exercise_events_select ON public.friend_exercise_events;
CREATE POLICY friend_exercise_events_select
  ON public.friend_exercise_events
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.friend_requests fr
      WHERE fr.status = 'accepted'
        AND (
          (fr.from_user_id = auth.uid() AND fr.to_user_id   = friend_exercise_events.user_id)
          OR
          (fr.to_user_id   = auth.uid() AND fr.from_user_id = friend_exercise_events.user_id)
        )
    )
  );

DROP POLICY IF EXISTS friend_exercise_events_insert ON public.friend_exercise_events;
CREATE POLICY friend_exercise_events_insert
  ON public.friend_exercise_events
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Add to realtime publication if not already a member.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime'
      AND schemaname='public'
      AND tablename='friend_exercise_events'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.friend_exercise_events';
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- Smoke-test queries to run after applying:
-- =============================================================================
-- Should return 0 rows: SELECT 1 FROM public.profiles_public LIMIT 0;
--                       (i.e. the view exists)
-- Should return 2 rows:
--   SELECT proname, prosecdef FROM pg_proc
--   WHERE proname IN ('get_friend_profiles_safe','get_share_sender_profiles');
--   (both prosecdef=true)
-- Should return 1 row:
--   SELECT 1 FROM pg_publication_tables
--   WHERE pubname='supabase_realtime' AND tablename='friend_exercise_events';
