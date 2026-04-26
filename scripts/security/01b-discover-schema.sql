-- =============================================================================
-- 01b — Discover the actual schema of the tables the migrations touch
-- =============================================================================
-- READ-ONLY. Run this BEFORE 02 and 04 (or after, when validating). Pastes
-- back the column name + type + nullability + default for every table the
-- migrations write to, plus the JSONB keys actually present inside
-- `profiles.data` so we don't assume column names that are really nested
-- inside the jsonb payload.
-- =============================================================================

-- 1. Column lists for each table the security migrations care about.
SELECT
  table_name,
  column_name,
  data_type,
  udt_name,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN (
    'profiles',
    'friend_requests',
    'shared_items',
    'feedback',
    'messages',
    'channel_members',
    'mfa_recovery_codes',
    'anon_request_counters',
    'friend_exercise_events'
  )
ORDER BY table_name, ordinal_position;

-- 2. Top-level JSONB keys that appear in `profiles.data` (sample of 10 rows).
--    Tells us the actual key names (camelCase vs snake_case) without exposing
--    any specific user. If your data is empty or this returns 0 rows, fall
--    back to checking client code in src/App.js.
SELECT DISTINCT jsonb_object_keys(data) AS profile_data_key
FROM (SELECT data FROM public.profiles WHERE data IS NOT NULL LIMIT 10) s
ORDER BY profile_data_key;

-- 3. Existing function signatures we plan to replace (so we know whether
--    DROP FUNCTION + CREATE is safe, or we need to keep the old signature).
SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid)  AS args,
  pg_get_function_result(p.oid)              AS returns,
  CASE p.prosecdef WHEN true THEN 'definer' ELSE 'invoker' END AS security
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN (
    'store_mfa_recovery_codes',
    'use_mfa_recovery_code',
    'count_recovery_codes_remaining',
    'get_friend_profiles_safe',
    'get_share_sender_profiles',
    'check_anon_rate_limit',
    'send_phone_otp',
    'verify_phone_otp',
    'lookup_email_by_private_id',
    'find_user_for_friend_request'
  )
ORDER BY p.proname, args;
