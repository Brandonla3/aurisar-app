/**
 * GET /api/admin/list-users
 *
 * Returns the full user roster via the admin_list_users() Postgres RPC.
 * Requires a valid admin session (is_admin = true on profiles).
 */

import { requireAdmin, denyOrigin, json } from "./_lib/adminAuth.js";

export default async (req) => {
  if (req.method !== "GET") return json({ error: "Method not allowed" }, 405);
  if (denyOrigin(req.headers.get("origin"))) return json({ error: "Forbidden" }, 403);

  const { adminUser, supabase, error } = await requireAdmin(req);
  if (error) return error;

  const { data, error: rpcErr } = await supabase.rpc("admin_list_users");
  if (rpcErr) {
    console.error("[admin-list-users] RPC error:", rpcErr.message);
    return json({ error: "Failed to load users" }, 500);
  }

  return json({ users: data ?? [], requestedBy: adminUser.id });
};

export const config = { path: "/api/admin/list-users" };
