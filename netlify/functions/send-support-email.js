import { verifyTurnstile } from "./_lib/turnstile.js";

// Escape every HTML special character. Do not use a partial substitution
// (e.g. only `<` / `>`) — `&`, `"`, `'`, `/` all matter for safe HTML output.
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\//g, "&#x2F;");
}

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

async function checkRateLimit(ip) {
  // Calls the SECURITY DEFINER RPC `check_anon_rate_limit` defined in
  // scripts/security/05-anon-rate-limit.sql. Default policy: 5 requests per
  // 15 minutes per (kind, ip). Failing open (returning true) on transport
  // errors keeps support-email working if Supabase is briefly unreachable.
  const url  = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return true;
  try {
    const res = await fetch(`${url}/rest/v1/rpc/check_anon_rate_limit`, {
      method: "POST",
      headers: {
        apikey: anon,
        Authorization: `Bearer ${anon}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_kind: "support_email", p_ip: ip || "" }),
    });
    if (!res.ok) return true;
    const ok = await res.json();
    return Boolean(ok);
  } catch {
    return true;
  }
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
  if (!(await checkRateLimit(ip))) {
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

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  const labelMap = { bug: "BUG", idea: "IDEA", help: "HELP" };
  const label = labelMap[type];
  const safeLabel = escapeHtml(label);
  const safeEmail = escapeHtml(cleanEmail || "anonymous");
  const safeAcct  = escapeHtml(cleanAcct  || "N/A");
  const safeMsg   = escapeHtml(message);
  const subject = `[${label}] ${message.slice(0, 80)}`;
  const badgeBg = type === "bug" ? "rgba(224,85,85,.15)" : type === "idea" ? "rgba(196,148,40,.15)" : "rgba(100,160,220,.15)";
  const badgeFg = type === "bug" ? "#e05555" : type === "idea" ? "#c49428" : "#64a0dc";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Aurisar Support — ${safeLabel}</title></head>
<body style="background:#0c0c0a;color:#d4cec4;font-family:Arial,sans-serif;margin:0;padding:32px 16px">
  <div style="max-width:560px;margin:0 auto">
    <div style="text-align:center;margin-bottom:24px">
      <h1 style="font-size:2rem;font-weight:900;letter-spacing:.18em;color:#c49428;margin:0">AURISAR</h1>
      <div style="font-size:.85rem;letter-spacing:.35em;color:#8a8478;text-transform:uppercase;margin-top:4px">Support</div>
    </div>
    <div style="background:rgba(45,42,36,.4);border:1px solid rgba(180,172,158,.08);border-radius:12px;padding:28px">
      <div style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:16px;background:${badgeBg};color:${badgeFg}">${safeLabel}</div>
      <table style="width:100%;border-collapse:collapse;font-size:.85rem;margin-bottom:20px">
        <tr><td style="color:#8a8478;padding:4px 0;width:110px">From</td><td style="color:#d4cec4">${safeEmail}</td></tr>
        <tr><td style="color:#8a8478;padding:4px 0">Account ID</td><td style="color:#d4cec4">${safeAcct}</td></tr>
      </table>
      <div style="border-top:1px solid rgba(180,172,158,.08);padding-top:16px;font-size:.9rem;color:#d4cec4;line-height:1.6;white-space:pre-wrap">${safeMsg}</div>
    </div>
    <div style="text-align:center;margin-top:20px;font-size:.65rem;color:#3a3834">
      Aurisar Games &middot; Submitted via aurisargames.com
    </div>
  </div>
</body>
</html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Aurisar Support <support@aurisargames.com>",
      to: ["support@aurisargames.com"],
      reply_to: cleanEmail && EMAIL_RE.test(cleanEmail) ? cleanEmail : undefined,
      subject,
      html,
    }),
  });

  if (!res.ok) {
    return new Response(JSON.stringify({ error: "Send failed" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};

export const config = { path: "/api/send-support-email" };
