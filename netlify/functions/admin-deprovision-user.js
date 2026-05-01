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

  // 2. Sign out all of the user's sessions so the kick takes immediate effect
  const { error: signOutErr } = await supabase.auth.admin.signOut(userId, "others");
  if (signOutErr) {
    // Non-fatal — the disabled_at check on login will catch them on next load
    console.warn("[admin-deprovision] signOut warning:", signOutErr.message);
  }

  console.log(`[admin-deprovision] User ${userId} deprovisioned by admin ${adminUser.id}`);
  return json({ ok: true, userId });
};

export const config = { path: "/api/admin/deprovision-user" };
