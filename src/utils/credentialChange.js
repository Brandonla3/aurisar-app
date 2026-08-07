/**
 * Credential-change support: proving it's really you before the password moves.
 *
 * Supabase has two dashboard settings the app previously could not satisfy:
 *
 *   "Require current password when changing password"
 *       -> updateUser({ password, current_password })
 *   "Secure password change" (require reauthentication)
 *       -> reauthenticate() emails a nonce, then
 *          updateUser({ password, nonce })
 *
 * The app sent neither, so turning the first on would have broken EVERY
 * password change and the second would have broken them intermittently
 * (a session counts as "recent" for 24h, so it passes right after login and
 * fails the next day) — both surfacing as the same dead-end
 * "Could not update password" toast.
 *
 * The logic lives here rather than in App.jsx so the branch that decides
 * "which proof is missing?" is testable without React, in keeping with
 * passwordPolicy.js and mfaGate.js.
 */

/**
 * A password reset is exactly the case where the user CANNOT know their
 * current password — that's why they're resetting it. Asking for it would
 * make the reset link useless.
 *
 * The recovery session is freshly minted, which is also why Supabase's
 * reauthentication rule ("recently logged in") is satisfied without a nonce.
 */
export function needsCurrentPassword({ isRecovery }) {
  return !isRecovery;
}

/**
 * Build the updateUser() payload, omitting anything absent.
 *
 * Sending `current_password: ""` when the setting is OFF risks a spurious
 * rejection, and sending `nonce: ""` is never meaningful — so empty values
 * are dropped rather than passed through.
 */
export function buildPasswordUpdate({ password, currentPassword, nonce }) {
  const payload = { password };
  const cp = typeof currentPassword === "string" ? currentPassword : "";
  const n = typeof nonce === "string" ? nonce.trim() : "";
  if (cp) payload.current_password = cp;
  if (n) payload.nonce = n;
  return payload;
}

// Matched against BOTH error.code and error.message. The code names are
// GoTrue's; the message fragments are the belt to that braces, because a
// misclassification here is what turns a fixable prompt into a dead end.
//
// ORDER MATTERS for the message pass: `bad_nonce` comes first because its
// patterns are strictly narrower than `reauth_required`'s. A real
// invalid-nonce error reads "Nonce has expired", which contains "nonce" and
// would otherwise be swallowed by the broader rule — leaving the stale nonce
// in place and telling the user a fresh code was sent when the problem was
// the one they already had.
const SIGNATURES = [
  {
    kind: "bad_nonce",
    codes: ["reauthentication_not_valid", "invalid_nonce"],
    patterns: [/nonce.*(invalid|expired|incorrect|not valid)/i, /(invalid|expired|incorrect).*nonce/i],
    msg: "That code wasn't right, or it expired. Send a new one and try again.",
  },
  {
    kind: "reauth_required",
    codes: ["reauthentication_needed", "reauthentication_required"],
    patterns: [/nonce/i, /reauthenticat/i],
    msg: "For your security, confirm it's you. We've emailed you a 6-digit code — enter it below and save again.",
  },
  {
    kind: "wrong_current_password",
    codes: ["invalid_credentials"],
    patterns: [/current password/i, /invalid login credentials/i],
    msg: "That current password isn't right.",
  },
  {
    kind: "same_password",
    codes: ["same_password"],
    patterns: [/should be different from the old password/i, /same.*password/i],
    msg: "That's already your password. Choose a different one.",
  },
  {
    kind: "weak_password",
    codes: ["weak_password"],
    patterns: [/weak.?password/i, /password.*too short/i],
    msg: "That password doesn't meet the minimum requirements.",
  },
];

/**
 * Turn a Supabase error into { kind, msg } the UI can act on.
 *
 * `reauth_required` is the one that changes what's rendered — it reveals the
 * code field. Everything else is a message. `unknown` is deliberately not a
 * dead end: the copy tells the user the code path exists, because the exact
 * error strings are not something this app controls or can pin in a test
 * against a live server.
 */
export function classifyPasswordUpdateError(error) {
  if (!error) return { kind: "ok", msg: "" };
  const code = String(error.code ?? "").toLowerCase();
  const message = String(error.message ?? "");

  // Two passes, not one interleaved loop. Interleaving let an earlier
  // signature's broad MESSAGE pattern beat a later signature's exact CODE
  // match: `{code:"reauthentication_not_valid", message:"Nonce has expired"}`
  // classified as reauth_required rather than bad_nonce. An exact code is the
  // strongest signal available and must win over any message heuristic.
  for (const sig of SIGNATURES) {
    if (code && sig.codes.includes(code)) return { kind: sig.kind, msg: sig.msg };
  }
  for (const sig of SIGNATURES) {
    if (sig.patterns.some(p => p.test(message))) return { kind: sig.kind, msg: sig.msg };
  }

  return {
    kind: "unknown",
    msg: "Could not update password. If this keeps happening, use “Email me a code” below to confirm it's you, then try again.",
  };
}
