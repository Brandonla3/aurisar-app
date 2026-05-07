-- Migration 015: Add avatar_config JSONB column to profiles table
-- Stores the full AvatarConfig JSON for each user's character appearance.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS avatar_config JSONB DEFAULT NULL;

-- Index for quick reads if we ever query by config fields
CREATE INDEX IF NOT EXISTS idx_profiles_avatar_config
  ON profiles USING GIN (avatar_config);

COMMENT ON COLUMN profiles.avatar_config IS
  'AvatarConfig JSON (version, body, face, skin, species, hair, clothing, gear). '
  'NULL means default appearance. Schema defined in src/features/world/game/avatarSchema.js.';
