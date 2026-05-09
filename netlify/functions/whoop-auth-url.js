const ALLOWED_ORIGINS = new Set([
  "https://aurisargames.com",
  "https://www.aurisargames.com",
  "https://aurisargames.netlify.app",
  "http://localhost:5173",
]);

export default async (req) => {
  const origin = req.headers.get("origin") ?? "";
  const corsHeaders = ALLOWED_ORIGINS.has(origin)
    ? { "Access-Control-Allow-Origin": origin }
    : {};

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: { ...corsHeaders, "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" },
    });
  }

  // Same-origin browser fetches (relative URL on the same domain) send no
  // Origin header, so origin is "". Only block when an Origin is present
  // and unrecognised — matches the pattern in send-support-email.js.
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return new Response("Forbidden", { status: 403 });
  }

  const clientId    = process.env.WHOOP_CLIENT_ID;
  const redirectUri = process.env.WHOOP_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return new Response("Whoop credentials not configured", { status: 500 });
  }

  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: "code",
    redirect_uri:  redirectUri,
    scope:         "read:recovery read:sleep read:cycles read:workout read:heartrate read:profile",
    state,
  });

  return new Response(
    JSON.stringify({ url: `https://api.prod.whoop.com/oauth/oauth2/auth?${params}`, state }),
    { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
  );
};
