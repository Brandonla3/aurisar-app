// Per-IP rate limiting for anonymous-facing endpoints, backed by the
// SECURITY DEFINER RPC `check_anon_rate_limit` (scripts/security/05-anon-rate-limit.sql).
// Default policy: 5 requests per 15 minutes per (kind, ip).
//
// `kind` namespaces the bucket per endpoint so callers don't share a limit —
// see scripts/security/25-close-feedback-direct-insert.sql for the third
// caller this was extracted for.
//
// Fails OPEN (returns true) on missing config or transport errors, so an
// outage in Supabase or a misconfigured env doesn't take down the endpoint
// this guards — the endpoint's own validation is the remaining perimeter.
export async function checkRateLimit(ip, kind) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return true;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/check_anon_rate_limit`, {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_kind: kind, p_ip: ip || "" }),
    });
    if (!res.ok) return true;
    const ok = await res.json();
    return Boolean(ok);
  } catch {
    return true;
  }
}
