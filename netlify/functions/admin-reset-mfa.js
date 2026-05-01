/**
 * POST /api/admin/reset-mfa
 *
 * Resets one or all MFA factors for a user.
 *
 * Body: { userId: string, factor: 'totp' | 'phone' | 'passkey' | 'all' }
 *
 * - 'totp'    : Delete all TOTP factors (factor_type = 'totp')
 * - 'phone'   : Delete all phone/SMS factors + clear phone/phoneVerified in profile data
 * - 'passkey' : Delete all WebAuthn/passkey factors (factor_type = 'webauthn')
 * - 'all'     : Delete all factors of all types + recovery codes
 */

import { requireAdmin, denyOrigin, json } from "./_lib/adminAuth.js";

const VALID_FACTORS = new Set(["totp", "phone", "passkey", "all"]);

// Maps factor choice to Supabase factor_type strings
const FACTOR_TYPE_MAP = {
  totp:    ["totp"],
  phone:   ["phone"],
  passkey: ["webauthn"],
  all:     null, // handled separately
};

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
  const factor = typeof body?.factor === "string" ? body.factor.trim() : "";

  if (!userId) return json({ error: "userId is required" }, 400);
  if (!VALID_FACTORS.has(factor)) {
    return json({ error: `factor must be one of: ${[...VALID_FACTORS].join(", ")}` }, 400);
  }

  // Fetch the user to get their email (needed for 'all' RPC path)
  const { data: targetUserData, error: fetchErr } = await supabase.auth.admin.getUserById(userId);
  if (fetchErr || !targetUserData?.user) {
    return json({ error: "User not found" }, 404);
  }
  const targetUser = targetUserData.user;

  // ── 'all': use the existing admin_reset_user_mfa RPC (deletes factors + recovery codes)
  if (factor === "all") {
    const { error: rpcErr } = await supabase.rpc("admin_reset_user_mfa", {
      user_email: targetUser.email,
    });
    if (rpcErr) {
      console.error("[admin-reset-mfa] all RPC error:", rpcErr.message);
      return json({ error: "Failed to reset all MFA" }, 500);
    }
    // Also clear phone from profile data
    await clearPhoneFromProfile(supabase, userId);
    console.log(`[admin-reset-mfa] All MFA reset for ${userId} by admin ${adminUser.id}`);
    return json({ ok: true, userId, factor: "all" });
  }

  // ── Specific factor: list factors then delete matching ones
  // listFactors returns { data: { all: Factor[], totp: Factor[], phone: Factor[] } }.
  // Use data.all — the flat list of every enrolled factor — and filter by factor_type.
  // (factors.webAuthn doesn't exist; webauthn factors have factor_type = 'webauthn'
  //  and only appear in factors.all.)
  const { data: factorsData, error: listErr } = await supabase.auth.admin.mfa.listFactors({ userId });
  if (listErr) {
    console.error("[admin-reset-mfa] listFactors error:", listErr.message);
    return json({ error: "Failed to list MFA factors" }, 500);
  }

  const targetTypes = FACTOR_TYPE_MAP[factor];
  const allFactors = factorsData?.all ?? [];
  const toDelete = allFactors.filter(f => targetTypes.includes(f.factor_type));

  if (toDelete.length === 0) {
    return json({ ok: true, userId, factor, deleted: 0, message: "No matching factors found" });
  }

  let deleted = 0;
  for (const f of toDelete) {
    const { error: delErr } = await supabase.auth.admin.mfa.deleteFactor({ userId, id: f.id });
    if (delErr) {
      console.error(`[admin-reset-mfa] deleteFactor ${f.id} error:`, delErr.message);
    } else {
      deleted++;
    }
  }

  // If resetting phone factor, also clear phone/phoneVerified in profile data
  if (factor === "phone") {
    await clearPhoneFromProfile(supabase, userId);
  }

  console.log(`[admin-reset-mfa] Factor '${factor}' reset for ${userId} (${deleted} deleted) by admin ${adminUser.id}`);
  return json({ ok: true, userId, factor, deleted });
};

async function clearPhoneFromProfile(supabase, userId) {
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("data")
      .eq("id", userId)
      .single();

    if (profile?.data) {
      const { phone: _p, phoneVerified: _pv, ...rest } = profile.data;
      await supabase
        .from("profiles")
        .update({ data: rest })
        .eq("id", userId);
    }
  } catch (e) {
    console.warn("[admin-reset-mfa] clearPhoneFromProfile warning:", e?.message);
  }
}

export const config = { path: "/api/admin/reset-mfa" };
