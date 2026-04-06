-- =============================================================================
-- Migrate all foreign keys referencing auth.users to ON DELETE CASCADE
-- =============================================================================
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor > New query).
--
-- After running, deleting a user from the Supabase dashboard will
-- automatically remove their rows from profiles, friend_requests,
-- shared_items, feedback, messages, channel_members, and any other
-- table that references auth.users(id).
-- =============================================================================

DO $$
DECLARE
  r RECORD;
BEGIN
  -- Find every foreign key constraint in the public schema that
  -- references the auth.users table and is NOT already CASCADE.
  FOR r IN
    SELECT
      tc.table_schema,
      tc.table_name,
      tc.constraint_name,
      kcu.column_name,
      ccu.table_schema  AS foreign_table_schema,
      ccu.table_name    AS foreign_table_name,
      ccu.column_name   AS foreign_column_name,
      rc.delete_rule
    FROM information_schema.table_constraints       tc
    JOIN information_schema.key_column_usage         kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema    = kcu.table_schema
    JOIN information_schema.constraint_column_usage  ccu
      ON ccu.constraint_name = tc.constraint_name
     AND ccu.table_schema    = tc.table_schema
    JOIN information_schema.referential_constraints  rc
      ON rc.constraint_name = tc.constraint_name
     AND rc.constraint_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_schema   = 'auth'
      AND ccu.table_name     = 'users'
      AND rc.delete_rule    <> 'CASCADE'
  LOOP
    RAISE NOTICE 'Updating %.% constraint "%" (% -> auth.users.%) from % to CASCADE',
      r.table_schema, r.table_name, r.constraint_name,
      r.column_name, r.foreign_column_name, r.delete_rule;

    -- Drop the existing constraint
    EXECUTE format(
      'ALTER TABLE %I.%I DROP CONSTRAINT %I',
      r.table_schema, r.table_name, r.constraint_name
    );

    -- Re-add it with ON DELETE CASCADE
    EXECUTE format(
      'ALTER TABLE %I.%I ADD CONSTRAINT %I FOREIGN KEY (%I) REFERENCES auth.users(id) ON DELETE CASCADE',
      r.table_schema, r.table_name, r.constraint_name,
      r.column_name
    );
  END LOOP;
END
$$;

-- =============================================================================
-- Verify: list all FK constraints referencing auth.users and their delete rules
-- =============================================================================
SELECT
  tc.table_schema,
  tc.table_name,
  kcu.column_name,
  tc.constraint_name,
  rc.delete_rule
FROM information_schema.table_constraints       tc
JOIN information_schema.key_column_usage         kcu
  ON tc.constraint_name = kcu.constraint_name
 AND tc.table_schema    = kcu.table_schema
JOIN information_schema.constraint_column_usage  ccu
  ON ccu.constraint_name = tc.constraint_name
 AND ccu.table_schema    = tc.table_schema
JOIN information_schema.referential_constraints  rc
  ON rc.constraint_name = tc.constraint_name
 AND rc.constraint_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND ccu.table_schema   = 'auth'
  AND ccu.table_name     = 'users'
ORDER BY tc.table_name, kcu.column_name;
