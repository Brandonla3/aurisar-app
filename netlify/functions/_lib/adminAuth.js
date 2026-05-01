/**
 * Shared admin authentication helper for all /api/admin/* Netlify functions.
 *
 * Usage:
 *   import { requireAdmin, serviceSupabase, ALLOWED_ORIGINS, denyOrigin } from './_lib/adminAuth.js';
 *
 *   export default async (req) => {
 *     if (denyOrigin(req.headers.get('origin'))) return deny();
 *     const { adminUser, error } = await requireAdmin(req);
 *     if (error) return error;
 *     // adminUser.id is the authenticated admin's UUID
 *   };
 *
 * Security model:
 *   1. Bearer token → Supabase /auth/v1/user (validates session)
 *   2. profiles.is_admin column check (service_role read → can't be spoofed)
 *   3. All privileged writes use the service_role client, never the anon client
 */

import { createClient } from "@supabase/supabase-js";

export const ALLOWED_ORIGINS = new Set([
  "https://aurisargames.com",
  "https://www.aurisargames.com",
  "https://aurisargames.netlify.app",
  "http://localhost:5173",
]);

export function denyOrigin(origin) {
  if (!origin) return false; // server-to-server — skip browser-only check
  return !ALLOWED_ORIGINS.has(origin);
}

/** Build a service-role Supabase client. Never use this client-side. */
export function serviceSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Validate the request's Bearer token and confirm the caller is an admin.
 *
 * Returns { adminUser, supabase } on success, or { error: Response } on failure.
 * `supabase` is the service-role client ready for admin operations.
 */
export async function requireAdmin(req) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    return { error: json({ error: "Unauthorized" }, 401) };
  }

  // 1. Validate the session token against Supabase Auth
  const supabaseUrl  = process.env.SUPABASE_URL;
  const supabaseAnon = process.env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnon) {
    return { error: json({ error: "Server misconfigured" }, 500) };
  }

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseAnon,
      Authorization: `Bearer ${token}`,
    },
  });
  if (!userRes.ok) {
    return { error: json({ error: "Unauthorized" }, 401) };
  }
  const authUser = await userRes.json();
  if (!authUser?.id) {
    return { error: json({ error: "Unauthorized" }, 401) };
  }

  // 2. Check is_admin on the profiles table (service_role — can't be spoofed by client)
  let supa;
  try {
    supa = serviceSupabase();
  } catch {
    return { error: json({ error: "Server misconfigured" }, 500) };
  }

  const { data: profile, error: profileErr } = await supa
    .from("profiles")
    .select("is_admin")
    .eq("id", authUser.id)
    .single();

  if (profileErr || !profile?.is_admin) {
    return { error: json({ error: "Forbidden" }, 403) };
  }

  return { adminUser: authUser, supabase: supa };
}

/** Shorthand JSON response builder */
export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
