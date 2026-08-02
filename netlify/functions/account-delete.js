/**
 * POST /api/account-delete — self-service account deletion.
 *
 * Body: { confirmEmail: string }
 *
 * Deletes the CALLER's own account. Distinct from /api/admin/delete-user
 * (which needs is_admin and targets someone else) — this one is scoped
 * entirely to the authenticated session, so it grants no new authority.
 *
 * Guards, in order:
 *   1. Origin allowlist (defence-in-depth; the Bearer check is the control).
 *   2. Valid Supabase session → the caller's own id and email.
 *   3. Typed email must match the session's — same second factor the admin
 *      path uses, and it forces a deliberate act rather than a stray click.
 *   4. Assurance: an MFA-enrolled user must be at aal2. Otherwise a stolen
 *      aal1 token could erase an account that MFA was supposed to protect.
 *
 * Deletion cascades to profiles (FK profiles.id → auth.users.id ON DELETE
 * CASCADE), which in turn cascades notifications / notification_prefs /
 * friend_exercise_events. 3D Realm state is NOT covered — the world keeps its
 * own anonymous per-browser identity with no link to the Supabase user, so
 * there is nothing to key a deletion on. That linkage is the Realm track's
 * work; noted here so the gap is explicit rather than assumed handled.
 */

import { createClient } from "@supabase/supabase-js";
import { denyOrigin, json } from "./_lib/adminAuth.js";

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
  if (!user?.id || !user?.email) return json({ error: "Unauthorized" }, 401);

  let body;
  try { body = await req.json(); } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  const confirmEmail =
    typeof body?.confirmEmail === "string" ? body.confirmEmail.trim() : "";
  if (!confirmEmail) {
    return json({ error: "confirmEmail is required for permanent deletion" }, 400);
  }
  if (confirmEmail.toLowerCase() !== String(user.email).toLowerCase()) {
    return json({ error: "Email confirmation does not match" }, 400);
  }

  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Step-up: if the caller has a verified factor, require an aal2 session.
  // Supabase puts the assurance level in the token's `aal` claim; the session
  // endpoint above already proved the token is valid, so decoding the payload
  // for this check is safe.
  try {
    const claims = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8")
    );
    const { data: factors } = await supabase.auth.admin.mfa.listFactors({
      userId: user.id,
    });
    const hasVerified = (factors?.factors || []).some(f => f.status === "verified");
    if (hasVerified && claims.aal !== "aal2") {
      return json(
        { error: "Complete two-factor authentication before deleting your account" },
        403
      );
    }
  } catch (e) {
    console.error("[account-delete] assurance check failed:", e.message);
    return json({ error: "Could not verify account security state" }, 500);
  }

  const { error: deleteErr } = await supabase.auth.admin.deleteUser(user.id);
  if (deleteErr) {
    console.error("[account-delete] deleteUser error:", deleteErr.message);
    return json({ error: "Failed to delete account" }, 500);
  }

  console.log(`[account-delete] User ${user.id} self-deleted`);
  return json({ ok: true });
};

export const config = { path: "/api/account-delete" };
