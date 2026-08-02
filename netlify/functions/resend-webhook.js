/**
 * POST /api/resend-webhook — the "returns desk".
 *
 * Resend delivery events (signed with Svix). Hard bounces and spam
 * complaints insert a row into notification_suppressions, which
 * should_deliver() consults before every future send — a dead or hostile
 * address is never mailed again.
 *
 * Env: RESEND_WEBHOOK_SECRET (whsec_… from the Resend webhook config),
 *      SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */

import crypto from "node:crypto";

const SUPPRESS_EVENTS = {
  "email.bounced": "bounce",
  "email.complained": "complaint",
};

// Svix retries reuse the ORIGINAL svix-id/timestamp/signature — a retry is a
// byte-identical redelivery, not a re-signed message. Svix's own backoff runs
// to hours, so a 5-minute replay window rejects every retry after the first
// and the event sticks in "Attempting" forever. Replay protection here is
// cheap anyway: the signature covers id+timestamp+body, and the suppression
// insert is idempotent (on_conflict merge-duplicates), so replaying a captured
// event is a no-op. A wide window that lets retries succeed is the right
// trade.
const REPLAY_TOLERANCE_S = 60 * 60 * 24;

// Svix signature scheme: HMAC-SHA256 over `${id}.${timestamp}.${payload}`
// with the base64 secret (after the whsec_ prefix). The svix-signature
// header carries space-separated `v1,<base64>` entries.
//
// Returns a REASON rather than a boolean. Collapsing "no headers", "stale
// timestamp" and "signature mismatch" into one opaque 401 is exactly the kind
// of illegible failure that costs hours: the sender's dashboard shows a red
// 401 and nothing about which check failed.
function verifySvix(secret, headers, payload) {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");
  if (!id || !timestamp || !signatures) return "missing_svix_headers";

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return "bad_timestamp";
  const ageS = Math.abs(Date.now() / 1000 - ts);
  if (ageS > REPLAY_TOLERANCE_S) return `stale_timestamp_${Math.round(ageS)}s`;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto
    .createHmac("sha256", secretBytes)
    .update(`${id}.${timestamp}.${payload}`)
    .digest("base64");

  const matched = signatures.split(" ").some(part => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });

  return matched ? null : "signature_mismatch";
}

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret || !url || !key) {
    console.error("[resend-webhook] missing env — refusing to process");
    return new Response("misconfigured", { status: 500 });
  }

  const payload = await req.text();
  const failure = verifySvix(secret, req.headers, payload);
  if (failure) {
    // The reason goes in the BODY, which the sender's dashboard shows next to
    // the failed attempt — so "why is this webhook stuck" is answerable from
    // Resend's UI without access to function logs.
    console.error(
      `[resend-webhook] rejected: ${failure} (svix-id=${req.headers.get("svix-id") || "none"})`
    );
    return new Response(`invalid signature: ${failure}`, { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return new Response("invalid json", { status: 400 });
  }

  const reason = SUPPRESS_EVENTS[event?.type];
  if (!reason) {
    // Delivery/open/click events — acknowledged, not stored.
    return new Response("ignored", { status: 200 });
  }

  const to = event?.data?.to;
  const emails = (Array.isArray(to) ? to : [to]).filter(
    e => typeof e === "string" && e.includes("@")
  );
  if (emails.length === 0) return new Response("no recipient", { status: 200 });

  for (const email of emails) {
    const res = await fetch(
      `${url}/rest/v1/notification_suppressions?on_conflict=email`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify({ email: email.toLowerCase(), reason }),
      }
    );
    if (!res.ok) {
      console.error("[resend-webhook] suppression insert failed:", res.status);
      // 500 → Resend retries the webhook later.
      return new Response("store failed", { status: 500 });
    }
    console.log(`[resend-webhook] suppressed ${email} (${reason})`);
  }

  return new Response("ok", { status: 200 });
};

export const config = { path: "/api/resend-webhook" };
