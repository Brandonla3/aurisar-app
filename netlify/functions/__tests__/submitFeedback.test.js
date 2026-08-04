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
  // Absent by default so email/issue side effects short-circuit to
  // "misconfigured" without touching the network — deterministic regardless
  // of what the host shell happens to have set.
  delete process.env.RESEND_API_KEY;
  delete process.env.GITHUB_TOKEN;
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

describe('single-verification orchestration — the Bugbot follow-up on #314', () => {
  // Cloudflare Turnstile tokens are single-use. The client used to fire this
  // insert, send-support-email, and create-github-issue as three separate
  // requests sharing one token — invisible with TURNSTILE_SECRET_KEY unset
  // (verifyTurnstile fails open), but the moment it's live the first to
  // verify would consume the token and the other two would 403. Fix: this
  // function verifies once and triggers both side effects in-process.

  it('triggers the support email and (for bug/idea) the GitHub issue after one store', async () => {
    process.env.RESEND_API_KEY = 'resend-key';
    process.env.GITHUB_TOKEN = 'gh-token';
    vi.stubGlobal('fetch', routeFetch({
      ...RATE_LIMIT_OK,
      '/rest/v1/feedback': async () => okJson({}, 201),
      'api.resend.com': async () => okJson({ id: 'email_1' }, 200),
      'api.github.com': async () => okJson({ id: 1 }, 201),
    }));
    const res = await handler(req({ type: 'bug', message: 'x' }));
    const parsed = JSON.parse(await res.text());
    expect(res.status).toBe(200);
    expect(parsed).toEqual({ ok: true, email: true, issue: true });
  });

  it('never attempts a GitHub issue for type=help — issue stays null, not false', async () => {
    process.env.RESEND_API_KEY = 'resend-key';
    vi.stubGlobal('fetch', routeFetch({
      ...RATE_LIMIT_OK,
      '/rest/v1/feedback': async () => okJson({}, 201),
      'api.resend.com': async () => okJson({ id: 'email_1' }, 200),
      'api.github.com': async () => { throw new Error('must not be called for help'); },
    }));
    const res = await handler(req({ type: 'help', message: 'how do I log a run?' }));
    const parsed = JSON.parse(await res.text());
    expect(parsed.issue).toBeNull();
  });

  it('a failed support email does not fail the request — the feedback is already durably stored', async () => {
    process.env.RESEND_API_KEY = 'resend-key';
    vi.stubGlobal('fetch', routeFetch({
      ...RATE_LIMIT_OK,
      '/rest/v1/feedback': async () => okJson({}, 201),
      'api.resend.com': async () => ({ ok: false, status: 500, text: async () => 'resend down' }),
    }));
    const res = await handler(req({ type: 'idea', message: 'x' }));
    const parsed = JSON.parse(await res.text());
    expect(res.status).toBe(200);
    expect(parsed.ok).toBe(true);
    expect(parsed.email).toBe(false);
  });

  it('one Turnstile verification covers the store AND both side effects — not three', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'ts-secret';
    process.env.RESEND_API_KEY = 'resend-key';
    process.env.GITHUB_TOKEN = 'gh-token';
    let siteverifyCalls = 0;
    vi.stubGlobal('fetch', routeFetch({
      ...RATE_LIMIT_OK,
      'challenges.cloudflare.com': async () => { siteverifyCalls++; return okJson({ success: true }); },
      '/rest/v1/feedback': async () => okJson({}, 201),
      'api.resend.com': async () => okJson({ id: 'email_1' }, 200),
      'api.github.com': async () => okJson({ id: 1 }, 201),
    }));
    const res = await handler(req({ type: 'bug', message: 'x', turnstileToken: 'one-token' }));
    expect(res.status).toBe(200);
    // The real bug: reusing the same token 3x would 403 legs 2-3 once this
    // secret is live (Cloudflare tokens are single-use). Proving it here
    // means siteverify is called exactly once for one submission.
    expect(siteverifyCalls).toBe(1);
  });
});

describe('regression guards (source)', () => {
  it('never sends account_id as a field — the key that was never a real column', () => {
    // The doc comment above names the historical bug on purpose; only a `key:`
    // usage (an actual field being sent) would be the regression.
    expect(src).not.toMatch(/account_id\s*:/);
  });

  it('the two sibling endpoints use the extracted rate-limit helper, not a re-duplicated copy', () => {
    for (const file of ['send-support-email.js', 'create-github-issue.js']) {
      const s = readFileSync(ROOT + 'netlify/functions/' + file, 'utf8');
      expect(s, file).toContain('from "./_lib/rateLimit.js"');
      expect(s, file).not.toMatch(/async function checkRateLimit/);
    }
  });

  it('this function is the single orchestrator — imports both side-effect helpers', () => {
    expect(src).toContain('from "./_lib/supportEmail.js"');
    expect(src).toContain('from "./_lib/githubIssue.js"');
  });

  it('the client no longer fires three separate requests sharing one Turnstile token', () => {
    const appSrc = readFileSync(ROOT + 'src/App.jsx', 'utf8');
    expect(appSrc).not.toContain('/api/send-support-email');
    expect(appSrc).not.toContain('/api/create-github-issue');
    expect(appSrc).toContain('/api/submit-feedback');
  });

  it('the client only claims success after the response resolves, not before the fetch', () => {
    const appSrc = readFileSync(ROOT + 'src/App.jsx', 'utf8');
    const submitBlock = appSrc.slice(appSrc.indexOf('/api/submit-feedback') - 400, appSrc.indexOf('/api/submit-feedback') + 800);
    expect(submitBlock).toMatch(/if\s*\(res\.ok\)/);
  });
});
