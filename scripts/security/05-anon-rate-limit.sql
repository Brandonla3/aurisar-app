-- =============================================================================
-- H-1 (rate-limit) — Per-IP anonymous rate limit RPC
-- =============================================================================
-- Used by Netlify functions /api/send-support-email and /api/create-github-issue
-- to throttle abuse without requiring a Bearer token (those endpoints have to
-- accept logged-out submissions). The function is SECURITY DEFINER so it can
-- write to the rate-limit table with no client-side grants.
--
-- Rate limit policy: 5 requests / 15 minutes per (kind, ip).
-- Tunable via the constants at the top of the function.
-- =============================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS public.anon_request_counters (
  kind        text        NOT NULL,
  ip          text        NOT NULL,
  window_start timestamptz NOT NULL,
  count       int         NOT NULL DEFAULT 1,
  PRIMARY KEY (kind, ip, window_start)
);
CREATE INDEX IF NOT EXISTS anon_request_counters_recent_idx
  ON public.anon_request_counters (kind, ip, window_start DESC);

-- Sweep job — caller can `SELECT public.anon_request_counters_sweep();` from a
-- pg_cron schedule, or skip and let rows pile up (they're tiny).
CREATE OR REPLACE FUNCTION public.anon_request_counters_sweep()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.anon_request_counters
  WHERE window_start < now() - interval '24 hours';
$$;

-- Returns true if the request is allowed; false if rate-limited.
CREATE OR REPLACE FUNCTION public.check_anon_rate_limit(
  p_kind text,
  p_ip   text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  WINDOW_SECS    constant int := 900;   -- 15 minutes
  MAX_PER_WINDOW constant int := 5;
  current_window timestamptz;
  current_count  int;
BEGIN
  IF p_kind IS NULL OR p_ip IS NULL OR length(p_ip) = 0 THEN
    -- Be conservative: missing client IP → reject. The Netlify function should
    -- always pass `x-nf-client-connection-ip`.
    RETURN false;
  END IF;

  -- Snap to the current 15-minute window so concurrent calls share one row.
  current_window := date_trunc('minute', now())
                  - (extract(minute FROM now())::int % (WINDOW_SECS / 60)) * interval '1 minute';

  INSERT INTO public.anon_request_counters (kind, ip, window_start, count)
  VALUES (p_kind, p_ip, current_window, 1)
  ON CONFLICT (kind, ip, window_start)
  DO UPDATE SET count = public.anon_request_counters.count + 1
  RETURNING count INTO current_count;

  RETURN current_count <= MAX_PER_WINDOW;
END
$$;

REVOKE ALL ON FUNCTION public.check_anon_rate_limit(text, text) FROM PUBLIC;
-- Allow both anon and authenticated to call this — the Netlify Function uses
-- the anon JWT.
GRANT EXECUTE ON FUNCTION public.check_anon_rate_limit(text, text) TO anon, authenticated;

ALTER TABLE public.anon_request_counters ENABLE ROW LEVEL SECURITY;
-- No RLS policies → no direct SELECT/INSERT from clients (the SECURITY DEFINER
-- RPC is the only gateway).

COMMIT;
