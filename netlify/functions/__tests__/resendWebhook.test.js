import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { Webhook } from 'svix';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const src = readFileSync(ROOT + 'netlify/functions/resend-webhook.js', 'utf8');

/**
 * WHY THESE TESTS LOOK LIKE THIS.
 *
 * The previous suite signed payloads with the same hand-rolled function it
 * then verified them with. That is self-consistent and therefore worthless: it
 * passed 9/9 while the handler rejected every real Resend delivery, because
 * both sides shared the same wrong assumptions. It could only ever prove we
 * reject forgeries — never that we accept a genuine request.
 *
 * These sign with Svix's OWN implementation, which is the executable spec, and
 * assert the handler's verifier accepts it. A wrong scheme now fails.
 */
const SECRET = 'whsec_' + crypto.randomBytes(24).toString('base64');
const BODY = JSON.stringify({
  type: 'email.bounced',
  // Real Resend shape, including the em dash that a charset bug would mangle.
  data: { to: ['bounced@resend.dev'], subject: 'Webhook e2e — post-fix' },
});

function signedHeaders(prefix, { id = 'msg_' + crypto.randomUUID(), at = new Date() } = {}) {
  const sig = new Webhook(SECRET).sign(id, at, BODY);
  return {
    [`${prefix}-id`]: id,
    [`${prefix}-timestamp`]: Math.floor(at.getTime() / 1000).toString(),
    [`${prefix}-signature`]: sig,
  };
}

// Mirror of the handler's verify(): svix wants a plain lowercased object.
function verify(secret, headersObj, payload) {
  try {
    new Webhook(secret).verify(payload, headersObj);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

describe('verification accepts a GENUINELY signed request', () => {
  it('accepts svix-* headers', () => {
    expect(verify(SECRET, signedHeaders('svix'), BODY).ok).toBe(true);
  });

  it('accepts Standard Webhooks webhook-* headers', () => {
    // The leading suspect for the production failure: a reader looking only
    // for svix-* returns "no headers at all" when the sender emits this set,
    // so the signature comparison never even runs.
    expect(verify(SECRET, signedHeaders('webhook'), BODY).ok).toBe(true);
  });

  it('accepts a body containing multi-byte characters', () => {
    // An em dash is exactly the codepoint a charset round-trip would corrupt.
    expect(BODY).toContain('—');
    expect(verify(SECRET, signedHeaders('svix'), BODY).ok).toBe(true);
  });
});

describe('verification still rejects what it should', () => {
  it('rejects a tampered body', () => {
    const headers = signedHeaders('svix');
    const tampered = JSON.stringify({ type: 'email.bounced', data: { to: ['attacker@evil.invalid'] } });
    expect(verify(SECRET, headers, tampered).ok).toBe(false);
  });

  it('rejects a forged signature', () => {
    const headers = { ...signedHeaders('svix'), 'svix-signature': 'v1,ZmFrZQ==' };
    expect(verify(SECRET, headers, BODY).ok).toBe(false);
  });

  it('rejects a different signing secret', () => {
    const other = 'whsec_' + crypto.randomBytes(24).toString('base64');
    expect(verify(other, signedHeaders('svix'), BODY).ok).toBe(false);
  });

  it('rejects missing signing headers', () => {
    expect(verify(SECRET, {}, BODY).ok).toBe(false);
  });
});

describe('handler wiring (source guard)', () => {
  it('delegates to the svix library rather than hand-rolling HMAC', () => {
    expect(src).toContain('from "svix"');
    expect(src).toContain('new Webhook(secret).verify');
    // The hand-rolled crypto is gone; keeping it around invites divergence
    // from the spec all over again.
    expect(src).not.toContain('node:crypto');
    expect(src).not.toContain('createHmac');
  });

  it('reports which signing headers actually arrived', () => {
    // Not knowing this is what made the failure take hours: the endpoint could
    // only say "invalid signature", and no probe from our side could reveal
    // what the real sender was sending.
    expect(src).toContain('signing headers');
    expect(src).toMatch(/startsWith\("svix-"\)\s*\|\|\s*n\.startsWith\("webhook-"\)/);
  });

  it('never logs or returns header VALUES, only names', () => {
    expect(src).toContain('result.headerNames');
    expect(src).not.toMatch(/console\.error\([^)]*headers\.get\("svix-signature"\)/);
  });

  it('verifies before parsing or acting on the payload', () => {
    expect(src.indexOf('verify(secret')).toBeLessThan(src.indexOf('JSON.parse(payload)'));
  });
});
