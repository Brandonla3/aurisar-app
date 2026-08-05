-- =============================================================================
-- 26 — Declare the 3 untracked auth RPCs, and fix what reading them revealed
-- =============================================================================
-- lookup_email_by_private_id, send_phone_otp and verify_phone_otp have been
-- live in production and called from 5 client sites, with no CREATE FUNCTION
-- anywhere in the repo — only ALTER/GRANT references from migrations 23/24.
-- config/db-contract.json carried all three as knownUndeclared with reasons
-- ending "needs a migration that re-declares it". This is that migration.
--
-- Untracked wasn't the only problem. Pulling the live bodies
-- (pg_get_functiondef) surfaced four defects, fixed here in the same stroke:
--
-- 1. lookup_email_by_private_id was an ENUMERATION ORACLE. Anon-callable by
--    design (it's the pre-auth forgot-email path), called directly via
--    PostgREST — so no Netlify perimeter in front of it, and no rate limit
--    anywhere — and it returned distinct errors for "no account found with
--    that Private ID" vs "account found but no email on file". Unlimited
--    anonymous probing of the private-ID space, with responses that confirm
--    which IDs exist. Fix: one generic not-found message for every failure
--    shape, plus a per-IP rate limit inside the function itself (the only
--    place one can exist for a direct PostgREST call), reusing
--    check_anon_rate_limit / anon_request_counters from migration 05.
--
-- 2. send_phone_otp generated the 6-digit code with random() — PostgreSQL's
--    seedable, non-cryptographic PRNG — and had no send limit, leaving the
--    Twilio balance open to SMS-pumping. Fix: pgcrypto gen_random_bytes
--    (already on the search_path; digest() from the same extension was
--    already in use two lines down), and a per-user send limit through the
--    same counters table (the `ip` column is text; a uuid keys it fine).
--
-- 3. verify_phone_otp allowed UNLIMITED guesses at a 6-digit code inside its
--    10-minute window. Fix: an attempts column; 5 wrong guesses burns the
--    code. The lookup now fetches the newest active code and then compares —
--    the old body selected BY hash, which cannot count misses.
--
-- 4. RLS policy phone_codes_own_read let a session holder SELECT their own
--    rows — including code_hash, an unsalted SHA-256 of a 6-digit code. A
--    stolen-session attacker could read the hash and brute-force the 10^6
--    space offline in milliseconds, recovering the OTP without ever seeing
--    the SMS — defeating the exact possession check the disable_mfa purpose
--    exists for. Nothing client-side reads this table (verified: zero
--    references in src/). Dropped.

-- -----------------------------------------------------------------------------
-- 0. The table, declared canonically (no-op in production; matches live shape)
-- -----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.phone_verification_codes (
  id         uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid        NOT NULL,
  phone      text        NOT NULL,
  code_hash  text        NOT NULL,
  purpose    text        NOT NULL,
  expires_at timestamptz NOT NULL,
  used       boolean     DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.phone_verification_codes
  ADD COLUMN IF NOT EXISTS attempts int NOT NULL DEFAULT 0;

ALTER TABLE public.phone_verification_codes ENABLE ROW LEVEL SECURITY;

-- Defect 4: the SECURITY DEFINER functions below are the only intended
-- readers/writers; no client policy should expose code_hash.
DROP POLICY IF EXISTS phone_codes_own_read ON public.phone_verification_codes;

-- -----------------------------------------------------------------------------
-- 1. lookup_email_by_private_id — same success shape, no oracle, rate-limited
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lookup_email_by_private_id(p_private_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  caller_ip     text;
  found_user_id uuid;
  found_email   text;
  local_part    text;
  domain_part   text;
  domain_name   text;
  domain_ext    text;
  masked        text;
BEGIN
  IF p_private_id IS NULL OR trim(p_private_id) = '' THEN
    RETURN jsonb_build_object('found', false, 'error', 'Please enter your Private Account ID');
  END IF;

  -- This runs as a direct PostgREST call, so the per-IP limit has to live
  -- here. PostgREST exposes the request headers as a GUC; absent (e.g. a
  -- direct SQL session) everything shares one 'unknown' bucket, which only
  -- ever affects non-API callers.
  caller_ip := coalesce(
    trim(split_part(
      nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-forwarded-for',
      ',', 1)),
    '');
  IF caller_ip = '' THEN caller_ip := 'unknown'; END IF;

  IF NOT public.check_anon_rate_limit('forgot_email', caller_ip) THEN
    RETURN jsonb_build_object('found', false, 'error',
      'Too many lookups. Wait a few minutes and try again.');
  END IF;

  SELECT id INTO found_user_id
  FROM public.profiles WHERE private_id = trim(p_private_id) LIMIT 1;

  IF found_user_id IS NOT NULL THEN
    SELECT email INTO found_email FROM auth.users WHERE id = found_user_id;
  END IF;

  -- ONE failure message for both "no such ID" and "ID exists but no email":
  -- distinct messages were an enumeration oracle over the private-ID space.
  IF found_email IS NULL THEN
    RETURN jsonb_build_object('found', false, 'error',
      'No account matches that Private ID');
  END IF;

  -- Mask: "gr••••@ea••.com"
  local_part  := split_part(found_email, '@', 1);
  domain_part := split_part(found_email, '@', 2);
  domain_name := split_part(domain_part, '.', 1);
  domain_ext  := substring(domain_part from position('.' in domain_part));

  masked := left(local_part, 2) || '••••'
    || '@' || left(domain_name, 2) || '••' || domain_ext;

  RETURN jsonb_build_object('found', true, 'masked_email', masked);
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. send_phone_otp — crypto-secure code, per-user send limit
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.send_phone_otp(p_phone text, p_purpose text DEFAULT 'verify'::text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  otp_code     text;
  otp_hash     text;
  expiry       timestamptz;
  twilio_sid   text;
  twilio_token text;
  twilio_from  text;
  msg_body     text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  -- 5 sends / 15 min / user, through the same counters table the anonymous
  -- endpoints use (its ip column is text; a uuid keys a bucket fine). SMS
  -- costs real money per send — without this, a script with a session could
  -- pump codes to a premium number until the Twilio balance ran dry.
  IF NOT public.check_anon_rate_limit('phone_otp_send', auth.uid()::text) THEN
    RAISE EXCEPTION 'Too many codes requested. Wait a few minutes and try again.';
  END IF;

  -- gen_random_bytes is pgcrypto — cryptographically secure, unlike the
  -- seedable random() this replaces. Modulo bias over 2^32 % 10^6 is ~0.0002%.
  otp_code := lpad(
    ((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint & 2147483647) % 1000000)::text,
    6, '0');
  otp_hash := encode(digest(otp_code, 'sha256'), 'hex');
  expiry   := now() + interval '10 minutes';

  UPDATE phone_verification_codes SET used = true
  WHERE user_id = auth.uid() AND purpose = p_purpose AND used = false;

  INSERT INTO phone_verification_codes (user_id, phone, code_hash, purpose, expires_at)
  VALUES (auth.uid(), p_phone, otp_hash, p_purpose, expiry);

  twilio_sid   := current_setting('app.twilio_sid', true);
  twilio_token := current_setting('app.twilio_token', true);
  twilio_from  := current_setting('app.twilio_from', true);

  IF p_purpose = 'disable_mfa' THEN
    msg_body := 'Aurisar: Your MFA disable code is ' || otp_code || '. Expires in 10 minutes. If you did not request this, ignore this message.';
  ELSE
    msg_body := 'Aurisar: Your verification code is ' || otp_code || '. Expires in 10 minutes.';
  END IF;

  IF twilio_sid IS NOT NULL AND twilio_sid <> '' THEN
    PERFORM net.http_post(
      url := 'https://api.twilio.com/2010-04-01/Accounts/' || twilio_sid || '/Messages.json',
      headers := jsonb_build_object(
        'Authorization', 'Basic ' || encode(convert_to(twilio_sid || ':' || twilio_token, 'UTF8'), 'base64'),
        'Content-Type', 'application/x-www-form-urlencoded'
      ),
      body := jsonb_build_object('raw_body', 'To=' || p_phone || '&From=' || twilio_from || '&Body=' || msg_body)
    );
  END IF;

  RETURN expiry;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. verify_phone_otp — 5 wrong guesses burns the code
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.verify_phone_otp(p_code text, p_purpose text DEFAULT 'verify_phone'::text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  input_hash text;
  code_row   phone_verification_codes%rowtype;
BEGIN
  input_hash := encode(digest(p_code, 'sha256'), 'hex');

  -- Fetch the newest ACTIVE code first, compare second. The old body
  -- selected BY hash, which finds nothing on a wrong guess — structurally
  -- unable to count misses, hence unlimited brute-force of a 6-digit space.
  SELECT * INTO code_row
  FROM phone_verification_codes
  WHERE user_id = auth.uid()
    AND purpose = p_purpose
    AND used = false
    AND expires_at > now()
  ORDER BY created_at DESC
  LIMIT 1;

  IF code_row.id IS NULL THEN
    RETURN false;
  END IF;

  IF code_row.code_hash <> input_hash THEN
    UPDATE phone_verification_codes
    SET attempts = attempts + 1,
        used     = (attempts + 1 >= 5)
    WHERE id = code_row.id;
    RETURN false;
  END IF;

  UPDATE phone_verification_codes
  SET used = true
  WHERE id = code_row.id;

  IF p_purpose = 'verify_phone' THEN
    UPDATE profiles
    SET data = jsonb_set(
      jsonb_set(data, '{phone}', to_jsonb(code_row.phone)),
      '{phoneVerified}', 'true'::jsonb
    )
    WHERE id = auth.uid();
  END IF;

  RETURN true;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Grants, re-pinned exactly as migration 23 established
-- -----------------------------------------------------------------------------
-- CREATE OR REPLACE preserves an existing function's ACL, but pin explicitly
-- so this file stands alone in a fresh environment.

REVOKE ALL ON FUNCTION public.lookup_email_by_private_id(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_email_by_private_id(text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.send_phone_otp(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_phone_otp(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.verify_phone_otp(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_phone_otp(text, text) TO authenticated;
