/**
 * POST /api/submit-feedback
 *
 * The `feedback` table's INSERT policy used to be `WITH CHECK (true)` for
 * public — anyone could write directly to Postgres with the anon key,
 * bypassing every defence (Turnstile, origin pinning, rate limiting, field
 * validation) that send-support-email and create-github-issue already apply
 * to the exact same form submission. Migration 25 drops that policy; this
 * function is the only way in now, matching its two siblings' pattern.
 *
 * It also fixes a second, unrelated bug found while tracing the same code
 * path: the old client-side insert sent an `account_id` field that has never
 * existed as a column on `feedback`. PostgREST rejects unknown columns, so
 * every insert has been failing — silently, since the call was wrapped in a
 * bare try/catch. This function uses the table's real columns only.
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY (rate
 *      limit RPC), TURNSTILE_SECRET_KEY (optional, see _lib/turnstile.js).
 */

import { verifyTurnstile } from "./_lib/turnstile.js";
import { checkRateLimit } from "./_lib/rateLimit.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_TYPES = new Set(["bug", "idea", "help"]);
const MAX_MESSAGE_LEN = 4000;
const MAX_FIELD_LEN = 200;
const ALLOWED_ORIGINS = new Set([
  "https://aurisargames.com",
  "https://www.aurisargames.com",
  "https://aurisargames.netlify.app",
  "http://localhost:5173",
]);

function denyOrigin(origin) {
  if (!origin) return false;
  return !ALLOWED_ORIGINS.has(origin);
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }
  if (denyOrigin(req.headers.get("origin"))) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }
  const ip = req.headers.get("x-nf-client-connection-ip")
          || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
          || "";
  if (!(await checkRateLimit(ip, "feedback"))) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429, headers: { "Content-Type": "application/json" },
    });
  }

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  const { type, message, email, userId, turnstileToken } = body || {};

  const ts = await verifyTurnstile(turnstileToken, ip);
  if (!ts.ok) {
    return new Response(JSON.stringify({ error: "Bot challenge failed" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  if (!type || !message || !ALLOWED_TYPES.has(type)) {
    return new Response(JSON.stringify({ error: "Missing or invalid fields" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  if (typeof message !== "string" || message.length > MAX_MESSAGE_LEN) {
    return new Response(JSON.stringify({ error: "Message too long" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  const cleanEmail = typeof email === "string" ? email.trim().slice(0, MAX_FIELD_LEN) : "";
  if (cleanEmail && !EMAIL_RE.test(cleanEmail)) {
    return new Response(JSON.stringify({ error: "Invalid email" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  // userId is caller-supplied (the client's own session id) and unverifiable
  // without an Authorization header this endpoint doesn't require — treat it
  // as attribution, not identity. Must look like a uuid or be omitted.
  const cleanUserId = typeof userId === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)
    ? userId
    : null;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("[submit-feedback] missing env — refusing to process");
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  const res = await fetch(`${url}/rest/v1/feedback`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      user_id: cleanUserId,
      email: cleanEmail || "anonymous",
      type,
      message,
      created_at: new Date().toISOString(),
    }),
  });

  if (!res.ok) {
    console.error("[submit-feedback] insert failed:", res.status, await res.text());
    return new Response(JSON.stringify({ error: "Store failed" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};

export const config = { path: "/api/submit-feedback" };
