/**
 * POST /api/admin/deprovision-user
 *
 * Soft-disables a user account:
 *   1. Sets profiles.disabled_at = now()
 *   2. Signs out all of the user's active sessions
 *
 * Body: { userId: string }
 *
 * Reversible — use /api/admin/reinstate-user to undo.
 */

import { requireAdmin, denyOrigin, json } from "./_lib/adminAuth.js";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (denyOrigin(req.headers.get("origin"))) return json({ error: "Forbidden" }, 403);

  const { adminUser, supabase, error } = await requireAdmin(req);
  if (error) return error;

  let body;
  try { body = await req.json(); } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const userId = typeof body?.userId === "string" ? body.userId.trim() : "";
  if (!userId) return json({ error: "userId is required" }, 400);

  // Prevent admin from disabling themselves
  if (userId === adminUser.id) {
    return json({ error: "Cannot deprovision your own account" }, 400);
  }

  // 1. Set disabled_at on the profile
  const { error: profileErr } = await supabase
    .from("profiles")
    .update({ disabled_at: new Date().toISOString() })
    .eq("id", userId);

  if (profileErr) {
    console.error("[admin-deprovision] profile update error:", profileErr.message);
    return json({ error: "Failed to deprovision user" }, 500);
  }

  // 2. Invalidate all of the user's active sessions via the GoTrue admin REST endpoint.
  // The JS SDK's supabase.auth.admin.signOut() takes a JWT string (the user's active
  // token), not a user UUID — so we call the underlying REST endpoint directly instead.
  // DELETE /auth/v1/admin/users/{id}/sessions deletes all sessions for the given user ID.
  try {
    const logoutRes = await fetch(
      `${process.env.SUPABASE_URL}/auth/v1/admin/users/${userId}/sessions`,
      {
        method: "DELETE",
        headers: {
          apikey:        process.env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        },
      }
    );
    if (!logoutRes.ok) {
      // Non-fatal: disabled_at check in loadAdminFlags blocks re-auth on any
      // future page load. Existing sessions expire on their own JWT TTL (~1 hr).
      console.warn("[admin-deprovision] session delete returned", logoutRes.status);
    }
  } catch (e) {
    console.warn("[admin-deprovision] session delete threw:", e?.message);
  }

  console.log(`[admin-deprovision] User ${userId} deprovisioned by admin ${adminUser.id}`);
  return json({ ok: true, userId });
};

export const config = { path: "/api/admin/deprovision-user" };
