import { verifyTurnstile } from "./_lib/turnstile.js";
import { checkRateLimit } from "./_lib/rateLimit.js";
import { sendSupportEmail } from "./_lib/supportEmail.js";

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
  // Browser-driven calls must come from a known origin. Server-to-server
  // callers (no Origin header) bypass this — for those, the strict body
  // validation + the Supabase rate-limit RPC is the perimeter.
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
  if (!(await checkRateLimit(ip, "support_email"))) {
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
  const { type, message, email, accountId, turnstileToken } = body || {};

  // Bot defence (Cloudflare Turnstile). Skips silently if TURNSTILE_SECRET_KEY
  // is not configured — see netlify/functions/_lib/turnstile.js.
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
  // Reject email/accountId that are too long or contain control characters
  // — they are eventually rendered into HTML and stored in Supabase.
  const cleanEmail = typeof email === "string" ? email.trim().slice(0, MAX_FIELD_LEN) : "";
  const cleanAcct  = typeof accountId === "string" ? accountId.trim().slice(0, MAX_FIELD_LEN) : "";
  if (cleanEmail && !EMAIL_RE.test(cleanEmail)) {
    return new Response(JSON.stringify({ error: "Invalid email" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const result = await sendSupportEmail({ type, message, cleanEmail, cleanAcct });
  if (!result.ok) {
    const msg = result.error === "misconfigured" ? "Server misconfigured" : "Send failed";
    return new Response(JSON.stringify({ error: msg }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};

export const config = { path: "/api/send-support-email" };
