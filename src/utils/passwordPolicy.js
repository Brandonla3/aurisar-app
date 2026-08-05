/**
 * Password policy — 8+ chars (NIST SP 800-63B rev.4 minimum), a 3-of-4
 * composition rule (lower / upper / digit / symbol), and a HaveIBeenPwned
 * k-anonymity breach check. Industry parity with MyFitnessPal / Peloton.
 *
 * Extracted from App.jsx so the breach logic is testable in isolation — the
 * same reason mfaGate.js and fetchResult.js live here. This is the only
 * breach protection in the product: Supabase's own leaked-password
 * protection is a Pro-plan feature and is not enabled on this project, so
 * there is no server-side net under this check.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 72; // Supabase / bcrypt limit
export const PASSWORD_REQUIRED_CLASSES = 3; // out of 4

export function passwordCharClassesPresent(pw) {
  let n = 0;
  if (/[a-z]/.test(pw)) n++;
  if (/[A-Z]/.test(pw)) n++;
  if (/[0-9]/.test(pw)) n++;
  if (/[^A-Za-z0-9]/.test(pw)) n++;
  return n;
}

async function sha1Hex(input) {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-1", buf);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * Returns "breached" | "clean" | "unknown".
 *
 * NOT a boolean, deliberately. This used to return `false` both when the
 * password was clean AND when HIBP could not be reached, so an outage
 * silently accepted breached passwords — the same "broken renders as empty"
 * defect fixed elsewhere in this app, except the consequence here is a weak
 * credential that persists forever rather than a blank screen.
 */
export async function isPasswordBreached(password) {
  // Only the first 5 chars of the SHA-1 are sent; HIBP returns every matching
  // suffix. The full hash never leaves the browser.
  const sha1 = await sha1Hex(password).catch(() => null);
  if (!sha1) return "unknown";
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  // One retry: a single blip shouldn't block a signup, but a real outage must
  // surface rather than wave the password through.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch("https://api.pwnedpasswords.com/range/" + prefix, {
        headers: { "Add-Padding": "true" },
      });
      if (!res.ok) continue;
      const text = await res.text();
      return text.split("\n").some(line => line.split(":")[0].trim() === suffix)
        ? "breached"
        : "clean";
    } catch {
      // network error — fall through to the retry
    }
  }
  return "unknown";
}

export async function validatePasswordPolicy(password) {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, msg: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, msg: `Password is too long (max ${PASSWORD_MAX_LENGTH} characters).` };
  }
  if (passwordCharClassesPresent(password) < PASSWORD_REQUIRED_CLASSES) {
    return {
      ok: false,
      msg: "Password must include at least 3 of: lowercase, uppercase, number, symbol.",
    };
  }

  const breach = await isPasswordBreached(password);
  if (breach === "breached") {
    return {
      ok: false,
      msg: "That password has appeared in a public data breach. Please choose a different one.",
    };
  }
  if (breach === "unknown") {
    // Fail CLOSED. Blocking is temporary, visible and retryable; accepting a
    // password we could not screen is permanent and silent. Distinct copy so
    // the user is never told their password is breached when we simply
    // couldn't check.
    return {
      ok: false,
      msg: "Couldn't check that password against known breaches just now. Please try again in a moment.",
    };
  }
  return { ok: true };
}
