import { renderNotificationEmail } from "./_lib/notificationEmails.js";

// Allowed origins for browser-driven calls. Netlify Function -> Origin header
// is set by the browser; spoofable from curl, so this is defence-in-depth, not
// a primary control. The primary control is the Bearer-token check below.
const ALLOWED_ORIGINS = new Set([
  "https://aurisargames.com",
  "https://www.aurisargames.com",
  "https://aurisargames.netlify.app",
  "http://localhost:5173",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function denyOrigin(origin) {
  if (!origin) return false; // server-to-server / native client → skip browser-only check
  return !ALLOWED_ORIGINS.has(origin);
}

async function fetchSupabaseUser(accessToken) {
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon || !accessToken) return null;
  const res = await fetch(`${url}/auth/v1/user`, {
    headers: {
      apikey: anon,
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) return null;
  return res.json();
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

  // Require a valid Supabase access token AND verify the recipient email
  // matches the authenticated user. Without this check, anyone can spam any
  // address through the Resend account (cost + brand-reputation risk).
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }
  const user = await fetchSupabaseUser(token);
  if (!user || !user.email) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json" },
    });
  }

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  if (!email || !EMAIL_RE.test(email)) {
    return new Response(JSON.stringify({ error: "Invalid email" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }
  // The submitted email MUST match the authenticated session — prevents using
  // this endpoint as an open relay.
  if (email.toLowerCase() !== String(user.email).toLowerCase()) {
    return new Response(JSON.stringify({ error: "Email mismatch" }), {
      status: 403, headers: { "Content-Type": "application/json" },
    });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  // Copy + layout live in _lib/notificationEmails.js (the 'welcome' renderer)
  // so the drain-sent and directly-sent welcome emails are pixel-identical.
  const rendered = renderNotificationEmail({ event_type: "welcome", payload: {} });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Aurisar Fitness <welcome@aurisargames.com>",
      to: [email],
      subject: rendered.subject,
      html: rendered.html,
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

export const config = { path: "/api/send-welcome-email" };
