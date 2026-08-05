-- =============================================================================
-- 27 — The rate limit added in migration 26 was bypassable. Fix it, and four
--      more issues an audit of #317 raised.
-- =============================================================================
-- Migration 26 keyed the forgot-email rate limit on the FIRST x-forwarded-for
-- hop. An audit flagged that hop as client-influenced. Probed against the live
-- project rather than reasoned about, and the audit was right:
--
--   POST /rest/v1/rpc/lookup_email_by_private_id
--     with X-Forwarded-For: 203.0.113.99  -> bucket keyed "203.0.113.99"
--     with no header                      -> bucket keyed "2.56.191.253" (real)
--
-- The forged value is PREPENDED; the edge appends the true IP as the LAST hop.
-- So the limit was bypassable by rotating the header — one fresh bucket per
-- request, which is no limit at all. Reading the full header set showed why,
-- and what to use instead:
--
--   x-forwarded-for  : "203.0.113.99,2.56.191.253"   <- attacker-controlled head
--   cf-connecting-ip : "2.56.191.253"                <- always the true client
--
-- cf-connecting-ip is set by Cloudflare (this project sits behind it —
-- cf-ray/cf-ipcountry/cdn-loop all present). Attempting to forge it does not
-- merely get overwritten: the edge REJECTS the request with 403 before it ever
-- reaches PostgREST. Verified directly.
--
-- Also fixed here, all raised by the same audit:
--   2. No table-level REVOKE on phone_verification_codes — anon/authenticated
--      held SELECT/INSERT/UPDATE/DELETE, leaving RLS as the only barrier.
--   3. OTP codes stored as unsalted SHA-256 — trivially reversible over a 10^6
--      space from any dump. The repo already bcrypts its MFA recovery codes
--      (store_mfa_recovery_codes uses crypt(c, gen_salt('bf', 12))); the phone
--      OTP was simply inconsistent with that standard.
--   4. send_phone_otp's default purpose ('verify') never matched
--      verify_phone_otp's ('verify_phone') — a code sent with the defaults
--      could never be verified. Latent only because both call sites pass the
--      purpose explicitly.
--   5. p_phone was interpolated unvalidated into the Twilio form body, so
--      "+1555&Body=..." could inject Twilio API parameters.

-- -----------------------------------------------------------------------------
-- 1. Table grants: RLS should not be the only thing standing here
-- -----------------------------------------------------------------------------
-- Only the SECURITY DEFINER functions below touch this table (verified: zero
-- references in src/). The definer executes as owner, so revoking the client
-- roles costs the app nothing.

REVOKE ALL ON TABLE public.phone_verification_codes FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. A shared, honest client-IP resolver
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_client_ip()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  hdrs jsonb;
  cf   text;
  xff  text;
BEGIN
  hdrs := nullif(current_setting('request.headers', true), '')::jsonb;
  IF hdrs IS NULL THEN
    -- Not a PostgREST request (direct SQL, a trigger, psql). No client to
    -- attribute; callers share one conservative bucket rather than each
    -- getting a free one.
    RETURN 'unknown';
  END IF;

  -- Cloudflare sets this and rejects (403) any request that tries to send its
  -- own. Single-valued, so there is no hop to pick wrong.
  cf := nullif(trim(hdrs ->> 'cf-connecting-ip'), '');
  IF cf IS NOT NULL THEN
    RETURN cf;
  END IF;

  -- Fallback: the LAST x-forwarded-for hop — the one the edge appended.
  -- Never the first, which is whatever the client chose to send.
  xff := nullif(trim(hdrs ->> 'x-forwarded-for'), '');
  IF xff IS NOT NULL THEN
    RETURN trim(split_part(xff, ',', array_length(string_to_array(xff, ','), 1)));
  END IF;

  RETURN 'unknown';
END;
$$;

REVOKE ALL ON FUNCTION public.request_client_ip() FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. lookup_email_by_private_id — same body, unforgeable rate-limit key
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.lookup_email_by_private_id(p_private_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
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

  IF NOT public.check_anon_rate_limit('forgot_email', public.request_client_ip()) THEN
    RETURN jsonb_build_object('found', false, 'error',
      'Too many lookups. Wait a few minutes and try again.');
  END IF;

  SELECT id INTO found_user_id
  FROM public.profiles WHERE private_id = trim(p_private_id) LIMIT 1;

  IF found_user_id IS NOT NULL THEN
    SELECT email INTO found_email FROM auth.users WHERE id = found_user_id;
  END IF;

  -- ONE failure message for both "no such ID" and "ID exists but no email".
  IF found_email IS NULL THEN
    RETURN jsonb_build_object('found', false, 'error',
      'No account matches that Private ID');
  END IF;

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
-- 4. send_phone_otp — bcrypt the code, validate the number, encode the form
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.send_phone_otp(p_phone text, p_purpose text DEFAULT 'verify_phone'::text)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  clean_phone  text;
  otp_code     text;
  expiry       timestamptz;
  twilio_sid   text;
  twilio_token text;
  twilio_from  text;
  msg_body     text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  -- p_phone lands in a form-encoded Twilio body. Unvalidated, "+1555&Body=x"
  -- injects Twilio API parameters. E.164 only: leading +, 8-15 digits.
  clean_phone := regexp_replace(coalesce(p_phone, ''), '[\s\-()]', '', 'g');
  IF clean_phone !~ '^\+[1-9][0-9]{7,14}$' THEN
    RAISE EXCEPTION 'Enter a valid phone number in international format, e.g. +15551234567';
  END IF;

  IF NOT public.check_anon_rate_limit('phone_otp_send', auth.uid()::text) THEN
    RAISE EXCEPTION 'Too many codes requested. Wait a few minutes and try again.';
  END IF;

  -- gen_random_bytes is pgcrypto (crypto-secure), unlike the random() this
  -- replaced. Modulo bias over 2^31 % 10^6 is ~0.0002%.
  otp_code := lpad(
    ((('x' || encode(gen_random_bytes(4), 'hex'))::bit(32)::bigint & 2147483647) % 1000000)::text,
    6, '0');
  expiry := now() + interval '10 minutes';

  UPDATE phone_verification_codes SET used = true
  WHERE user_id = auth.uid() AND purpose = p_purpose AND used = false;

  -- bcrypt, matching store_mfa_recovery_codes. An unsalted SHA-256 of a
  -- 6-digit code is exhaustible in milliseconds from any dump; bcrypt at
  -- cost 10 makes the same 10^6 sweep take days, and salts every row.
  INSERT INTO phone_verification_codes (user_id, phone, code_hash, purpose, expires_at)
  VALUES (auth.uid(), clean_phone, crypt(otp_code, gen_salt('bf', 10)), p_purpose, expiry);

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
      -- Every value percent-encoded, so no field can terminate its own
      -- parameter and start another.
      body := jsonb_build_object('raw_body',
          'To='   || extensions.urlencode(clean_phone::varchar)
       || '&From='|| extensions.urlencode(coalesce(twilio_from, '')::varchar)
       || '&Body='|| extensions.urlencode(msg_body::varchar))
    );
  END IF;

  RETURN expiry;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. verify_phone_otp — bcrypt compare, with the in-flight SHA-256 path kept
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.verify_phone_otp(p_code text, p_purpose text DEFAULT 'verify_phone'::text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  code_row phone_verification_codes%rowtype;
  matches  boolean;
BEGIN
  -- Newest ACTIVE code first, compare second. Selecting BY hash (the original
  -- shape) cannot count misses, which is what allowed unlimited guessing.
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

  -- bcrypt hashes start '$2'. The legacy SHA-256 branch covers codes issued
  -- in the 10 minutes before this migration; it is dead after that window and
  -- can be deleted on any later pass.
  IF code_row.code_hash LIKE '$2%' THEN
    matches := (code_row.code_hash = crypt(p_code, code_row.code_hash));
  ELSE
    matches := (code_row.code_hash = encode(digest(p_code, 'sha256'), 'hex'));
  END IF;

  IF NOT matches THEN
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
-- 6. Grants, re-pinned (unchanged from migration 26)
-- -----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.lookup_email_by_private_id(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_email_by_private_id(text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.send_phone_otp(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.send_phone_otp(text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.verify_phone_otp(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_phone_otp(text, text) TO authenticated;
