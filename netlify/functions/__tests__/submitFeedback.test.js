import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import handler from '../submit-feedback.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const src = readFileSync(ROOT + 'netlify/functions/submit-feedback.js', 'utf8');

const ORIGIN = 'https://aurisargames.com';
const ENV = { ...process.env };

function req(body, { origin = ORIGIN, method = 'POST', ip = '1.2.3.4', badJson = false } = {}) {
  const headers = new Map();
  if (origin) headers.set('origin', origin);
  if (ip) headers.set('x-nf-client-connection-ip', ip);
  return {
    method,
    headers: { get: k => headers.get(String(k).toLowerCase()) ?? null },
    json: badJson ? async () => { throw new SyntaxError('bad json'); } : async () => body,
  };
}

const okJson = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

function routeFetch(routes) {
  return vi.fn(async (url, opts) => {
    const key = Object.keys(routes).find(k => String(url).includes(k));
    if (!key) throw new Error(`unmocked fetch: ${url}`);
    return routes[key](opts);
  });
}

const RATE_LIMIT_OK = { '/rpc/check_anon_rate_limit': async () => okJson(true) };

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://proj.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  delete process.env.TURNSTILE_SECRET_KEY;
});

afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

describe('the perimeter — same checks its two siblings already apply', () => {
  it('rejects non-POST', async () => {
    const res = await handler(req(undefined, { method: 'GET' }));
    expect(res.status).toBe(405);
  });

  it('rejects an unrecognised origin', async () => {
    vi.stubGlobal('fetch', routeFetch({}));
    const res = await handler(req({ type: 'bug', message: 'x' }, { origin: 'https://evil.invalid' }));
    expect(res.status).toBe(403);
  });

  it('allows a request with no Origin header (server-to-server)', async () => {
    vi.stubGlobal('fetch', routeFetch({ ...RATE_LIMIT_OK, '/rest/v1/feedback': async () => okJson({}, 201) }));
    const res = await handler(req({ type: 'bug', message: 'x' }, { origin: null }));
    expect(res.status).toBe(200);
  });

  it('rejects invalid JSON', async () => {
    vi.stubGlobal('fetch', routeFetch(RATE_LIMIT_OK));
    const res = await handler(req(null, { badJson: true }));
    expect(res.status).toBe(400);
  });

  it('rejects when the rate-limit RPC says no', async () => {
    vi.stubGlobal('fetch', routeFetch({ '/rpc/check_anon_rate_limit': async () => okJson(false) }));
    const res = await handler(req({ type: 'bug', message: 'x' }));
    expect(res.status).toBe(429);
  });

  it('rejects a failed Turnstile challenge', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    vi.stubGlobal('fetch', routeFetch({
      ...RATE_LIMIT_OK,
      'challenges.cloudflare.com': async () => okJson({ success: false, 'error-codes': ['invalid-input-response'] }),
    }));
    const res = await handler(req({ type: 'bug', message: 'x', turnstileToken: 'bad' }));
    expect(res.status).toBe(403);
  });
});

describe('field validation', () => {
  beforeEach(() => vi.stubGlobal('fetch', routeFetch(RATE_LIMIT_OK)));

  it('rejects an unknown type', async () => {
    const res = await handler(req({ type: 'spam', message: 'x' }));
    expect(res.status).toBe(400);
  });

  it('rejects a message over the length cap', async () => {
    const res = await handler(req({ type: 'bug', message: 'x'.repeat(4001) }));
    expect(res.status).toBe(400);
  });

  it('rejects a malformed email', async () => {
    const res = await handler(req({ type: 'bug', message: 'x', email: 'not-an-email' }));
    expect(res.status).toBe(400);
  });
});

describe('the actual bugs this PR fixes', () => {
  it('stores with the real columns only — no account_id, which was never a column', async () => {
    let sentBody;
    vi.stubGlobal('fetch', routeFetch({
      ...RATE_LIMIT_OK,
      '/rest/v1/feedback': async opts => { sentBody = JSON.parse(opts.body); return okJson({}, 201); },
    }));
    const res = await handler(req({
      type: 'idea', message: 'more zones please', email: 'a@b.com',
      userId: '11111111-1111-1111-1111-111111111111',
    }));
    expect(res.status).toBe(200);
    expect(Object.keys(sentBody).sort()).toEqual(['created_at', 'email', 'message', 'type', 'user_id'].sort());
    expect(sentBody.user_id).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('writes with the service-role key, not the anon key — RLS no longer grants public insert', async () => {
    let sentHeaders;
    vi.stubGlobal('fetch', routeFetch({
      ...RATE_LIMIT_OK,
      '/rest/v1/feedback': async opts => { sentHeaders = opts.headers; return okJson({}, 201); },
    }));
    await handler(req({ type: 'bug', message: 'x' }));
    expect(sentHeaders.apikey).toBe('service-key');
    expect(sentHeaders.Authorization).toBe('Bearer service-key');
  });

  it('drops a non-uuid userId rather than trusting an unverified claim of identity', async () => {
    let sentBody;
    vi.stubGlobal('fetch', routeFetch({
      ...RATE_LIMIT_OK,
      '/rest/v1/feedback': async opts => { sentBody = JSON.parse(opts.body); return okJson({}, 201); },
    }));
    const res = await handler(req({ type: 'bug', message: 'x', userId: 'not-a-uuid' }));
    expect(res.status).toBe(200);
    expect(sentBody.user_id).toBeNull();
  });

  it('surfaces a store failure as 500 rather than the old false-positive success', async () => {
    vi.stubGlobal('fetch', routeFetch({
      ...RATE_LIMIT_OK,
      '/rest/v1/feedback': async () => ({ ok: false, status: 400, text: async () => 'schema drift' }),
    }));
    const res = await handler(req({ type: 'bug', message: 'x' }));
    expect(res.status).toBe(500);
  });

  it('refuses to run without service-role config rather than silently no-op', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    vi.stubGlobal('fetch', routeFetch(RATE_LIMIT_OK));
    const res = await handler(req({ type: 'bug', message: 'x' }));
    expect(res.status).toBe(500);
  });
});

describe('regression guards (source)', () => {
  it('never sends account_id as a field — the key that was never a real column', () => {
    // The doc comment above names the historical bug on purpose; only a `key:`
    // usage (an actual field being sent) would be the regression.
    expect(src).not.toMatch(/account_id\s*:/);
  });

  it('the two sibling endpoints use the extracted helper, not a re-duplicated copy', () => {
    for (const file of ['send-support-email.js', 'create-github-issue.js']) {
      const s = readFileSync(ROOT + 'netlify/functions/' + file, 'utf8');
      expect(s, file).toContain('from "./_lib/rateLimit.js"');
      expect(s, file).not.toMatch(/async function checkRateLimit/);
    }
  });
});
