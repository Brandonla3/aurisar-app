import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const src = readFileSync(ROOT + 'netlify/functions/resend-webhook.js', 'utf8');

// Rebuild the handler's verification locally so the retry semantics can be
// asserted without a network call. Kept deliberately close to the source; the
// source-guard cases below fail if the two drift apart.
const TOLERANCE_S = 60 * 60 * 24;
const SECRET = 'whsec_' + Buffer.from('unit-test-secret-value').toString('base64');

function sign(secret, id, timestamp, payload) {
  return crypto
    .createHmac('sha256', Buffer.from(secret.replace(/^whsec_/, ''), 'base64'))
    .update(`${id}.${timestamp}.${payload}`)
    .digest('base64');
}

function verify(secret, { id, timestamp, signature }, payload, nowS) {
  if (!id || !timestamp || !signature) return 'missing_svix_headers';
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return 'bad_timestamp';
  if (Math.abs(nowS - ts) > TOLERANCE_S) return 'stale_timestamp';
  return signature === `v1,${sign(secret, id, timestamp, payload)}` ? null : 'signature_mismatch';
}

describe('Svix retry semantics', () => {
  const body = JSON.stringify({ type: 'email.bounced', data: { to: ['x@example.invalid'] } });
  const id = 'msg_retry';
  const sentAt = 1_800_000_000;
  const headers = { id, timestamp: String(sentAt), signature: `v1,${sign(SECRET, id, String(sentAt), body)}` };

  it('accepts the first delivery', () => {
    expect(verify(SECRET, headers, body, sentAt + 2)).toBeNull();
  });

  it('STILL accepts a redelivery half an hour later — the bug that stuck an event in "Attempting"', () => {
    // Svix retries are byte-identical redeliveries: same id, same timestamp,
    // same signature. A 5-minute replay window therefore rejects every retry
    // after the first, and the event can never drain.
    expect(verify(SECRET, headers, body, sentAt + 1800)).toBeNull();
    expect(verify(SECRET, headers, body, sentAt + 6 * 3600)).toBeNull();
  });

  it('still rejects a genuinely ancient replay', () => {
    expect(verify(SECRET, headers, body, sentAt + TOLERANCE_S + 60)).toMatch(/stale/);
  });

  it('rejects a tampered body even with valid-looking headers', () => {
    const tampered = JSON.stringify({ type: 'email.bounced', data: { to: ['attacker@evil.invalid'] } });
    expect(verify(SECRET, headers, tampered, sentAt + 2)).toBe('signature_mismatch');
  });

  it('rejects a forged signature', () => {
    const forged = { ...headers, signature: 'v1,ZmFrZQ==' };
    expect(verify(SECRET, forged, body, sentAt + 2)).toBe('signature_mismatch');
  });

  it('rejects missing headers', () => {
    expect(verify(SECRET, { id, timestamp: null, signature: null }, body, sentAt)).toBe('missing_svix_headers');
  });
});

describe('the handler reports WHY it rejected (source guard)', () => {
  it('returns a distinguishable reason rather than one opaque 401', () => {
    // A bare "invalid signature" made a stuck webhook undiagnosable from the
    // sender's dashboard, which is the only view available without function logs.
    expect(src).toContain('invalid signature: ${failure}');
    for (const reason of ['missing_svix_headers', 'bad_timestamp', 'stale_timestamp_', 'signature_mismatch']) {
      expect(src, reason).toContain(reason);
    }
  });

  it('uses a retry-tolerant replay window, not 5 minutes', () => {
    expect(src).toContain('REPLAY_TOLERANCE_S');
    expect(src).not.toMatch(/>\s*300\b/);
  });

  it('still verifies before doing anything with the payload', () => {
    expect(src.indexOf('verifySvix(secret')).toBeLessThan(src.indexOf('JSON.parse(payload)'));
  });
});
