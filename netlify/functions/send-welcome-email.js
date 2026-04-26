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

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Welcome to Aurisar Fitness</title></head>
<body style="background:#0c0c0a;color:#d4cec4;font-family:Arial,sans-serif;margin:0;padding:32px 16px">
  <div style="max-width:480px;margin:0 auto">
    <div style="text-align:center;margin-bottom:28px">
      <h1 style="font-size:2rem;font-weight:900;letter-spacing:.18em;color:#c49428;margin:0">AURISAR</h1>
      <div style="font-size:.85rem;letter-spacing:.35em;color:#8a8478;text-transform:uppercase;margin-top:4px">Fitness</div>
    </div>
    <div style="background:rgba(45,42,36,.4);border:1px solid rgba(180,172,158,.08);border-radius:12px;padding:28px">
      <h2 style="color:#d4cec4;font-size:1.2rem;margin:0 0 12px">Welcome, Warrior.</h2>
      <p style="color:#8a8478;font-size:.9rem;line-height:1.6;margin:0 0 16px">Your account has been forged. The journey to elite fitness begins now.</p>
      <p style="color:#8a8478;font-size:.9rem;line-height:1.6;margin:0 0 24px">Complete your onboarding to unlock your warrior class, earn your first XP, and claim your place.</p>
      <div style="text-align:center">
        <a href="https://aurisargames.com" style="display:inline-block;padding:12px 32px;background:rgba(196,148,40,.15);color:#c49428;border:1px solid rgba(196,148,40,.25);border-radius:8px;text-decoration:none;font-size:.78rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase">Enter the Realm &rarr;</a>
      </div>
    </div>
    <div style="text-align:center;margin-top:20px;font-size:.65rem;color:#3a3834">
      Aurisar Games &middot; You&apos;re receiving this because you created an account at aurisargames.com
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
      from: "Aurisar Fitness <welcome@aurisargames.com>",
      to: [email],
      subject: "Welcome to Aurisar Fitness — Your Journey Begins",
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

export const config = { path: "/api/send-welcome-email" };
