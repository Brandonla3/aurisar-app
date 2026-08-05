-- =============================================================================
-- 28 — Stop handing WHOOP OAuth tokens to the browser
-- =============================================================================
-- whoop_tokens carries `access_token` and `refresh_token` in plaintext. Its
-- only policy is `own tokens only` — FOR ALL USING (auth.uid() = user_id) —
-- and anon/authenticated hold full table grants. So any session can
--
--   GET /rest/v1/whoop_tokens?select=access_token,refresh_token
--
-- and read live OAuth credentials for a third-party health API.
--
-- Nothing needs that. The client's ONLY use is a connected/not-connected
-- check, and it selects a single harmless column:
--
--   src/features/profile/ProfileTab.jsx:289
--     sb.from('whoop_tokens').select('user_id').eq('user_id', authUser.id)
--
-- Every real token use is server-side, through the service role, which
-- bypasses RLS and is unaffected by anything below:
--   netlify/functions/whoop-token-exchange.js:92  (SERVICE_ROLE_KEY)
--   netlify/functions/whoop-fetch-data.js:137     (SERVICE_ROLE_KEY)
--
-- Why this is worth closing even though the policy is already self-scoped: a
-- refresh token is not session-scoped. Lift one via XSS, a shared device or a
-- leaked JWT and it keeps working after the password changes, after the
-- session expires, and after MFA is enrolled — silently, against health data,
-- which is a special category under GDPR. The blast radius of a stolen
-- session should not include a durable credential the app never hands out.
--
-- whoop_data is deliberately left alone: that one IS the user's own data,
-- read by the profile UI, and `auth.uid() = user_id` is exactly right for it.

-- -----------------------------------------------------------------------------
-- 1. Take the table away from the client roles entirely
-- -----------------------------------------------------------------------------
-- With no grants, RLS never even gets consulted for anon/authenticated; the
-- service role bypasses RLS as before. RLS stays enabled so the table is not
-- silently wide open if a grant is ever restored by hand.

REVOKE ALL ON TABLE public.whoop_tokens FROM PUBLIC, anon, authenticated;

ALTER TABLE public.whoop_tokens ENABLE ROW LEVEL SECURITY;

-- The policy only ever granted client access to token material. Dropping it
-- leaves the table in the same shape as notification_suppressions and
-- phone_verification_codes: RLS on, no client policy, definer/service only.
DROP POLICY IF EXISTS "own tokens only" ON public.whoop_tokens;

-- -----------------------------------------------------------------------------
-- 2. Give the UI the one fact it actually wanted
-- -----------------------------------------------------------------------------
-- Returns connection metadata only. No access_token, no refresh_token — the
-- columns are not selected, so no future caller can widen this by accident.

CREATE OR REPLACE FUNCTION public.whoop_connection_status()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(
    (SELECT jsonb_build_object(
       'connected',             true,
       'scope',                 t.scope,
       'last_synced_at',        t.last_synced_at,
       'backfill_completed_at', t.backfill_completed_at,
       'expires_at',            t.expires_at
     )
     FROM public.whoop_tokens t
     WHERE t.user_id = auth.uid()),
    jsonb_build_object('connected', false)
  );
$$;

REVOKE ALL ON FUNCTION public.whoop_connection_status() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.whoop_connection_status() TO authenticated;
