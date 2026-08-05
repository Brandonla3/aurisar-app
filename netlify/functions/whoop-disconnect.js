/**
 * POST /api/whoop-disconnect — withdraw WHOOP consent.
 *
 * Body: { deleteData?: boolean }
 *
 * The privacy policy has been promising this control and it did not exist:
 *
 *   "WHOOP fitness data — retained while you have WHOOP connected. You can
 *    disconnect at any time from your profile; data is deleted on request."
 *      — src/components/PrivacyPolicy.jsx (Retention)
 *   "Withdraw consent — disconnect WHOOP or other integrations at any time."
 *      — src/components/PrivacyPolicy.jsx (Your rights)
 *
 * The profile only ever offered "↻ Sync". This is the missing half.
 *
 * Scoped entirely to the caller's own session, like account-delete.js — it
 * grants no authority the caller did not already have over their own data,
 * so it needs no admin check. The service role is used only because
 * migration 28 revoked the client roles' access to whoop_tokens.
 *
 * `deleteData` is opt-in. Disconnecting stops all future sync and destroys
 * the credential; the stored history is a separate decision, and the policy
 * treats them separately ("disconnect at any time; data is deleted on
 * request"). Defaulting to true would silently destroy months of health
 * history on what reads as a connection toggle.
 */

import { createClient } from "@supabase/supabase-js";
import { denyOrigin, json } from "./_lib/adminAuth.js";

// Best-effort revocation at WHOOP. Deleting our copy of the token already
// ends Aurisar's access; this additionally invalidates it upstream so the
// credential is dead even if a copy leaked before now. A failure here must
// not block the disconnect — the local delete is what the user asked for.
async function revokeUpstream(refreshToken) {
  const id = process.env.WHOOP_CLIENT_ID;
  const secret = process.env.WHOOP_CLIENT_SECRET;
  if (!id || !secret || !refreshToken) return { attempted: false };
  try {
    const res = await fetch("https://api.prod.whoop.com/oauth/oauth2/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: id,
        client_secret: secret,
        token: refreshToken,
        token_type_hint: "refresh_token",
      }),
    });
    return { attempted: true, ok: res.ok };
  } catch (e) {
    return { attempted: true, ok: false, error: e.message };
  }
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (denyOrigin(req.headers.get("origin"))) return json({ error: "Forbidden" }, 403);

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) return json({ error: "Unauthorized" }, 401);

  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anon || !serviceKey) return json({ error: "Server misconfigured" }, 500);

  // Resolve the caller from their own token — never from the request body.
  const userRes = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anon, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return json({ error: "Unauthorized" }, 401);
  const user = await userRes.json();
  if (!user?.id) return json({ error: "Unauthorized" }, 401);

  let body = {};
  try { body = (await req.json()) || {}; } catch { /* no body is fine */ }
  const deleteData = body.deleteData === true;

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Read the refresh token solely to revoke it upstream; it is never returned.
  const { data: row } = await supabase
    .from("whoop_tokens")
    .select("refresh_token")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!row) {
    // Already disconnected. Idempotent: the end state the caller wanted.
    return json({ ok: true, alreadyDisconnected: true, dataDeleted: 0 });
  }

  const revoked = await revokeUpstream(row.refresh_token);

  const { error: delErr } = await supabase
    .from("whoop_tokens")
    .delete()
    .eq("user_id", user.id);
  if (delErr) {
    console.error("[whoop-disconnect] token delete failed:", delErr.message);
    return json({ error: "Could not disconnect. Try again." }, 500);
  }

  let dataDeleted = 0;
  if (deleteData) {
    const { count, error: dataErr } = await supabase
      .from("whoop_data")
      .delete({ count: "exact" })
      .eq("user_id", user.id);
    if (dataErr) {
      // The credential is already gone — the disconnect succeeded. Report the
      // partial outcome rather than a blanket failure the user can't act on.
      console.error("[whoop-disconnect] data delete failed:", dataErr.message);
      return json({ ok: true, dataDeleted: 0, dataDeleteFailed: true });
    }
    dataDeleted = count ?? 0;
  }

  console.log(
    `[whoop-disconnect] user ${user.id} disconnected` +
    ` (upstream revoke: ${revoked.attempted ? (revoked.ok ? "ok" : "failed") : "skipped"},` +
    ` rows deleted: ${dataDeleted})`
  );
  return json({ ok: true, dataDeleted });
};

export const config = { path: "/api/whoop-disconnect" };
