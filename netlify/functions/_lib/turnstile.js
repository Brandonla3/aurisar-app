// Cloudflare Turnstile token verification.
//
// Used by anonymous endpoints (/api/send-support-email, /api/create-github-issue)
// to add bot defence on top of Origin pinning + per-IP rate limiting.
//
// Graceful degradation: if `TURNSTILE_SECRET_KEY` is not set in Netlify env
// vars, verification is SKIPPED — the function continues to accept requests.
// This lets the code ship before Cloudflare is configured. Once you sign up
// at https://dash.cloudflare.com/?to=/:account/turnstile and add the secret
// key, verification activates with no further code change.
//
// Setup:
//   1. Cloudflare Dashboard → Turnstile → Add site
//        - Domain: aurisargames.com (and aurisargames.netlify.app if you want
//          deploy previews protected too)
//        - Widget mode: Managed (recommended) or Invisible
//   2. Copy the **Site Key** → set as build-time env var VITE_TURNSTILE_SITE_KEY
//      in Netlify (so the React widget can render it client-side).
//   3. Copy the **Secret Key** → set as runtime env var TURNSTILE_SECRET_KEY
//      in Netlify (so this verifier can call siteverify).
//   4. Redeploy. From the next request onward, requests without a valid token
//      will receive 403.
//
// API: https://developers.cloudflare.com/turnstile/get-started/server-side-validation/

export async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // No secret configured → skip (fail-open). Document this clearly in the
    // PR description so it's not forgotten before going to prod.
    return { ok: true, skipped: true };
  }
  if (!token || typeof token !== "string") {
    return { ok: false, error: "missing-token" };
  }

  try {
    const body = new URLSearchParams();
    body.append("secret", secret);
    body.append("response", token);
    if (ip) body.append("remoteip", ip);

    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      // Cloudflare unreachable or returned 5xx — fail closed since we already
      // know secret is configured (so we expect this to work).
      return { ok: false, error: "siteverify-unreachable" };
    }
    const json = await res.json();
    if (json.success === true) return { ok: true };
    return { ok: false, error: "verification-failed", codes: json["error-codes"] || [] };
  } catch {
    return { ok: false, error: "siteverify-threw" };
  }
}
