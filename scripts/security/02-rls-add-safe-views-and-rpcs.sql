-- =============================================================================
-- H-4 — STAGE 1: additive RLS hardening (safe to run anytime)
-- =============================================================================
-- This migration is purely additive — it adds a public-safe view, three
-- SECURITY DEFINER RPCs the client uses for peer reads, and a friend-event
-- table for the realtime banner. Existing queries keep working.
--
-- Run this BEFORE deploying the matching client patch (or simultaneously),
-- THEN run 03-rls-tighten-profiles.sql to lock down direct peer reads.
-- =============================================================================

BEGIN;

-- 1. Safe view of profile fields a peer is allowed to see.
CREATE OR REPLACE VIEW public.profiles_public AS
SELECT
  id,
  public_id,
  player_name,
  chosen_class,
  level,
  total_xp,
  state,
  country
FROM public.profiles;

GRANT SELECT ON public.profiles_public TO authenticated;

-- 2. RPC: return safe rows for a list of user-IDs, restricted to the caller's
--    accepted friends. Used by friend list, share-targets, friend-request
--    sender enrichment, and incoming-share sender enrichment.
CREATE OR REPLACE FUNCTION public.get_friend_profiles_safe(p_user_ids uuid[])
RETURNS TABLE (
  id            uuid,
  public_id     text,
  player_name   text,
  chosen_class  text,
  level         int,
  total_xp      bigint,
  state         text,
  country       text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT pp.*
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

REVOKE ALL ON FUNCTION public.get_friend_profiles_safe(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_friend_profiles_safe(uuid[]) TO authenticated;

-- 3. RPC: return the caller's incoming share senders (used to enrich
--    `loadIncomingShares`). Same pattern, but restricted to senders of
--    pending shares to the caller.
CREATE OR REPLACE FUNCTION public.get_share_sender_profiles(p_share_ids bigint[])
RETURNS TABLE (
  id            uuid,
  player_name   text,
  chosen_class  text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT DISTINCT p.id, p.player_name, p.chosen_class
  FROM public.profiles p
  JOIN public.shared_items s ON s.from_user_id = p.id
  WHERE s.id = ANY (p_share_ids)
    AND s.to_user_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_share_sender_profiles(bigint[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_share_sender_profiles(bigint[]) TO authenticated;

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

ALTER PUBLICATION supabase_realtime ADD TABLE public.friend_exercise_events;

COMMIT;
