import { verifyTurnstile } from "./_lib/turnstile.js";

// Browser callers must come from a known origin. Spoofable from curl, so this
// is defence-in-depth, not a primary control. Combined with strict body
// validation + per-IP rate limit (TODO: rate-limit RPC) it raises the cost
// enough to deter casual abuse.
const ALLOWED_ORIGINS = new Set([
  "https://aurisargames.com",
  "https://www.aurisargames.com",
  "https://aurisargames.netlify.app",
  "http://localhost:5173",
]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_TYPES = new Set(["bug", "idea"]);
const MAX_MESSAGE_LEN = 4000;
const MAX_FIELD_LEN = 200;
const MAX_TITLE_LEN = 80;

function denyOrigin(origin) {
  if (!origin) return false;
  return !ALLOWED_ORIGINS.has(origin);
}

async function checkRateLimit(ip) {
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
      body: JSON.stringify({ p_kind: "github_issue", p_ip: ip || "" }),
    });
    if (!res.ok) return true;
    const ok = await res.json();
    return Boolean(ok);
  } catch {
    return true;
  }
}

// GitHub Markdown is the rendering target. Backticks/HTML get rendered, so we
// neutralise the most abusable characters before interpolation.
function escapeMarkdown(str) {
  return String(str ?? "")
    .replace(/​|‌|‍|﻿/g, "") // strip zero-width chars
    .replace(/[`<>]/g, m => ({ "`": "\\`", "<": "&lt;", ">": "&gt;" }[m]));
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
  const cleanEmail = typeof email === "string" ? email.trim().slice(0, MAX_FIELD_LEN) : "";
  const cleanAcct  = typeof accountId === "string" ? accountId.trim().slice(0, MAX_FIELD_LEN) : "";
  if (cleanEmail && !EMAIL_RE.test(cleanEmail)) {
    return new Response(JSON.stringify({ error: "Invalid email" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  const label = type === "idea" ? "idea" : "bug";
  const title = `[${type.toUpperCase()}] ${message.slice(0, MAX_TITLE_LEN)}`;
  const issueBody = [
    `**Type:** ${escapeMarkdown(type)}`,
    `**Account ID:** ${escapeMarkdown(cleanAcct || "N/A")}`,
    "",
    escapeMarkdown(message),
  ].join("\n");

  const res = await fetch("https://api.github.com/repos/brandonla3/aurisar-app/issues", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title,
      body: issueBody,
      labels: [label],
      assignees: ["brandonla3"],
    }),
  });

  if (!res.ok) {
    return new Response(JSON.stringify({ error: "Issue creation failed" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
};

export const config = { path: "/api/create-github-issue" };
