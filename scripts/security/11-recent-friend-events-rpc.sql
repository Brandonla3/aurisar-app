-- =============================================================================
-- 11 — RPC: get most-recent friend exercise event per friend
-- =============================================================================
-- Used by the social tab to render "Latest: 💪 Squats" on each friend card.
-- The RLS predicate restricts results to events from accepted friends only,
-- so the SECURITY DEFINER wrapper doesn't need an explicit auth check beyond
-- relying on auth.uid() in the predicate.
--
-- Returns the N most recent events for each of the caller's accepted friends.
-- Default limit per friend = 1 (matches the card's "Latest" line).
--
-- Idempotent.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_recent_friend_events(
  p_limit_per_friend int DEFAULT 1
)
RETURNS TABLE (
  user_id       uuid,
  exercise_name text,
  exercise_id   text,
  exercise_icon text,
  is_pb         boolean,
  pb_value      numeric,
  pb_type       text,
  created_at    timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT t.user_id, t.exercise_name, t.exercise_id, t.exercise_icon,
         t.is_pb, t.pb_value, t.pb_type, t.created_at
  FROM (
    SELECT
      e.*,
      ROW_NUMBER() OVER (PARTITION BY e.user_id ORDER BY e.created_at DESC) AS rn
    FROM public.friend_exercise_events e
    WHERE EXISTS (
      SELECT 1 FROM public.friend_requests fr
      WHERE fr.status = 'accepted'
        AND (
          (fr.from_user_id = auth.uid() AND fr.to_user_id   = e.user_id)
          OR
          (fr.to_user_id   = auth.uid() AND fr.from_user_id = e.user_id)
        )
    )
  ) t
  WHERE t.rn <= GREATEST(1, LEAST(p_limit_per_friend, 10));
$$;

REVOKE ALL    ON FUNCTION public.get_recent_friend_events(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_recent_friend_events(int) TO authenticated;
