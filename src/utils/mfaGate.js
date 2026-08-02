// Pure decision half of the MFA assurance gate, split out so it can be tested
// without a Supabase session or the 6k-line App component.
//
// Background: the app had a full TOTP lifecycle whose challenge only ran on
// the password sign-in path. The getSession() bootstrap and onAuthStateChange
// paths went straight to the main screen, so reloading the page skipped MFA
// entirely. shouldChallengeMfa is now consulted by every entry path.

// listFactors() buckets factors by type: data.totp, data.webauthn, data.phone.
// Supabase derives AAL from ANY verified factor, so the gate has to look at all
// of them — checking only `totp` let a passkey-only user sail past the
// challenge with an aal1 session (and then hit the aal2 RLS wall, which reads
// as a hard lockout rather than a prompt).
const FACTOR_BUCKETS = ["totp", "webauthn", "phone"];

function verifiedFactors(factors) {
  if (!factors) return [];
  return FACTOR_BUCKETS.flatMap(bucket =>
    ((factors[bucket] || []).filter(f => f && f.status === "verified"))
      .map(f => ({ ...f, bucket }))
  );
}

/**
 * @param {{currentLevel?: string, nextLevel?: string}|null} aal
 *   result of sb.auth.mfa.getAuthenticatorAssuranceLevel()
 * @param {{totp?: Array, webauthn?: Array, phone?: Array}|null} factors
 *   result of sb.auth.mfa.listFactors()
 * @returns {{challenge: boolean, factorId: string|null, factorType: string|null}}
 *   factorType 'totp' means the 6-digit code screen can satisfy the challenge.
 *   Any other type means we must still block, but the code entry cannot help —
 *   the caller shows the passkey/recovery-code variant instead.
 */
export function shouldChallengeMfa(aal, factors) {
  const none = { challenge: false, factorId: null, factorType: null };
  if (!aal) return none;
  // aal1 + nextLevel aal2 is Supabase's "you have a verified factor but this
  // session hasn't used it". aal2 means already satisfied; aal1/aal1 means the
  // user never enrolled.
  if (aal.currentLevel !== "aal1" || aal.nextLevel !== "aal2") return none;

  const verified = verifiedFactors(factors);
  if (verified.length === 0) return none;

  // Prefer TOTP when present: it's the one type the existing challenge screen
  // can actually complete in place.
  const totp = verified.find(f => f.bucket === "totp");
  if (totp) return { challenge: true, factorId: totp.id, factorType: "totp" };

  const other = verified[0];
  return { challenge: true, factorId: other.id, factorType: other.bucket };
}
