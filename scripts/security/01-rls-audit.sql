-- =============================================================================
-- H-4 — RLS audit (READ-ONLY)
-- =============================================================================
-- Run this in Supabase Dashboard → SQL Editor → New query.
-- Read the results before applying 02-rls-tighten-profiles.sql, because the
-- output tells you which tables already have RLS, which policies exist, and
-- which Realtime publications expose which tables.
-- =============================================================================

-- 1. Tables WITHOUT row-level security in the public schema.
--    Anything in this list is publicly readable/writable to anyone with the
--    anon JWT. Treat each row as a finding.
SELECT
  schemaname,
  tablename,
  rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
  AND rowsecurity = false
ORDER BY tablename;

-- 2. All policies in the public schema, grouped by table + command.
--    Look for: tables with no SELECT policy at all (likely SELECT-deny by
--    default — verify), tables that allow `true` (USING (true)) for SELECT
--    on `authenticated` (everyone-can-read-everything), or any UPDATE/DELETE
--    that doesn't reference auth.uid().
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual              AS using_clause,
  with_check        AS with_check_clause
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;

-- 3. Realtime publication members. Anything here streams INSERT/UPDATE/DELETE
--    payloads to subscribers, gated only by RLS — so make sure each table on
--    the realtime publication has a SELECT policy that limits what a peer
--    user can see.
SELECT
  pubname,
  schemaname,
  tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime'
ORDER BY schemaname, tablename;

-- 4. Column-level grants. If `authenticated` has SELECT on `profiles.data`,
--    every friend can read every column inside the JSON blob — that's the
--    H-4 finding. Verify this row exists:
SELECT
  table_schema,
  table_name,
  column_name,
  privilege_type,
  grantee
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND table_name = 'profiles'
  AND grantee IN ('authenticated', 'anon')
ORDER BY column_name, grantee;

-- 5. Check what RPC functions are SECURITY DEFINER (these run as the function
--    owner and bypass RLS — every one needs careful per-call authz checks).
SELECT
  n.nspname        AS schema,
  p.proname        AS function,
  CASE p.prosecdef WHEN true THEN 'definer' ELSE 'invoker' END AS security,
  pg_get_function_arguments(p.oid) AS args,
  pg_get_function_result(p.oid)    AS returns
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
ORDER BY security DESC, function;
