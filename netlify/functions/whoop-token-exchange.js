import { createClient } from "@supabase/supabase-js";

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
      headers: {
        ...corsHeaders,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });

  // Verify the caller's Supabase session — derive userId from the token,
  // never from the request body (prevents cross-account token hijacking).
  const bearerToken = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bearerToken) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const supabaseAnon = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );
  const { data: { user }, error: authErr } = await supabaseAnon.auth.getUser(bearerToken);
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
  const userId = user.id; // authoritative — ignore any userId in body

  const { code } = await req.json().catch(() => ({}));
  if (!code) {
    return new Response(JSON.stringify({ error: "Missing code" }), {
      status: 400, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const clientId     = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;
  const redirectUri  = process.env.WHOOP_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    return new Response(JSON.stringify({ error: "Whoop credentials not configured" }), {
      status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const tokenRes = await fetch("https://api.prod.whoop.com/oauth/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "authorization_code",
      code,
      client_id:     clientId,
      client_secret: clientSecret,
      redirect_uri:  redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    return new Response(JSON.stringify({ error: err }), {
      status: 502, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  const { access_token, refresh_token, expires_in, scope } = await tokenRes.json();
  const expires_at = new Date(Date.now() + expires_in * 1000).toISOString();

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { error } = await supabase.from("whoop_tokens").upsert({
    user_id:    userId,
    access_token,
    refresh_token,
    expires_at,
    scope,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
};
