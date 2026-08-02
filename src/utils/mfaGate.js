// Pure decision half of the MFA assurance gate, split out so it can be tested
// without a Supabase session or the 6k-line App component.
//
// Background: the app had a full TOTP lifecycle whose challenge only ran on
// the password sign-in path. The getSession() bootstrap and onAuthStateChange
// paths went straight to the main screen, so reloading the page skipped MFA
// entirely. shouldChallengeMfa is now consulted by all three.

/**
 * @param {{currentLevel?: string, nextLevel?: string}|null} aal
 *   result of sb.auth.mfa.getAuthenticatorAssuranceLevel()
 * @param {{totp?: Array<{id: string, status: string}>}|null} factors
 *   result of sb.auth.mfa.listFactors()
 * @returns {{challenge: boolean, factorId: string|null}}
 */
export function shouldChallengeMfa(aal, factors) {
  const none = { challenge: false, factorId: null };
  if (!aal) return none;
  // aal1 + nextLevel aal2 is Supabase's "you have a verified factor but this
  // session hasn't used it". aal2 means already satisfied; aal1/aal1 means the
  // user never enrolled.
  if (aal.currentLevel !== "aal1" || aal.nextLevel !== "aal2") return none;
  const totp = ((factors && factors.totp) || []).find(f => f.status === "verified");
  if (!totp) return none;
  return { challenge: true, factorId: totp.id };
}
