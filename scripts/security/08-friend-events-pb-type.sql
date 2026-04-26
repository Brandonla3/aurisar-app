-- =============================================================================
-- 08 — Add pb_type to friend_exercise_events (Phase 3b prerequisite)
-- =============================================================================
-- The Phase-3b client emits an event row when the user completes an exercise.
-- For PBs, the banner needs both `pb_value` (the number) and `pb_type` (the
-- formatting category — "Strength 1RM", "Cardio Pace", "Max Reps Per 1 Set",
-- "Assisted Weight", "Longest Hold", "Fastest Time"). The original 02 added
-- pb_value but not pb_type.
--
-- Idempotent. Safe to run anytime.
-- =============================================================================

ALTER TABLE public.friend_exercise_events
  ADD COLUMN IF NOT EXISTS pb_type text;
