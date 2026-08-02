-- =============================================================================
-- 21 — Retire four untracked notification triggers that migration 12 broke,
--      and de-duplicate the two that collided with migration 17
-- =============================================================================
-- APPLIED TO PRODUCTION 2026-08-02 (via the Supabase MCP, alongside 17-20).
--
-- Found by *exercising* the producer triggers after applying migration 17,
-- rather than by checking that its objects existed: a test INSERT into
-- friend_requests produced TWO notification rows where the tracked trigger
-- enqueues exactly one.
--
-- What was actually in the live database, none of it in any tracked file:
--   on_friend_request_created   -> notify_friend_request           (INSERT)
--   on_friend_request_accepted  -> notify_friend_request_accepted  (UPDATE)
--   on_friend_request_rejected  -> notify_friend_request_rejected  (DELETE)
--   on_shared_item_created      -> notify_shared_item              (INSERT)
--
-- Two distinct problems.
--
-- 1. DUPLICATES (introduced by migration 17).
--    The old triggers call `notify_friend_request` and `notify_shared_item` —
--    the exact function names migration 17 defines. Its CREATE OR REPLACE
--    silently overwrote those pre-existing bodies, so the old trigger and the
--    new trg_notify_* trigger both invoke the NEW body: two identical
--    notification rows, and two emails, per friend request and per shared item.
--    This is the hazard of CREATE OR REPLACE against a database whose contents
--    are not fully represented in the repo.
--
-- 2. BROKEN, AND BLOCKING USER ACTIONS (pre-existing since migration 12).
--    All four carry search_path='' — applied by migration 12's security
--    hardening — while their bodies call get_player_name(),
--    user_wants_notification(), get_resend_key() and build_aurisar_email()
--    UNQUALIFIED. This is precisely the defect migration 14 fixed for
--    backup_profile_on_update, left unfixed on four more functions. Note that
--    get_player_name and user_wants_notification DO exist; they are simply
--    unreachable with an empty search_path.
--
--    Verified against the live database before dropping:
--      UPDATE pending -> accepted
--        => ERROR: function user_wants_notification(uuid, unknown) does not exist
--      DELETE of a pending row
--        => ERROR: function get_player_name(uuid) does not exist
--
--    These are AFTER triggers, so the exception rolls back the whole statement:
--    ACCEPTING A FRIEND REQUEST, AND REJECTING A PENDING ONE, HAVE BOTH BEEN
--    FAILING IN PRODUCTION since migration 12. Not caused by migration 17 —
--    only surfaced by testing it.
--
-- Resolution: drop all four triggers, and the two functions that exist solely
-- to serve them.
--   * created  -> already covered by migration 17's trg_notify_friend_request
--   * accepted -> already covered by migration 17's trg_notify_friend_accepted
--   * shared   -> already covered by migration 17's trg_notify_shared_item
--   * rejected -> deliberately has NO replacement. There is no rejection event
--                 in the outbox model; silently removing the row is the
--                 intended behaviour, and telling someone they were rejected
--                 is not a product decision we want to make by accident.
--
-- The two functions are dropped with their triggers: nothing else references
-- them (they are trigger functions only), and leaving broken bodies in place is
-- how this class of bug survived unnoticed for months.
--
-- notify_friend_request and notify_shared_item are NOT dropped — migration 17
-- now owns those names and their bodies are correct.
-- =============================================================================

BEGIN;

DROP TRIGGER IF EXISTS on_friend_request_created  ON public.friend_requests;
DROP TRIGGER IF EXISTS on_friend_request_accepted ON public.friend_requests;
DROP TRIGGER IF EXISTS on_friend_request_rejected ON public.friend_requests;
DROP TRIGGER IF EXISTS on_shared_item_created     ON public.shared_items;

DROP FUNCTION IF EXISTS public.notify_friend_request_accepted();
DROP FUNCTION IF EXISTS public.notify_friend_request_rejected();

COMMIT;

-- =============================================================================
-- Post-apply verification actually run (each inside a rolled-back transaction):
-- =============================================================================
--   friend_request INSERT  -> exactly 1 notification row   (was 2)
--   UPDATE -> 'accepted'   -> ACCEPT_OK                     (was: user_wants_notification does not exist)
--   DELETE of pending row  -> REJECT_OK                     (was: get_player_name does not exist)
--   message INSERT         -> 1 row per channel recipient, sender excluded
--
-- Remaining triggers on these tables should be exactly the tracked three:
--   SELECT c.relname, t.tgname FROM pg_trigger t
--   JOIN pg_class c ON c.oid = t.tgrelid
--   WHERE c.relname IN ('friend_requests','shared_items') AND NOT t.tgisinternal;
--   -- trg_notify_friend_request, trg_notify_friend_accepted, trg_notify_shared_item
--
-- And nothing should still reference the helpers migration 12 dropped:
--   SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--   WHERE n.nspname='public' AND p.prosrc LIKE '%get_resend_key%';  -- expect 0
