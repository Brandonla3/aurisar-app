-- =============================================================================
-- 06 — Extend get_friend_profiles_safe to include pending friend requests
-- =============================================================================
-- The Phase-3 client patch uses one RPC for: accepted friends list + incoming
-- friend-request senders + outgoing friend-request recipients. The original
-- 02-rls-add-safe-views-and-rpcs.sql restricted to status='accepted'; this
-- extension also allows pending requests in either direction so the same RPC
-- enriches all three lists.
--
-- This is incremental — run AFTER 02 has already been applied. Idempotent
-- (CREATE OR REPLACE FUNCTION).
-- =============================================================================

BEGIN;

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
        WHERE fr.status IN ('accepted', 'pending')
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

COMMIT;
