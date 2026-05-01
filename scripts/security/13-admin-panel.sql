-- =============================================================================
-- 13 — Admin panel schema
-- =============================================================================
-- Adds the infrastructure for the in-app admin page:
--   1. `is_admin` boolean column on profiles  (who can access admin functions)
--   2. `disabled_at` timestamptz on profiles  (soft-disable / deprovision)
--   3. `invites` table                        (custom invite tokens + tracking)
--   4. `admin_list_users()` RPC               (service_role only — user list)
--
-- Security model:
--   - All admin WRITE operations go through Netlify Functions that use
--     SUPABASE_SERVICE_ROLE_KEY. The frontend NEVER holds the service key.
--   - `admin_list_users()` is SECURITY DEFINER but REVOKED from anon +
--     authenticated — only callable by service_role (the Netlify fn) or postgres.
--   - `is_admin` and `disabled_at` are top-level columns, NOT inside the
--     `data` JSONB, so users cannot self-modify them through the normal
--     profile-save path (which only upserts the `data` column).
--
-- After applying, seed your own account:
--   UPDATE public.profiles SET is_admin = true WHERE id = '<your-uuid>';
-- =============================================================================

BEGIN;

-- ── 1. Add is_admin + disabled_at to profiles ────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin    boolean      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz           DEFAULT NULL;

-- Column-level privilege lock: revoke UPDATE on these two columns from the
-- `authenticated` role entirely. This is the correct defence-in-depth layer:
-- even if a future RLS policy is too broad (e.g. "users can update their own
-- row" without column restrictions), authenticated users still cannot write
-- is_admin or disabled_at through the PostgREST / Supabase client.
-- service_role bypasses column-level grants, so Netlify functions are unaffected.
REVOKE UPDATE (is_admin, disabled_at) ON public.profiles FROM authenticated;

-- ── 2. invites table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invites (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  token       text        UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  email       text        NOT NULL,
  invited_by  uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  used_at     timestamptz DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS invites_token_idx ON public.invites (token);
CREATE INDEX IF NOT EXISTS invites_email_idx ON public.invites (lower(email));

ALTER TABLE public.invites ENABLE ROW LEVEL SECURITY;

-- Zero public access — all operations go through Netlify functions using
-- service_role. No anon or authenticated policies needed.
REVOKE ALL ON TABLE public.invites FROM PUBLIC, anon, authenticated;
GRANT  ALL ON TABLE public.invites TO service_role;

-- ── 3. admin_list_users() RPC ────────────────────────────────────────────────
-- Returns a full user roster joining auth.users + profiles.
-- SECURITY DEFINER + REVOKE authenticated means only service_role (bypasses
-- GRANT checks entirely) or postgres can invoke it.
DROP FUNCTION IF EXISTS public.admin_list_users();
CREATE OR REPLACE FUNCTION public.admin_list_users()
RETURNS TABLE (
  id              uuid,
  email           text,
  public_id       text,
  player_name     text,
  is_admin        boolean,
  disabled_at     timestamptz,
  created_at      timestamptz,
  last_sign_in_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT
    u.id,
    u.email,
    p.public_id,
    COALESCE(p.data->>'playerName', '')        AS player_name,
    COALESCE(p.is_admin, false)                AS is_admin,
    p.disabled_at,
    u.created_at,
    u.last_sign_in_at
  FROM auth.users u
  LEFT JOIN public.profiles p ON p.id = u.id
  ORDER BY u.created_at DESC;
$$;

REVOKE ALL     ON FUNCTION public.admin_list_users() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.admin_list_users() FROM anon, authenticated;
-- service_role bypasses GRANT checks so no explicit GRANT needed.

COMMIT;

-- =============================================================================
-- Post-apply checklist:
--
--   1. Verify columns exist:
--        SELECT column_name, data_type, column_default
--        FROM information_schema.columns
--        WHERE table_name = 'profiles'
--          AND column_name IN ('is_admin', 'disabled_at');
--
--   2. Verify invites table:
--        SELECT table_name FROM information_schema.tables
--        WHERE table_name = 'invites';
--
--   3. Verify RPC (not callable by authenticated):
--        -- As authenticated user, this should return: "insufficient_privilege"
--        SELECT * FROM public.admin_list_users();
--
--   4. Seed your admin account:
--        UPDATE public.profiles SET is_admin = true WHERE id = '<your-uuid>';
--
--   5. Add SUPABASE_SERVICE_ROLE_KEY to Netlify environment variables.
--      (Supabase Dashboard → Settings → API → service_role key)
-- =============================================================================
