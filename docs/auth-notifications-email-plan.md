# Auth, Notifications & Email — Fine-Tune & Overhaul Plan

> Program doc for the login/credentialing/notifications/email overhaul.
> Format follows `docs/world-design-plan.md`. Status: **approved, in execution**.

## Context

Aurisar's account layer is **barebones on the surface but surprisingly well-scaffolded underneath**, and the two halves are out of sync. Authentication is genuinely capable (Supabase email/password, passkeys, a full TOTP MFA lifecycle, phone-OTP as a factor, HIBP pwned-password checks, a hardened admin backend). But the *user-facing* promises are hollow: a Notification Preferences screen shows **7 toggles of which only 2 are wired** — the other 5 send nothing anywhere; there is **no notification system** beyond 3 copy-pasted toast implementations; email is 3 one-off Netlify functions with inline HTML and a **level-up email that was silently gutted** when its secret was removed; and MFA, despite being fully built, is **bypassable with a page refresh**.

The goal of this effort is to make what's already on screen *actually true*, then extend it into a real notification + email backbone — without boiling the ocean. The driving decision (below) is **"make the settings honest first."**

## Locked decisions

1. **Lead emphasis = make the settings honest.** Wire the 5 dead preference toggles to real senders, unify the toasts, enforce email verification — then expand. The notification/email spine ships first; auth hardening follows.
2. **Pre-launch** (no real users; preview/PIN-gated). Big-bang changes are fine. **No report-only AAL2 rollout needed** — but MFA is still done recovery-first, and account deletion + email verification are set up now because pre-launch is the right time.
3. **3D Realm identity security is OUT of scope.** The Supabase↔SpacetimeDB binding and server-authoritative XP go to the separate **Aurisar Realm rewrite** track, not here. This plan touches app auth, notifications, and email only.
4. **In-app + email now; web push later.** Build the outbox, in-app inbox/toasts, and the email projection. The schema reserves a slot for a web-push projection (service worker + `push_subscriptions`), but that is **deferred**.

## Design pillars

1. **One outbox, many projections.** An append-only `notifications` table is the single source of truth. In-app and email are *subscribers*; web push slots in later as a third subscriber, not a rewrite.
2. **One checkpoint.** Every outbound send passes a single server-side `should_deliver(user, event_type, channel)` gate that reads typed preference rows + a suppression list + rate caps. This is the mechanism that makes the 5 dead toggles real.
3. **Server-readable preferences.** Preferences move **out of the `profiles.data` jsonb blob** into typed rows the delivery worker can read per-key.
4. **At-least-once + idempotent delivery.** The email drain atomically claims rows and sends with an idempotency key; bounces/complaints feed suppression (the "returns desk"). Duplicate sends are the load-bearing risk and are designed against.
5. **Recovery before enforcement.** Never enable an auth gate without first proving the escape hatch (recovery codes + admin break-glass).
6. **Fail loud.** Config/env misconfiguration fails at boot, not silently against the production project.

## Verified current state (load-bearing facts)

- **MFA refresh-bypass is real.** The gate `checkAndHandleMfaChallenge()` (`src/App.jsx:1860`) returns `true` to intercept, but is called **only** from the password sign-in path (`src/App.jsx:1186`). The `getSession()` bootstrap (`src/App.jsx:843`) calls only `checkMfaStatus()` (display state) and goes straight to `setScreen("main")`. No RLS keys on `aal` anywhere in `scripts/security/*.sql`. Reload = full access at `aal1`.
- **5 of 7 preference toggles are dead.** Defaults at `src/data/constants.js:1150`; UI at `src/features/profile/ProfileTab.jsx:1744`; writer `toggleNotifPref` at `src/App.jsx:2063`. Only `friendExercise` (`src/App.jsx:2179`) and `reviewBattleStats` (`src/App.jsx:3771`) are ever read. Prefs live inside the `profiles.data` jsonb — not server-readable per key.
- **The killed email.** `notify_friend_level_up()` still fires but its send block is a no-op (`scripts/security/14-fix-level-up-trigger.sql:42`) since `get_resend_key()` was dropped in migration 12.
- **Realtime precedent to clone:** `friend_exercise_events` (table + RLS + `supabase_realtime` publication) at `scripts/security/02-rls-add-safe-views-and-rpcs.sql:101-152`, subscribed at `src/App.jsx:2168`.
- **Email transport that exists:** Resend via raw `fetch` in `netlify/functions/send-welcome-email.js`, `send-support-email.js`, `admin-send-invite.js` (inline templates, no shared layer, no tests). `RESEND_API_KEY` is a server env var.
- **Scheduling:** none exists. Cheapest path is **Netlify Scheduled Functions** (`schedule=` in `netlify.toml`, zero new infra). No `supabase/` dir exists; all schema is hand-applied SQL in `scripts/security/NN-*.sql`.
- **Invite tokens** are mailed (`netlify/functions/admin-send-invite.js:51`) but **never consumed** — no client reads `?invite=`.
- **Welcome email** only fires when Supabase email-confirmation is OFF (`src/App.jsx:1125-1140`); confirmed-email signups get nothing.
- **Committed anon key + live URL** with a **silent production fallback** in `src/utils/supabase.js`; `.env.example` is missing 12 of ~18 real vars.

---

## Batches

Build order follows the "settings honest first" lead: the spine (A–E) ships before auth hardening (F–G). **Batch F (MFA) must land before any real launch** even though it is sequenced after the spine.

### A. Preferences + outbox foundation — `M`
New migration `scripts/security/17-notifications.sql`:
- `notification_prefs(user_id, event_type, channel, enabled, PRIMARY KEY(user_id, event_type, channel))` — typed rows, RLS self-only. `channel ∈ {in_app, email, push}` (push rows allowed but unused now).
- `notifications` outbox: `(id bigserial, recipient_id uuid→auth.users, actor_id uuid, event_type text, payload jsonb, created_at, read_at, email_status text default 'pending')`. Copy the RLS + `supabase_realtime` publication block from `friend_exercise_events` almost verbatim. INSERT reserved for SECURITY DEFINER code/triggers.
- `notification_suppressions(email text, reason text, created_at)`.
- `should_deliver(recipient_id, event_type, channel)` SECURITY DEFINER — reads prefs + suppressions + rate caps + (for `email`) `email_confirmed_at`.

Client: replace the jsonb-blob prefs with a small `useNotificationPrefs` hook backed by `notification_prefs`; rewire `toggleNotifPref` and the ProfileTab UI. Pre-launch → **drop** the `profiles.data.notificationPrefs` key (defaults seed from the hook); no backfill needed at scale.

### B. In-app projection — unify toasts + notification inbox — `M`
- Extract **one** notification/toast module with a queue and `role="alert"` for errors, retiring the app-level duplicates (`src/App.jsx:1045`, `src/App.jsx:1056`; `src/components/AdminPage.jsx:395`). *(The world's own toast at `WorldGame.jsx:246` stays — world is out of scope.)*
- Subscribe to `notifications` realtime INSERT (clone the `src/App.jsx:2168` pattern) → route into the unified toast.
- **Notification inbox / bell:** paginated SELECT on `notifications`, unread badge from `read_at`, mark-read — reusing the existing unread-badge pattern. Closes the "realtime-only, offline users miss everything" gap.

### C. Email projection — drain + shared templates + revive the dead send — `L`
- **Netlify Scheduled Function** `netlify/functions/notifications-drain.js` (`schedule=` in `netlify.toml`). **Atomic claim** (`UPDATE … SET email_status='sending' WHERE email_status='pending' … RETURNING`, or `SELECT … FOR UPDATE SKIP LOCKED`) → `should_deliver` → Resend send **with a stable idempotency key** → stamp `sent`. At-least-once + idempotent.
- **Shared template layer** `netlify/functions/_lib/emailTemplate.js` (layout + branding); refactor the 3 inline templates onto it.
- **Revive the level-up email the clean way:** the trigger fans one `notifications` row per accepted friend. **Postgres never calls Resend — the drain does**, so the removed `get_resend_key()` Vault-secret follow-up is sidestepped entirely.
- **Returns desk:** `netlify/functions/resend-webhook.js` consumes Resend bounce/complaint events → `notification_suppressions`.

### D. Wire the checkpoint = the 5 dead toggles become real — `M`
- `sharedWorkout`, `friendLevelUp`, `friendRequest`, `friendAccepted`, `messageReceived` gain real senders — DB triggers on `friend_requests` / `shared_items` / `messages` insert outbox rows (migration 17 §6). `message_received` is burst-guarded: no new row while an unread one from the same sender exists, and message contents never enter the payload.
- `friendExercise` + `reviewBattleStats` prefs migrated to typed rows in Batch A. **Design deviation, deliberate:** `friend_exercise_events` keeps its dedicated table (one row visible to all friends via RLS) rather than fanning one outbox row per friend — it is the highest-volume event class and per-recipient fan-out would explode row counts for zero UX gain. `review_battle_stats` is a purely local prompt; pref rows only.
- **Enforce email verification:** `should_deliver(channel='email')` checks `email_confirmed_at`, making the "✓ Verified" badge and the "Email notifications require a verified email" copy finally true.

### E. Reminder producer (bidirectional scheduler) — `M`
- A nightly scan inserts `workout_reminder` / `streak_at_risk` rows → through the checkpoint → all projections.
- **Quiet hours + frequency caps** land as additive `should_deliver` rules.

### F. Close the MFA refresh-bypass — recovery-first — `L` *(before launch)*
- **Step 0 — prove the escape hatch:** app-managed recovery codes are bcrypt in our own table and **do not mint an `aal2` JWT**. So `use_mfa_recovery_code` must **also unenroll the stranded factor server-side**, landing the user at a clean, RLS-allowed `aal1`. Verify a recovery code clears the gate *before* adding the gate.
- Extract `checkAndHandleMfaChallenge()` → shared `enforceAal2()`; call it as the **first await** in all three entry paths — bootstrap, `onAuthStateChange` signed-in, and password — before `setScreen('main')`.
- `scripts/security/18-aal2-rls.sql`: require `aal2` **only for sensitive tables/RPCs** (profiles PII, messaging, admin, `avatar_config`) with `(auth.jwt()->>'aal')='aal2' OR user has no verified factor`. Gameplay tables are **not** gated.
- **Reset can't be a bypass:** `PASSWORD_RECOVERY` only sets a password, never touches factors; disabling/replacing a factor requires step-up with an existing factor or a recovery code.
- **Trusted device:** after an `aal2` verify, a Netlify fn mints an HMAC-signed device cookie so reloads skip the challenge for N days.
- **Session-family revocation:** on password/factor/email change, `supabase.auth.admin.signOut(userId, {scope:'global'})`.

### G. Account lifecycle + credential hygiene — `M`
- **Self-service account deletion:** ProfileTab → Security UI → `netlify/functions/account-delete.js` (self-scoped, reuses the `_lib/adminAuth.js` Bearer pattern, requires reauth/step-up).
- **Out-of-band credential-change alert:** on credential change / new-device login, insert a security `notifications` row **and** email the prior address a signed "freeze my account" link that sets `profiles.disabled_at`.
- **Consume invite tokens:** client reads `?invite=` on load, validates against the `invites` table, binds on signup.
- **Welcome email fix:** emit it as a `notifications` row on **both** signup branches so the drain sends it uniformly.
- **Fail loud on config:** `src/utils/supabase.js` throws on missing/placeholder env instead of the silent prod fallback; complete `.env.example`.
- **Harden `lookup_email_by_private_id`:** track it in `scripts/security/`, constant-time / constant-response, stop echoing raw errors to the UI.
- **"Remain logged in 30 days":** replace the broken `beforeunload`+`signOut` hack with real session-persistence config (or make the copy honest).

### H. Tests + verification — `M`
- **Auth:** `enforceAal2` intercepts on all three entry paths; recovery-code-unenrolls-factor seam; reset never downgrades MFA.
- **Notifications:** `should_deliver` honors each pref + suppression + email-verification; drain atomic-claim is idempotent; realtime projection fires.
- **Email:** template rendering; bounce webhook → suppression row.

---

## Explicitly out of scope (cut list)

- **3D Realm / SpacetimeDB identity binding + server-authoritative XP** → Aurisar Realm rewrite track.
- **Web push / service worker / PWA push** — schema leaves a `push` channel slot; the projection is a later round.
- **Full GDPR Art.30 RoPA + special-category data store** — disproportionate pre-launch.
- **DIY refresh-token rotation** — Supabase already rotates and detects reuse.
- **Passwordless-only login** — keep passkeys as an *option*.
- **Router / statechart refactor of App.jsx** — only the minimal auth extraction in Batch F.

## Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Email drain double-sends (poller + concurrency/partial failure) | High | Atomic claim + stable idempotency key to Resend + suppression on complaint. The piece with no repo precedent — build & test first. |
| MFA enforcement locks out a recovered user (RLS keys on `aal2`, recovery codes don't mint `aal2`) | High | Recovery code **unenrolls the stranded factor** → clean `aal1`; RLS predicate explicitly allows `aal1`-with-no-verified-factor; scope `aal2` to sensitive tables only. |
| A send path still reads the old jsonb prefs after migration | Med | Grep for `notificationPrefs` readers; delete the jsonb key; checkpoint is the *only* gate. |
| Large edits inside one 6,688-line file introduce regressions | Med | Extract `enforceAal2` and the prefs/notification hooks into their own modules; lean on Batch H tests. |

## Verification (end-to-end)

1. **Dev preview**: create an account → confirm email → open Notification Preferences → toggle a pref off.
2. **Spine:** trigger a friend level-up → confirm the in-app toast + inbox row appear via realtime; confirm the *email* only sends when that pref is on **and** the address is verified.
3. **Drain idempotency:** enqueue a row, run the drain twice → exactly one email.
4. **Returns desk:** simulate a bounce webhook → confirm a suppression row and that the next send is skipped.
5. **MFA gate:** enrol TOTP → **reload the page** → confirm you're challenged; enter a recovery code → confirm clean `aal1` and profile still readable.
6. **Deletion:** self-service delete → Supabase user + profile gone, re-login fails.
7. `npm test` green, including the new auth + notification suites.

## Critical files

- **Schema:** `scripts/security/17-notifications.sql`, `scripts/security/18-aal2-rls.sql` (clone-source `scripts/security/02-rls-add-safe-views-and-rpcs.sql`).
- **Server:** `netlify/functions/notifications-drain.js`, `resend-webhook.js`, `account-delete.js`, `_lib/emailTemplate.js`; `netlify.toml` (`schedule=`).
- **Client:** `src/App.jsx`, `src/features/profile/ProfileTab.jsx`, `src/data/constants.js`, `src/utils/supabase.js`, `.env.example`. New: `src/state/useNotificationPrefs.js`, shared notification/inbox module.
