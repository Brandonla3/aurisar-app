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

import { Webhook } from "svix";

const SUPPRESS_EVENTS = {
  "email.bounced": "bounce",
  "email.complained": "complaint",
};

// Verification is delegated to Svix's OWN library rather than hand-rolled.
//
// The previous implementation was written from memory of the signing scheme
// and never once verified a real request. Its unit tests signed with the same
// function they verified with, so they passed regardless of whether the scheme
// was right — a doorman who only ever proved he could turn away strangers.
// Meanwhile every genuine Resend delivery was rejected and retried forever.
//
// The library is the executable spec: it accepts BOTH the `svix-*` and the
// Standard Webhooks `webhook-*` header families (verified locally against
// svix@1.99 — a hand-rolled reader looking only for `svix-*` fails outright
// if the sender emits the other set), handles multiple space-separated
// signatures for key rotation, and does the constant-time compare.
function verify(secret, headers, payload) {
  // svix wants a plain object; Headers keys are already lowercased.
  const h = {};
  for (const [k, v] of headers.entries()) h[k] = v;
  try {
    new Webhook(secret).verify(payload, h);
    return { ok: true, headerNames: Object.keys(h) };
  } catch (e) {
    return { ok: false, reason: e.message || String(e), headerNames: Object.keys(h) };
  }
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
  const result = verify(secret, req.headers, payload);
  if (!result.ok) {
    // Log the header NAMES we actually received (never the values). Not
    // knowing which names arrived is what made this failure take hours to
    // diagnose: the endpoint could only say "invalid signature", and no probe
    // from our side could reveal what the real sender was sending.
    const signingHeaders = result.headerNames
      .filter(n => n.startsWith("svix-") || n.startsWith("webhook-"))
      .join(",") || "NONE";
    console.error(
      `[resend-webhook] rejected: ${result.reason} | signing headers present: ${signingHeaders}`
    );
    // The reason also goes in the BODY, which the sender's dashboard shows
    // next to the failed attempt — diagnosable without function-log access.
    return new Response(
      `invalid signature: ${result.reason} (signing headers: ${signingHeaders})`,
      { status: 401 }
    );
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
