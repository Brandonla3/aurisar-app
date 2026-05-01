/**
 * POST /api/admin/delete-user
 *
 * PERMANENTLY deletes a user from auth.users (and their profile, via CASCADE).
 * This is irreversible.
 *
 * Body: { userId: string, confirmEmail: string }
 *
 * The caller must supply the user's email as confirmEmail — matched server-side
 * as a second factor against accidental/mistaken deletion.
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

  const userId       = typeof body?.userId       === "string" ? body.userId.trim()       : "";
  const confirmEmail = typeof body?.confirmEmail === "string" ? body.confirmEmail.trim() : "";

  if (!userId)       return json({ error: "userId is required" }, 400);
  if (!confirmEmail) return json({ error: "confirmEmail is required for permanent deletion" }, 400);

  // Prevent deleting yourself
  if (userId === adminUser.id) {
    return json({ error: "Cannot delete your own account" }, 400);
  }

  // Fetch the user from auth.users to verify the email matches
  const { data: targetUser, error: fetchErr } = await supabase.auth.admin.getUserById(userId);
  if (fetchErr || !targetUser?.user) {
    return json({ error: "User not found" }, 404);
  }

  if (targetUser.user.email?.toLowerCase() !== confirmEmail.toLowerCase()) {
    return json({ error: "Email confirmation does not match" }, 400);
  }

  // Hard delete — cascades to profiles (FK: profiles.id → auth.users.id ON DELETE CASCADE)
  const { error: deleteErr } = await supabase.auth.admin.deleteUser(userId);
  if (deleteErr) {
    console.error("[admin-delete] deleteUser error:", deleteErr.message);
    return json({ error: "Failed to delete user" }, 500);
  }

  console.log(`[admin-delete] User ${userId} (${confirmEmail}) permanently deleted by admin ${adminUser.id}`);
  return json({ ok: true, userId });
};

export const config = { path: "/api/admin/delete-user" };
