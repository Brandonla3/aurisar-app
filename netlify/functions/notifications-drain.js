/**
 * Scheduled email projection of the notifications outbox.
 *
 * Every 5 minutes: atomically claim a batch of email_status='pending' rows
 * (claim_notification_emails — FOR UPDATE SKIP LOCKED, so overlapping runs
 * never double-claim), pass each through the should_deliver checkpoint
 * (prefs + suppressions + verified email + rate cap, all server-side), and
 * send the survivors through Resend with a stable per-row idempotency key.
 *
 * Delivery semantics: at-least-once + idempotent.
 *   - 'skip'  → email_status='skipped' (pref off / suppressed / no template)
 *   - 'defer' → back to 'pending' (unverified email, rate-capped) unless the
 *               row is older than 7 days, then 'skipped' for good
 *   - Resend 5xx / network error → back to 'pending' (retry next run)
 *   - Resend 4xx → 'failed' (won't be retried; needs investigation)
 */

import { renderNotificationEmail, fromAddressFor } from "./_lib/notificationEmails.js";
import { pgError } from "./_lib/pgErrors.js";

const BATCH_SIZE = 25;
const DEFER_GIVE_UP_MS = 7 * 24 * 60 * 60 * 1000;

// One greppable line for every drift, wherever it surfaces. Deliberately does
// NOT name a migration file: the same codes fire for a genuinely missing object
// AND for an argument-name mismatch against an existing function, and pointing
// at the wrong fix wastes more time than pointing at none.
function driftMessage(e) {
  return (
    `[notifications-drain] SCHEMA_DRIFT rpc=${e.rpc || "?"} code=${e.code} — ` +
    `the database does not have what this deploy asked for. Check that the ` +
    `scripts/security/ migrations are applied and that the call signature ` +
    `matches. ${e.hint || ""}`
  ).trim();
}

function svc() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url, key };
}

// db-contract: dynamic(claim_notification_emails, should_deliver_email)
async function rpc(s, fn, args) {
  const res = await fetch(`${s.url}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: {
      apikey: s.key,
      Authorization: `Bearer ${s.key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    // Keep the PostgREST body's code/hint on the Error so callers can tell an
    // unapplied migration apart from a transient blip.
    const err = pgError(res, await res.text().catch(() => ""), `rpc ${fn}`);
    err.rpc = fn;
    throw err;
  }
  return res.json();
}

async function finalize(s, id, fields) {
  const res = await fetch(`${s.url}/rest/v1/notifications?id=eq.${id}`, {
    method: "PATCH",
    headers: {
      apikey: s.key,
      Authorization: `Bearer ${s.key}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(fields),
  });
  if (!res.ok) {
    console.error(`[notifications-drain] finalize ${id} failed:`, res.status);
  }
}

// Hand back rows this run claimed but will not process, so an aborted batch
// isn't stuck in 'sending' until the 15-minute stale-claim sweep picks it up.
async function releaseClaimed(s, rows, fromId) {
  const start = rows.findIndex(r => r.id === fromId);
  const rest = start === -1 ? [] : rows.slice(start + 1);
  for (const r of rest) {
    await finalize(s, r.id, { email_status: "pending", email_claimed_at: null });
  }
  if (rest.length) {
    console.error(`[notifications-drain] released ${rest.length} unclaimed row(s) after drift`);
  }
}

export default async () => {
  const s = svc();
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!s || !RESEND_API_KEY) {
    console.error(
      "[notifications-drain] missing env (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / RESEND_API_KEY) — refusing to run"
    );
    return new Response("misconfigured", { status: 500 });
  }

  let rows;
  try {
    rows = await rpc(s, "claim_notification_emails", { p_batch: BATCH_SIZE });
  } catch (e) {
    if (e.schemaDrift) {
      console.error(driftMessage(e));
      return new Response("schema drift", { status: 503 });
    }
    console.error("[notifications-drain] claim failed (transient):", e.message);
    return new Response("claim failed", { status: 500 });
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return new Response("nothing to do", { status: 200 });
  }

  let sent = 0, skipped = 0, deferred = 0, failed = 0;

  for (const row of rows) {
    try {
      const [check] = await rpc(s, "should_deliver_email", {
        p_recipient: row.recipient_id,
        p_event_type: row.event_type,
      });
      const verdict = check?.verdict || "skip";

      if (verdict === "defer") {
        const age = Date.now() - new Date(row.created_at).getTime();
        if (age > DEFER_GIVE_UP_MS) {
          await finalize(s, row.id, { email_status: "skipped" });
          skipped++;
        } else {
          await finalize(s, row.id, { email_status: "pending", email_claimed_at: null });
          deferred++;
        }
        continue;
      }
      if (verdict !== "send" || !check?.email) {
        await finalize(s, row.id, { email_status: "skipped" });
        skipped++;
        continue;
      }

      const rendered = renderNotificationEmail(row);
      if (!rendered) {
        // In-app-only event type — nothing to email.
        await finalize(s, row.id, { email_status: "skipped" });
        skipped++;
        continue;
      }

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${RESEND_API_KEY}`,
          "Content-Type": "application/json",
          // Stable per-row key: a retried/reclaimed row can never produce a
          // second email even if the 'sent' stamp below is lost mid-crash.
          "Idempotency-Key": `notification/${row.id}`,
        },
        body: JSON.stringify({
          from: fromAddressFor(row.event_type),
          to: [check.email],
          subject: rendered.subject,
          html: rendered.html,
        }),
      });

      if (res.ok) {
        await finalize(s, row.id, {
          email_status: "sent",
          email_sent_at: new Date().toISOString(),
        });
        sent++;
      } else if (res.status >= 500 || res.status === 429) {
        await finalize(s, row.id, { email_status: "pending", email_claimed_at: null });
        deferred++;
      } else {
        console.error(
          `[notifications-drain] Resend 4xx for row ${row.id}:`,
          res.status,
          await res.text().catch(() => "")
        );
        await finalize(s, row.id, { email_status: "failed" });
        failed++;
      }
    } catch (e) {
      // Drift on the per-row RPC (should_deliver_email) is just as permanent as
      // drift on the claim, and will hit every remaining row identically.
      // Treating it as an ordinary row error re-queued the whole batch and
      // repeated the same failure every 5 minutes with no SCHEMA_DRIFT line —
      // the exact silent-degradation this classification exists to end.
      if (e.schemaDrift) {
        console.error(driftMessage(e));
        await finalize(s, row.id, { email_status: "pending", email_claimed_at: null });
        await releaseClaimed(s, rows, row.id);
        return new Response("schema drift", { status: 503 });
      }
      console.error(`[notifications-drain] row ${row.id} threw (transient):`, e.message);
      await finalize(s, row.id, { email_status: "pending", email_claimed_at: null });
      deferred++;
    }
  }

  console.log(
    `[notifications-drain] batch=${rows.length} sent=${sent} skipped=${skipped} deferred=${deferred} failed=${failed}`
  );
  return new Response("ok", { status: 200 });
};

export const config = { schedule: "*/5 * * * *" };
