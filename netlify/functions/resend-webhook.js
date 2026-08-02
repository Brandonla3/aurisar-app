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
import { Webhook } from "svix";

const SUPPRESS_EVENTS = {
  "email.bounced": "bounce",
  "email.complained": "complaint",
};

// The CRYPTO comes from Svix's own library; the TIMESTAMP POLICY is ours.
//
// Why not just call `webhook.verify()`: it hardcodes a 5-minute tolerance with
// no override (`verify()` takes only payload+headers). Delegating wholesale
// silently reverted the retry fix — measured against svix@1.99, a correctly
// signed payload 6 minutes old is rejected with "Message timestamp too old".
// Svix retries are byte-identical redeliveries (same id, timestamp and
// signature) and its backoff runs to hours, so a 5-minute window rejects every
// retry after the first and an event can never drain.
//
// So `sign()` is used as the canonical signing oracle — the scheme, encoding
// and `v1,<base64>` framing are the library's, not remembered by hand — while
// the replay window stays wide enough for retries to land. Replay protection
// is not weakened much by that: the signature still covers id+timestamp+body,
// and the suppression insert is idempotent, so a replayed event is a no-op.
const REPLAY_TOLERANCE_S = 60 * 60 * 24;

// Resend documents `svix-*`. The `webhook-*` family is the Standard Webhooks
// spec Svix also authored; accepting both is defensive coverage, not a claim
// about which Resend actually sends.
const HEADER_FAMILIES = ["svix", "webhook"];

// Env vars pick up damage on the way in. A secret pasted into a web form
// commonly arrives with a trailing newline, a leading/trailing space, or
// wrapping quotes — none visible in the UI. `whsec_` is stripped before
// base64-decoding, so any of those makes the remainder invalid base64 and the
// library throws "Base64Coder: incorrect characters for decoding" — which is
// exactly what production returned once this handler started reporting why.
export function normaliseSecret(raw) {
  return String(raw ?? "")
    .trim()
    .replace(/^['"]+|['"]+$/g, "")
    .trim();
}

/**
 * Describe a secret WITHOUT leaking it, so a misconfiguration is diagnosable
 * from a log line. Never returns any part of the value itself.
 */
export function describeSecret(raw) {
  const s = normaliseSecret(raw);
  const body = s.replace(/^whsec_/, "");
  return [
    `len=${s.length}`,
    `prefix=${s.startsWith("whsec_")}`,
    `base64=${/^[A-Za-z0-9+/]*={0,2}$/.test(body)}`,
    `trimmed=${s.length !== String(raw ?? "").length}`,
  ].join(" ");
}

export function verifyWebhook(rawSecret, headers, payload, nowMs = Date.now()) {
  const secret = normaliseSecret(rawSecret);
  const h = {};
  for (const [k, v] of headers.entries()) h[k.toLowerCase()] = v;
  const headerNames = Object.keys(h);

  const family = HEADER_FAMILIES.find(
    p => h[`${p}-id`] && h[`${p}-timestamp`] && h[`${p}-signature`]
  );
  if (!family) return { ok: false, reason: "missing_signing_headers", headerNames };

  const id = h[`${family}-id`];
  const timestamp = h[`${family}-timestamp`];
  const signatures = h[`${family}-signature`];

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad_timestamp", headerNames, family };
  const ageS = Math.abs(nowMs / 1000 - ts);
  if (ageS > REPLAY_TOLERANCE_S) {
    return { ok: false, reason: `stale_timestamp_${Math.round(ageS)}s`, headerNames, family };
  }

  let expected;
  try {
    // Library-computed, so the scheme cannot drift from the spec again.
    expected = new Webhook(secret).sign(id, new Date(ts * 1000), payload);
  } catch (e) {
    // Bad secret shape. The description is safe to log and return: it reports
    // length and character-class only, never any part of the value.
    return {
      ok: false,
      reason: `bad_secret [${describeSecret(rawSecret)}]: ${e.message}`,
      headerNames,
      family,
    };
  }
  const expectedSig = expected.startsWith("v1,") ? expected.slice(3) : expected;

  // The header may carry several space-separated entries during key rotation.
  const matched = signatures.split(" ").some(part => {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) return false;
    const a = Buffer.from(sig, "base64");
    const b = Buffer.from(expectedSig, "base64");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });

  return matched
    ? { ok: true, headerNames, family }
    : { ok: false, reason: "signature_mismatch", headerNames, family };
}

const verify = verifyWebhook;

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
