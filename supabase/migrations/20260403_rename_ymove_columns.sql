-- Migration: Rename ymove columns to generic video column names
-- Removes all YMove-specific naming from the exercise_library table.

ALTER TABLE exercise_library RENAME COLUMN ymove_uuid TO video_uuid;
ALTER TABLE exercise_library RENAME COLUMN ymove_slug TO video_slug;

-- Rename the server-side RPC function that fetches video URLs
ALTER FUNCTION get_ymove_video_url(p_exercise_id text) RENAME TO get_exercise_video_url;
