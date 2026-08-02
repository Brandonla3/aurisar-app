import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import { Webhook } from 'svix';
import { verifyWebhook } from '../resend-webhook.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const src = readFileSync(ROOT + 'netlify/functions/resend-webhook.js', 'utf8');

/**
 * These exercise the HANDLER'S OWN verifier against payloads signed by Svix's
 * library — two different implementations, so a wrong scheme fails.
 *
 * The suite this replaced signed with the same hand-rolled function it then
 * verified with: self-consistent, and green while every real delivery was
 * rejected. It could only prove we reject forgeries, never that we accept a
 * genuine request.
 */
const SECRET = 'whsec_' + crypto.randomBytes(24).toString('base64');
const BODY = JSON.stringify({
  type: 'email.bounced',
  data: { to: ['bounced@resend.dev'], subject: 'Webhook e2e — post-fix' },
});

/** Headers as Svix would send them, `ageS` seconds ago. */
function signed(prefix, ageS = 0, { body = BODY, secret = SECRET } = {}) {
  const at = new Date(Date.now() - ageS * 1000);
  const id = 'msg_' + crypto.randomUUID();
  const sig = new Webhook(secret).sign(id, at, body);
  return new Headers({
    [`${prefix}-id`]: id,
    [`${prefix}-timestamp`]: Math.floor(at.getTime() / 1000).toString(),
    [`${prefix}-signature`]: sig,
  });
}

describe('accepts a GENUINELY Svix-signed request', () => {
  it('accepts svix-* headers (the family Resend documents)', () => {
    expect(verifyWebhook(SECRET, signed('svix'), BODY).ok).toBe(true);
  });

  it('accepts Standard Webhooks webhook-* headers as defensive coverage', () => {
    const r = verifyWebhook(SECRET, signed('webhook'), BODY);
    expect(r.ok).toBe(true);
    expect(r.family).toBe('webhook');
  });

  it('accepts a body with multi-byte characters', () => {
    expect(BODY).toContain('—'); // the codepoint a charset bug would mangle
    expect(verifyWebhook(SECRET, signed('svix'), BODY).ok).toBe(true);
  });
});

describe('RETRY TOLERANCE — the regression this nearly shipped', () => {
  // Svix retries are byte-identical redeliveries (same id/timestamp/signature)
  // and its backoff runs to hours. The stock library hardcodes a 5-minute
  // window with no override, so delegating verification wholesale silently
  // reverted #311 and left events unable to ever drain.
  it('accepts a redelivery 6 minutes old — stock svix.verify() rejects this', () => {
    expect(verifyWebhook(SECRET, signed('svix', 6 * 60), BODY).ok).toBe(true);
  });

  it('accepts a redelivery 3 hours old', () => {
    expect(verifyWebhook(SECRET, signed('svix', 3 * 3600), BODY).ok).toBe(true);
  });

  it('proves the stock library would have rejected both', () => {
    for (const ageS of [6 * 60, 3 * 3600]) {
      const h = signed('svix', ageS);
      const plain = Object.fromEntries(h.entries());
      expect(() => new Webhook(SECRET).verify(BODY, plain)).toThrow(/timestamp too old/i);
    }
  });

  it('still rejects a genuinely ancient replay', () => {
    const r = verifyWebhook(SECRET, signed('svix', 60 * 60 * 25), BODY);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/^stale_timestamp_/);
  });
});

describe('rejects what it should', () => {
  it('rejects a tampered body', () => {
    const h = signed('svix');
    const tampered = JSON.stringify({ type: 'email.bounced', data: { to: ['attacker@evil.invalid'] } });
    expect(verifyWebhook(SECRET, h, tampered).reason).toBe('signature_mismatch');
  });

  it('rejects a forged signature', () => {
    const h = signed('svix');
    h.set('svix-signature', 'v1,ZmFrZQ==');
    expect(verifyWebhook(SECRET, h, BODY).reason).toBe('signature_mismatch');
  });

  it('rejects a different signing secret', () => {
    const other = 'whsec_' + crypto.randomBytes(24).toString('base64');
    expect(verifyWebhook(other, signed('svix'), BODY).reason).toBe('signature_mismatch');
  });

  it('rejects missing signing headers, and says so distinctly', () => {
    const r = verifyWebhook(SECRET, new Headers({ 'content-type': 'application/json' }), BODY);
    expect(r.reason).toBe('missing_signing_headers');
    expect(r.headerNames).toContain('content-type');
  });

  it('reports a malformed secret rather than throwing', () => {
    const r = verifyWebhook('not-a-real-secret', signed('svix'), BODY);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/^(bad_secret|signature_mismatch)/);
  });
});

describe('handler wiring (source guard)', () => {
  it('uses the library as the signing oracle, not a remembered scheme', () => {
    expect(src).toContain('from "svix"');
    expect(src).toContain('new Webhook(secret).sign');
  });

  it('does NOT inherit the library\'s 5-minute window', () => {
    expect(src).toContain('REPLAY_TOLERANCE_S');
    expect(src).not.toMatch(/new Webhook\(secret\)\.verify\(/);
  });

  it('reports which signing headers arrived, names only', () => {
    expect(src).toContain('signing headers');
    expect(src).toContain('result.headerNames');
  });

  it('verifies before parsing or acting on the payload', () => {
    expect(src.indexOf('verify(secret')).toBeLessThan(src.indexOf('JSON.parse(payload)'));
  });
});
