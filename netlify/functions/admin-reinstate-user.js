/**
 * POST /api/admin/reinstate-user
 *
 * Reverses a soft-disable: clears profiles.disabled_at so the user can
 * sign in again.
 *
 * Body: { userId: string }
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

  const { error: profileErr } = await supabase
    .from("profiles")
    .update({ disabled_at: null })
    .eq("id", userId);

  if (profileErr) {
    console.error("[admin-reinstate] profile update error:", profileErr.message);
    return json({ error: "Failed to reinstate user" }, 500);
  }

  console.log(`[admin-reinstate] User ${userId} reinstated by admin ${adminUser.id}`);
  return json({ ok: true, userId });
};

export const config = { path: "/api/admin/reinstate-user" };
