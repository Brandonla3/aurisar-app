-- 16-fix-messaging-rpcs-search-path.sql
--
-- The blanket hardening in 15-track-pre-existing-objects.sql pinned
-- SET search_path TO '' onto the messaging RPCs, but their bodies reference
-- unqualified relations (channel_members, channels, messages, profiles,
-- friend_requests) and xp_to_level(). With an empty search_path every call
-- fails at runtime with "relation does not exist", which broke Messages
-- entirely (the client swallows the errors, so the tab just looked empty).
--
-- This recreates the five messaging RPCs with the repo-standard
-- SET search_path = public, auth (see 06-extend-friend-rpc.sql) and adds
-- mark_channel_read() so the client can mark a channel read without
-- refetching its message window.
--
-- The same empty-search_path breakage also hit update_channel_timestamp(),
-- the AFTER INSERT trigger on public.messages: it UPDATEs `channels`
-- unqualified, so with search_path='' every send_message() insert raised
-- "relation channels does not exist" — i.e. sending was broken even once
-- the RPCs themselves were fixed. It is repinned here too.

BEGIN;

-- ── update_channel_timestamp (messages INSERT trigger) ──────────────────────
CREATE OR REPLACE FUNCTION public.update_channel_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, auth
AS $$
BEGIN
  UPDATE channels SET updated_at = NOW() WHERE id = NEW.channel_id;
  RETURN NEW;
END;
$$;

-- ── get_or_create_dm_channel ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_or_create_dm_channel(p_other_user_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  existing_channel UUID;
  new_channel UUID;
  me UUID := auth.uid();
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF me = p_other_user_id THEN RAISE EXCEPTION 'Cannot DM yourself'; END IF;

  -- Check if DM channel already exists between these two users
  SELECT cm1.channel_id INTO existing_channel
  FROM channel_members cm1
  JOIN channel_members cm2 ON cm1.channel_id = cm2.channel_id
  JOIN channels c ON c.id = cm1.channel_id
  WHERE cm1.user_id = me
    AND cm2.user_id = p_other_user_id
    AND c.type = 'dm'
  LIMIT 1;

  IF existing_channel IS NOT NULL THEN
    RETURN existing_channel;
  END IF;

  -- Verify they are friends
  IF NOT EXISTS (
    SELECT 1 FROM friend_requests
    WHERE status = 'accepted'
      AND ((from_user_id = me AND to_user_id = p_other_user_id)
        OR (from_user_id = p_other_user_id AND to_user_id = me))
  ) THEN
    RAISE EXCEPTION 'You can only message friends';
  END IF;

  -- Create new DM channel
  INSERT INTO channels (type, created_by) VALUES ('dm', me)
  RETURNING id INTO new_channel;

  -- Add both users as members
  INSERT INTO channel_members (channel_id, user_id, role) VALUES
    (new_channel, me, 'member'),
    (new_channel, p_other_user_id, 'member');

  RETURN new_channel;
END;
$$;

-- ── get_my_conversations ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_conversations()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  me UUID := auth.uid();
  result JSONB;
BEGIN
  IF me IS NULL THEN RETURN '[]'::jsonb; END IF;

  SELECT jsonb_agg(row_data ORDER BY last_activity DESC)
  INTO result
  FROM (
    SELECT jsonb_build_object(
      'channel_id', c.id,
      'type', c.type,
      'name', c.name,
      'icon', c.icon,
      'metadata', c.metadata,
      'other_user', CASE WHEN c.type = 'dm' THEN (
        SELECT jsonb_build_object(
          'user_id', p.id,
          'player_name', p.data->>'playerName',
          'chosen_class', p.data->>'chosenClass',
          'public_id', p.public_id,
          'level', xp_to_level(coalesce((p.data->>'xp')::bigint, 0))
        )
        FROM channel_members cm2
        JOIN profiles p ON p.id = cm2.user_id
        WHERE cm2.channel_id = c.id AND cm2.user_id != me
        LIMIT 1
      ) ELSE NULL END,
      'last_message', (
        SELECT jsonb_build_object(
          'content', m.content,
          'sender_id', m.sender_id,
          'message_type', m.message_type,
          'created_at', m.created_at
        )
        FROM messages m
        WHERE m.channel_id = c.id AND m.deleted_at IS NULL
        ORDER BY m.created_at DESC LIMIT 1
      ),
      'unread_count', (
        SELECT count(*)
        FROM messages m
        WHERE m.channel_id = c.id
          AND m.deleted_at IS NULL
          AND m.created_at > cm.last_read_at
          AND m.sender_id != me
      ),
      'muted', cm.muted,
      'last_activity', c.updated_at
    ) AS row_data,
    c.updated_at AS last_activity
    FROM channel_members cm
    JOIN channels c ON c.id = cm.channel_id
    WHERE cm.user_id = me
  ) sub;

  RETURN coalesce(result, '[]'::jsonb);
END;
$$;

-- ── get_channel_messages ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_channel_messages(
  p_channel_id uuid,
  p_limit integer DEFAULT 50,
  p_before timestamp with time zone DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  me UUID := auth.uid();
  result JSONB;
BEGIN
  IF me IS NULL THEN RETURN '[]'::jsonb; END IF;

  -- Verify membership
  IF NOT EXISTS (SELECT 1 FROM channel_members WHERE channel_id = p_channel_id AND user_id = me) THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT jsonb_agg(row_data ORDER BY msg_time ASC)
  INTO result
  FROM (
    SELECT jsonb_build_object(
      'id', m.id,
      'sender_id', m.sender_id,
      'sender_name', coalesce(p.data->>'playerName', 'System'),
      'sender_class', p.data->>'chosenClass',
      'sender_public_id', p.public_id,
      'message_type', m.message_type,
      'content', m.content,
      'metadata', m.metadata,
      'reply_to', m.reply_to,
      'edited_at', m.edited_at,
      'is_mine', (m.sender_id = me),
      'created_at', m.created_at
    ) AS row_data,
    m.created_at AS msg_time
    FROM messages m
    LEFT JOIN profiles p ON p.id = m.sender_id
    WHERE m.channel_id = p_channel_id
      AND m.deleted_at IS NULL
      AND (p_before IS NULL OR m.created_at < p_before)
    ORDER BY m.created_at DESC
    LIMIT p_limit
  ) sub;

  -- Mark as read
  UPDATE channel_members SET last_read_at = NOW()
  WHERE channel_id = p_channel_id AND user_id = me;

  RETURN coalesce(result, '[]'::jsonb);
END;
$$;

-- ── send_message ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.send_message(
  p_channel_id uuid,
  p_content text,
  p_message_type text DEFAULT 'text',
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_reply_to uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  me UUID := auth.uid();
  new_msg_id UUID;
BEGIN
  IF me IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_content IS NULL OR trim(p_content) = '' THEN RAISE EXCEPTION 'Message cannot be empty'; END IF;

  -- Verify membership
  IF NOT EXISTS (SELECT 1 FROM channel_members WHERE channel_id = p_channel_id AND user_id = me) THEN
    RAISE EXCEPTION 'Not a member of this channel';
  END IF;

  INSERT INTO messages (channel_id, sender_id, message_type, content, metadata, reply_to)
  VALUES (p_channel_id, me, p_message_type, trim(p_content), p_metadata, p_reply_to)
  RETURNING id INTO new_msg_id;

  -- Update sender's last_read to now
  UPDATE channel_members SET last_read_at = NOW()
  WHERE channel_id = p_channel_id AND user_id = me;

  RETURN new_msg_id;
END;
$$;

-- ── get_total_unread_count ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_total_unread_count()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  me UUID := auth.uid();
  total INT;
BEGIN
  IF me IS NULL THEN RETURN 0; END IF;

  SELECT coalesce(sum(cnt), 0) INTO total
  FROM (
    SELECT count(*) AS cnt
    FROM channel_members cm
    JOIN messages m ON m.channel_id = cm.channel_id
    WHERE cm.user_id = me
      AND m.deleted_at IS NULL
      AND m.created_at > cm.last_read_at
      AND m.sender_id != me
      AND NOT cm.muted
  ) sub;

  RETURN total;
END;
$$;

-- ── mark_channel_read (new) ─────────────────────────────────────────────────
-- Lets the client mark a channel read on incoming realtime messages without
-- refetching the whole message window via get_channel_messages.
CREATE OR REPLACE FUNCTION public.mark_channel_read(p_channel_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  me UUID := auth.uid();
BEGIN
  IF me IS NULL THEN RETURN; END IF;

  UPDATE channel_members SET last_read_at = NOW()
  WHERE channel_id = p_channel_id AND user_id = me;
END;
$$;

-- ── Grants ──────────────────────────────────────────────────────────────────
REVOKE ALL    ON FUNCTION public.get_or_create_dm_channel(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_dm_channel(uuid) TO authenticated;

REVOKE ALL    ON FUNCTION public.get_my_conversations() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_conversations() TO authenticated;

REVOKE ALL    ON FUNCTION public.get_channel_messages(uuid, integer, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_channel_messages(uuid, integer, timestamptz) TO authenticated;

REVOKE ALL    ON FUNCTION public.send_message(uuid, text, text, jsonb, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.send_message(uuid, text, text, jsonb, uuid) TO authenticated;

REVOKE ALL    ON FUNCTION public.get_total_unread_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_total_unread_count() TO authenticated;

REVOKE ALL    ON FUNCTION public.mark_channel_read(uuid) FROM PUBLIC;
REVOKE ALL    ON FUNCTION public.mark_channel_read(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.mark_channel_read(uuid) TO authenticated;

COMMIT;
