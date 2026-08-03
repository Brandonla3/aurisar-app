import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkRateLimit } from '../_lib/rateLimit.js';

const ENV = { ...process.env };

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://proj.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
});

afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
});

describe('checkRateLimit — fails open, never blocks traffic on our own outage', () => {
  it('fails open when SUPABASE_URL/ANON_KEY are not configured', async () => {
    delete process.env.SUPABASE_URL;
    await expect(checkRateLimit('1.2.3.4', 'feedback')).resolves.toBe(true);
  });

  it('fails open on a transport error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await expect(checkRateLimit('1.2.3.4', 'feedback')).resolves.toBe(true);
  });

  it('fails open on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    await expect(checkRateLimit('1.2.3.4', 'feedback')).resolves.toBe(true);
  });
});

describe('checkRateLimit — otherwise trusts the RPC verdict', () => {
  it('allowed', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => true })));
    await expect(checkRateLimit('1.2.3.4', 'feedback')).resolves.toBe(true);
  });

  it('blocked', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => false })));
    await expect(checkRateLimit('1.2.3.4', 'feedback')).resolves.toBe(false);
  });
});

describe('checkRateLimit — the reason this was extracted', () => {
  it('namespaces the bucket by kind, so three callers do not share one limit', async () => {
    let sentBody;
    vi.stubGlobal('fetch', vi.fn(async (_url, opts) => {
      sentBody = JSON.parse(opts.body);
      return { ok: true, json: async () => true };
    }));
    await checkRateLimit('9.9.9.9', 'github_issue');
    expect(sentBody).toEqual({ p_kind: 'github_issue', p_ip: '9.9.9.9' });
  });

  it('calls the RPC with the anon key, not a service key', async () => {
    let sentUrl, sentHeaders;
    vi.stubGlobal('fetch', vi.fn(async (url, opts) => {
      sentUrl = url;
      sentHeaders = opts.headers;
      return { ok: true, json: async () => true };
    }));
    await checkRateLimit('1.2.3.4', 'feedback');
    expect(sentUrl).toBe('https://proj.supabase.co/rest/v1/rpc/check_anon_rate_limit');
    expect(sentHeaders.apikey).toBe('anon-key');
  });
});
