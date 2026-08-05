import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Migration 27 fixes an audit finding against migration 26: the rate limit
 * added there keyed on the FIRST x-forwarded-for hop, which the client
 * controls — so rotating the header bought a fresh bucket per request and the
 * limit was no limit at all. Probed live before and after; these lock the fix
 * and the four smaller issues found alongside it.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const sql = readFileSync(
  ROOT + 'scripts/security/27-fix-forgeable-rate-limit-key-and-otp-hashing.sql',
  'utf8'
);
const mig26 = readFileSync(
  ROOT + 'scripts/security/26-declare-and-harden-untracked-auth-rpcs.sql',
  'utf8'
);

// The file's header comment narrates the defects by name and number, so any
// slice or count over the raw text also matches the prose describing it.
// Assertions about what the CODE does run against this.
const code = sql.replace(/--[^\n]*/g, '');
const fnBody = name => {
  const start = code.indexOf(`CREATE OR REPLACE FUNCTION public.${name}`);
  const after = code.indexOf('CREATE OR REPLACE FUNCTION', start + 1);
  return code.slice(start, after === -1 ? undefined : after);
};

describe('the forgeable rate-limit key', () => {
  it('keys on cf-connecting-ip, which the edge rejects (403) if a client sends it', () => {
    expect(sql).toContain("'cf-connecting-ip'");
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.request_client_ip/);
  });

  it('takes the LAST x-forwarded-for hop, never the first', () => {
    // The edge appends the true IP; anything before it came from the client.
    expect(sql).toMatch(/array_length\(string_to_array\(xff, ','\), 1\)/);
    // Migration 26's bug, which must not reappear: split_part(xff, ',', 1).
    expect(sql).not.toMatch(/split_part\(xff, ',', 1\)/);
  });

  it('the lookup no longer reads the header itself — it delegates to the resolver', () => {
    const lookup = fnBody('lookup_email_by_private_id');
    expect(lookup).toMatch(/check_anon_rate_limit\('forgot_email', public\.request_client_ip\(\)\)/);
    expect(lookup).not.toContain('x-forwarded-for');
    expect(lookup).not.toContain('request.headers');
  });

  it('migration 26 is the one that had the first-hop bug (documented, not silently replaced)', () => {
    expect(mig26).toContain("'x-forwarded-for'");
    expect(sql).toMatch(/bypassable/i);
  });
});

describe('OTP hashes at rest', () => {
  it('bcrypts the code, matching store_mfa_recovery_codes rather than raw sha256', () => {
    expect(sql).toMatch(/crypt\(otp_code, gen_salt\('bf', 10\)\)/);
    // The insert must not go back to a bare digest.
    expect(sql).not.toMatch(/VALUES \(auth\.uid\(\), clean_phone, encode\(digest/);
  });

  it('verifies bcrypt, and still accepts codes issued in the 10 min before this ran', () => {
    expect(sql).toMatch(/code_row\.code_hash LIKE '\$2%'/);
    expect(sql).toMatch(/crypt\(p_code, code_row\.code_hash\)/);
    expect(sql).toMatch(/encode\(digest\(p_code, 'sha256'\), 'hex'\)/);
  });
});

describe('the Twilio call', () => {
  it('rejects anything that is not E.164 before building the request', () => {
    expect(sql).toMatch(/\^\\\+\[1-9\]\[0-9\]\{7,14\}\$/);
  });

  it('percent-encodes every form value so no field can start a new parameter', () => {
    for (const part of ['To=', '&From=', '&Body=']) expect(sql).toContain(part);
    expect(sql).toMatch(/extensions\.urlencode\(clean_phone::varchar\)/);
    expect(sql).toMatch(/extensions\.urlencode\(msg_body::varchar\)/);
    // The raw concatenation that allowed "+1555&Body=..." injection.
    expect(sql).not.toMatch(/'To=' \|\| p_phone/);
  });

  it('stores the normalised number, not the raw input', () => {
    expect(sql).toMatch(/VALUES \(auth\.uid\(\), clean_phone,/);
  });
});

describe('table surface + defaults', () => {
  it('revokes the table grants that left RLS as the only barrier', () => {
    expect(sql).toMatch(
      /REVOKE ALL ON TABLE public\.phone_verification_codes FROM PUBLIC, anon, authenticated/
    );
  });

  it('send/verify defaults finally agree — and match the purpose CHECK constraint', () => {
    // The live CHECK allows only ('verify_phone','disable_mfa'), so the old
    // send default of 'verify' could not even be inserted.
    const send = sql.match(/FUNCTION public\.send_phone_otp\(p_phone text, p_purpose text DEFAULT '([a-z_]+)'/);
    const verify = sql.match(/FUNCTION public\.verify_phone_otp\(p_code text, p_purpose text DEFAULT '([a-z_]+)'/);
    expect(send?.[1]).toBe('verify_phone');
    expect(verify?.[1]).toBe('verify_phone');
  });

  it('keeps the grant split: lookup is pre-auth, the phone pair is not', () => {
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.lookup_email_by_private_id\(text\) TO anon, authenticated/);
    expect(sql).not.toMatch(/send_phone_otp\(text, text\) TO anon/);
    expect(sql).not.toMatch(/verify_phone_otp\(text, text\) TO anon/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.request_client_ip\(\) FROM PUBLIC, anon, authenticated/);
  });
});

describe('properties migration 26 established that must survive', () => {
  it('all functions stay SECURITY DEFINER with a pinned search_path', () => {
    const defs = code.match(/CREATE OR REPLACE FUNCTION public\.\w+/g) || [];
    expect(defs.length).toBe(4); // resolver + the three RPCs
    for (const name of ['request_client_ip', 'lookup_email_by_private_id',
                        'send_phone_otp', 'verify_phone_otp']) {
      const body = fnBody(name);
      expect(body, name).toContain('SECURITY DEFINER');
      expect(body, name).toMatch(/SET search_path TO/);
    }
  });

  it('still one merged not-found message, and still burns the code at 5 misses', () => {
    expect(sql).toContain('No account matches that Private ID');
    expect(sql).not.toContain('Account found but no email on file');
    expect(sql).toMatch(/attempts \+ 1 >= 5/);
  });
});
