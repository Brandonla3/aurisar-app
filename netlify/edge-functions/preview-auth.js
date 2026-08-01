/**
 * preview-auth — server-side HTTP Basic Auth gate for PUBLIC, non-production
 * Netlify deploys (deploy previews + branch deploys).
 *
 * Why this exists
 * ---------------
 * The app's client-side "Preview Mode" PIN can never be a real secret: every
 * value used in browser code (including any VITE_* env var) is inlined into the
 * public JS bundle and is trivially readable in a public repo or via DevTools.
 * This edge function moves the access boundary to the SERVER. The credential
 * lives only in Netlify environment variables and is never shipped to the
 * client. The gate runs at the edge, before any static asset or function
 * response is served, so the whole preview site is protected.
 *
 * Scope (by Netlify deploy context, read at runtime from context.deploy.context):
 *   - production                     → never gated (the real app; real Supabase
 *                                       auth is the access control there).
 *   - deploy-preview / branch-deploy → REQUIRE Basic Auth. If the credential
 *                                       env vars are unset, the deploy is locked
 *                                       (503) rather than silently left open.
 *   - local dev / anything else      → not gated (developer convenience).
 *
 * IMPORTANT: the build-time `CONTEXT` environment variable is NOT available to
 * edge functions at runtime, so the deploy context is read from the Context
 * object (`context.deploy.context`), which IS available at runtime. Because the
 * gate is decided here in code, the credential env vars can be set as plain
 * all-context variables in Netlify — no per-deploy-context scoping required
 * (production and local dev are ignored regardless of the values).
 *
 * Configuration (Netlify → Site settings → Environment variables; scope them to
 * "Deploy Previews" and "Branch deploys"):
 *   - PREVIEW_BASIC_AUTH_USER
 *   - PREVIEW_BASIC_AUTH_PASSWORD
 * These are plain (non-VITE_) server-side vars, so they are NOT exposed to the
 * browser bundle.
 */

/* global Netlify */

const REALM = 'Aurisar Preview';
const GATED_CONTEXTS = new Set(['deploy-preview', 'branch-deploy']);

/** Only public, non-production deploy contexts are gated. */
export function shouldGate(deployContext) {
  return GATED_CONTEXTS.has(deployContext);
}

/**
 * Length-independent, character-by-character comparison so the compare time
 * does not leak which prefix matched. Not a substitute for real crypto, but it
 * removes the trivial early-exit timing signal of `===` for a shared secret.
 */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

/**
 * Validate an `Authorization` header value against expected credentials.
 * Returns true only for a well-formed `Basic base64(user:pass)` that matches.
 * A password may itself contain ":"; only the first ":" separates the fields.
 */
export function isAuthorized(authorizationHeader, expectedUser, expectedPass) {
  if (!authorizationHeader) return false;
  const [scheme, encoded] = authorizationHeader.split(' ');
  if (!encoded || scheme.toLowerCase() !== 'basic') return false;

  let decoded;
  try {
    decoded = atob(encoded);
  } catch {
    return false;
  }

  const sep = decoded.indexOf(':');
  if (sep === -1) return false;

  const user = decoded.slice(0, sep);
  const pass = decoded.slice(sep + 1);

  // Evaluate both comparisons unconditionally so a wrong username and a wrong
  // password are indistinguishable by response timing.
  const userOk = safeEqual(user, expectedUser);
  const passOk = safeEqual(pass, expectedPass);
  return userOk && passOk;
}

function challenge() {
  return new Response('Authentication required.', {
    status: 401,
    headers: {
      'WWW-Authenticate': `Basic realm="${REALM}", charset="UTF-8"`,
      'Cache-Control': 'no-store',
    },
  });
}

export default async (request, context) => {
  // The build-time CONTEXT env var is unavailable at edge runtime; the deploy
  // context is exposed on the Context object instead.
  const deployContext = context?.deploy?.context ?? '';

  // Production and local dev pass straight through, untouched.
  if (!shouldGate(deployContext)) {
    return context.next();
  }

  const expectedUser = Netlify.env.get('PREVIEW_BASIC_AUTH_USER');
  const expectedPass = Netlify.env.get('PREVIEW_BASIC_AUTH_PASSWORD');

  // Fail closed: a public preview with no configured credentials must never be
  // reachable. Set both vars in Netlify for Deploy Previews / Branch deploys.
  if (!expectedUser || !expectedPass) {
    return new Response(
      'Preview access is not configured. Set PREVIEW_BASIC_AUTH_USER and PREVIEW_BASIC_AUTH_PASSWORD in Netlify.',
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const authHeader = request.headers.get('authorization');
  if (!isAuthorized(authHeader, expectedUser, expectedPass)) {
    return challenge();
  }

  return context.next();
};

// Inline configuration: gate every path. Netlify auto-detects edge functions in
// this directory and reads this config (no netlify.toml entry required).
export const config = { path: '/*' };
