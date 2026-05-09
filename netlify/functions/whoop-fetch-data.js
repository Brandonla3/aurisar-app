import { createClient } from "@supabase/supabase-js";

const ALLOWED_ORIGINS = new Set([
  "https://aurisargames.com",
  "https://www.aurisargames.com",
  "https://aurisargames.netlify.app",
  "http://localhost:5173",
]);

async function refreshAccessToken(supabase, userId, currentRefreshToken, clientId, clientSecret) {
  const res = await fetch("https://api.whoop.com/oauth/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "refresh_token",
      refresh_token: currentRefreshToken,
      client_id:     clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);
  const data = await res.json();
  const expires_at = new Date(Date.now() + data.expires_in * 1000).toISOString();
  await supabase.from("whoop_tokens").update({
    access_token:  data.access_token,
    refresh_token: data.refresh_token,
    expires_at,
    updated_at:    new Date().toISOString(),
  }).eq("user_id", userId);
  return data.access_token;
}

async function whoopGet(path, accessToken) {
  const res = await fetch(`https://api.whoop.com${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Whoop API error ${res.status} on ${path}`);
  return res.json();
}

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
  // never from the request body (prevents cross-account data access).
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

  const clientId     = process.env.WHOOP_CLIENT_ID;
  const clientSecret = process.env.WHOOP_CLIENT_SECRET;

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: tokenRow, error: tokenErr } = await supabase
    .from("whoop_tokens")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (tokenErr || !tokenRow) {
    return new Response(JSON.stringify({ error: "Whoop not linked" }), {
      status: 404, headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }

  let { access_token, refresh_token, expires_at } = tokenRow;

  // Refresh if token expires within 60 seconds
  if (new Date(expires_at) < new Date(Date.now() + 60_000)) {
    access_token = await refreshAccessToken(supabase, userId, refresh_token, clientId, clientSecret);
  }

  const start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const end   = new Date().toISOString();

  const [recoveries, cycles, sleeps] = await Promise.all([
    whoopGet(`/v4/recovery?start=${start}&end=${end}&limit=25`, access_token),
    whoopGet(`/v2/cycle?start=${start}&end=${end}&limit=25`, access_token),
    whoopGet(`/v2/activity/sleep?start=${start}&end=${end}&limit=25`, access_token),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  const rows = [
    ...(recoveries.records ?? []).map(r => ({
      user_id:    userId,
      data_type:  "recovery",
      cycle_date: r.created_at?.slice(0, 10) ?? today,
      payload:    r,
    })),
    ...(cycles.records ?? []).map(r => ({
      user_id:    userId,
      data_type:  "cycle",
      cycle_date: r.start?.slice(0, 10) ?? today,
      payload:    r,
    })),
    ...(sleeps.records ?? []).map(r => ({
      user_id:    userId,
      data_type:  "sleep",
      cycle_date: r.start?.slice(0, 10) ?? today,
      payload:    r,
    })),
  ];

  if (rows.length > 0) {
    await supabase.from("whoop_data").upsert(rows, {
      onConflict: "user_id,data_type,cycle_date",
    });
  }

  return new Response(JSON.stringify({ synced: rows.length }), {
    status: 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
};
