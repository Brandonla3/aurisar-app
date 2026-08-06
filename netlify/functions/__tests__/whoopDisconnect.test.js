import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const src = readFileSync(ROOT + 'netlify/functions/whoop-disconnect.js', 'utf8');
const migration = readFileSync(
  ROOT + 'scripts/security/28-whoop-tokens-are-not-client-readable.sql', 'utf8'
);

const ENV = { ...process.env };
const ORIGIN = 'https://aurisargames.com';

// One chainable stub standing in for the supabase-js query builder, recording
// what the handler asked for so the assertions can be about behaviour.
function makeSupabase({ tokenRow = { refresh_token: 'rt_live' }, deleteCount = 7, dataErr = null, readErr = null } = {}) {
  const calls = { deleted: [], selected: [] };
  const client = {
    from(table) {
      const q = {
        _table: table,
        select(cols) { calls.selected.push({ table, cols }); return q; },
        delete() { calls.deleted.push(table); q._isDelete = true; return q; },
        eq() { return q; },
        maybeSingle: async () => ({ data: readErr ? null : tokenRow, error: readErr }),
        then(resolve) {
          // Awaiting a delete chain resolves here.
          if (table === 'whoop_data') return resolve({ count: deleteCount, error: dataErr });
          return resolve({ error: null });
        },
      };
      return q;
    },
  };
  return { client, calls };
}

let supabaseStub;
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => supabaseStub.client,
}));

function req(body, { origin = ORIGIN, method = 'POST', token = 'jwt.token.here' } = {}) {
  const h = new Map();
  if (origin) h.set('origin', origin);
  if (token) h.set('authorization', `Bearer ${token}`);
  return {
    method,
    headers: { get: k => h.get(String(k).toLowerCase()) ?? null },
    json: async () => body,
  };
}

const USER = { id: 'aaaaaaaa-1111-2222-3333-444444444444' };

beforeEach(() => {
  process.env.SUPABASE_URL = 'https://proj.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'anon-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  delete process.env.WHOOP_CLIENT_ID;
  delete process.env.WHOOP_CLIENT_SECRET;
  supabaseStub = makeSupabase();
});

afterEach(() => {
  process.env = { ...ENV };
  vi.unstubAllGlobals();
  vi.resetModules();
});

const authOk = () =>
  vi.fn(async url => {
    if (String(url).includes('/auth/v1/user')) {
      return { ok: true, json: async () => USER };
    }
    if (String(url).includes('whoop.com')) return { ok: true };
    throw new Error('unmocked fetch: ' + url);
  });

async function handler() {
  return (await import('../whoop-disconnect.js')).default;
}

describe('the perimeter — self-scoped, like account-delete.js', () => {
  it('rejects non-POST', async () => {
    const res = await (await handler())(req({}, { method: 'GET' }));
    expect(res.status).toBe(405);
  });

  it('rejects an unknown origin', async () => {
    const res = await (await handler())(req({}, { origin: 'https://evil.invalid' }));
    expect(res.status).toBe(403);
  });

  it('rejects a request with no Bearer token', async () => {
    const res = await (await handler())(req({}, { token: null }));
    expect(res.status).toBe(401);
  });

  it('rejects a token Supabase will not resolve', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    const res = await (await handler())(req({}));
    expect(res.status).toBe(401);
  });
});

describe('disconnecting', () => {
  it('deletes the token row and reports success', async () => {
    vi.stubGlobal('fetch', authOk());
    const res = await (await handler())(req({}));
    expect(res.status).toBe(200);
    expect(supabaseStub.calls.deleted).toContain('whoop_tokens');
  });

  it('keeps stored data by default — a connection toggle must not destroy history', async () => {
    vi.stubGlobal('fetch', authOk());
    const res = await (await handler())(req({}));
    const out = JSON.parse(await res.text());
    expect(supabaseStub.calls.deleted).not.toContain('whoop_data');
    expect(out.dataDeleted).toBe(0);
  });

  it('deletes stored data only when explicitly asked', async () => {
    vi.stubGlobal('fetch', authOk());
    const res = await (await handler())(req({ deleteData: true }));
    const out = JSON.parse(await res.text());
    expect(supabaseStub.calls.deleted).toContain('whoop_data');
    expect(out.dataDeleted).toBe(7);
  });

  it('is idempotent when already disconnected', async () => {
    supabaseStub = makeSupabase({ tokenRow: null });
    vi.stubGlobal('fetch', authOk());
    const res = await (await handler())(req({}));
    const out = JSON.parse(await res.text());
    expect(res.status).toBe(200);
    expect(out.alreadyDisconnected).toBe(true);
    expect(supabaseStub.calls.deleted).not.toContain('whoop_tokens');
  });

  it('still purges when asked, even if the token row is already gone', async () => {
    // The previous version returned early on a missing token row, so "delete
    // my data" after an earlier keep-the-data disconnect silently did nothing
    // and reported success. The earlier test asserted that behaviour, which
    // pinned the bug rather than the requirement.
    supabaseStub = makeSupabase({ tokenRow: null, deleteCount: 12 });
    vi.stubGlobal('fetch', authOk());
    const res = await (await handler())(req({ deleteData: true }));
    const out = JSON.parse(await res.text());
    expect(res.status).toBe(200);
    expect(out.alreadyDisconnected).toBe(true);
    expect(supabaseStub.calls.deleted).toContain('whoop_data');
    expect(out.dataDeleted).toBe(12);
  });

  it('a token-lookup ERROR is never reported as "already disconnected"', async () => {
    // Reading only `data` made a query failure indistinguishable from "no
    // row", so the API answered 200 while the credential was still live.
    supabaseStub = makeSupabase({ tokenRow: null, readErr: { message: 'connection reset' } });
    vi.stubGlobal('fetch', authOk());
    const res = await (await handler())(req({}));
    const out = JSON.parse(await res.text());
    expect(res.status).toBe(500);
    expect(out.ok).toBeUndefined();
    expect(out.alreadyDisconnected).toBeUndefined();
    expect(supabaseStub.calls.deleted).not.toContain('whoop_data');
  });

  it('still reports success if the data purge fails — the credential is already gone', async () => {
    supabaseStub = makeSupabase({ dataErr: { message: 'boom' } });
    vi.stubGlobal('fetch', authOk());
    const res = await (await handler())(req({ deleteData: true }));
    const out = JSON.parse(await res.text());
    expect(res.status).toBe(200);
    expect(out.ok).toBe(true);
    expect(out.dataDeleteFailed).toBe(true);
  });

  it('never returns token material', async () => {
    vi.stubGlobal('fetch', authOk());
    const res = await (await handler())(req({}));
    const text = await res.text();
    expect(text).not.toContain('rt_live');
    expect(text).not.toMatch(/refresh_token|access_token/);
  });

  it('does not let an upstream revoke failure block the disconnect', async () => {
    process.env.WHOOP_CLIENT_ID = 'id';
    process.env.WHOOP_CLIENT_SECRET = 'secret';
    vi.stubGlobal('fetch', vi.fn(async url => {
      if (String(url).includes('/auth/v1/user')) return { ok: true, json: async () => USER };
      if (String(url).includes('whoop.com')) throw new Error('WHOOP down');
      throw new Error('unmocked: ' + url);
    }));
    const res = await (await handler())(req({}));
    expect(res.status).toBe(200);
    expect(supabaseStub.calls.deleted).toContain('whoop_tokens');
  });
});

describe('source guards', () => {
  it('resolves the caller from their own token, never from the body', () => {
    expect(src).toContain('/auth/v1/user');
    expect(src).not.toMatch(/body\.(userId|user_id)/);
  });

  it('data deletion is opt-in, not the default', () => {
    expect(src).toMatch(/body\.deleteData === true/);
  });

  it('checks the token-lookup error rather than reading only data', () => {
    expect(src).toMatch(/const \{ data: row, error: readErr \}/);
    expect(src).not.toMatch(/const \{ data: row \} = await/);
  });

  it('the purge is not nested behind the token-row branch', () => {
    // If `if (deleteData)` sits inside `if (row)`, the "delete on request"
    // path silently no-ops once the token is already gone.
    const rowBranch = src.slice(src.indexOf('if (row) {'), src.indexOf('let dataDeleted'));
    expect(rowBranch).not.toContain('deleteData');
  });

  it('the confirm aborts before it asks about data', () => {
    const tab = readFileSync(ROOT + 'src/features/profile/ProfileTab.jsx', 'utf8');
    const fn = tab.slice(tab.indexOf('async function handleDisconnectWhoop'));
    // A bare `if (!window.confirm(...)) return;` must come before the
    // purge question, so Cancel/Escape means "never mind", not "disconnect
    // me but keep the data".
    const abortIdx = fn.indexOf('if (!window.confirm(');
    const purgeIdx = fn.indexOf('const purge = window.confirm(');
    expect(abortIdx).toBeGreaterThan(-1);
    expect(abortIdx).toBeLessThan(purgeIdx);
  });

  it('the migration grants only the user_id column, never the tokens', () => {
    expect(migration).toMatch(/GRANT SELECT \(user_id\) ON public\.whoop_tokens TO authenticated/);
    expect(migration).not.toMatch(/GRANT SELECT[^(]*ON public\.whoop_tokens TO authenticated/);
  });

  it('the migration takes the token table away from the client roles', () => {
    expect(migration).toMatch(
      /REVOKE ALL ON TABLE public\.whoop_tokens FROM PUBLIC, anon, authenticated/
    );
    expect(migration).toMatch(/DROP POLICY IF EXISTS "own tokens only" ON public\.whoop_tokens/);
  });

  it('the status RPC exposes no token columns', () => {
    const fn = migration.slice(migration.indexOf('FUNCTION public.whoop_connection_status'));
    expect(fn).not.toMatch(/access_token|refresh_token/);
    expect(fn).toMatch(/GRANT EXECUTE ON FUNCTION public\.whoop_connection_status\(\) TO authenticated/);
  });

  it('the client asks the RPC, not the table', () => {
    const tab = readFileSync(ROOT + 'src/features/profile/ProfileTab.jsx', 'utf8');
    expect(tab).toMatch(/sb\.rpc\('whoop_connection_status'\)/);
    expect(tab).not.toMatch(/from\('whoop_tokens'\)/);
  });

  it('the profile now offers the Disconnect the privacy policy promises', () => {
    const tab = readFileSync(ROOT + 'src/features/profile/ProfileTab.jsx', 'utf8');
    const policy = readFileSync(ROOT + 'src/components/PrivacyPolicy.jsx', 'utf8');
    expect(tab).toContain('handleDisconnectWhoop');
    expect(tab).toContain('/api/whoop-disconnect');
    expect(policy).toMatch(/disconnect at any time from your profile/i);
  });
});
