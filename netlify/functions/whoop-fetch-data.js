import { createClient } from "@supabase/supabase-js";

const ALLOWED_ORIGINS = new Set([
  "https://aurisargames.com",
  "https://www.aurisargames.com",
  "https://aurisargames.netlify.app",
  "http://localhost:5173",
]);

// Hard cap on pagination — 200 pages × 25 records = 5,000 records per
// data_type per sync. Whoop accounts older than ~13 years would hit
// this; everyone else's full backfill comfortably fits.
const MAX_PAGES_PER_TYPE = 200;
// Supabase upsert batch size — keep the payload well under request
// size limits even for users with thousands of historical records.
const UPSERT_BATCH = 500;

async function refreshAccessToken(supabase, userId, currentRefreshToken, clientId, clientSecret) {
  const res = await fetch("https://api.prod.whoop.com/oauth/oauth2/token", {
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
  const res = await fetch(`https://api.prod.whoop.com${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Whoop API ${res.status} on ${path}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

// Walks Whoop's next_token cursor until exhausted (or MAX_PAGES_PER_TYPE
// is hit, whichever comes first). startISO/endISO are optional bounds:
// when both are null, the endpoint returns everything Whoop has for the
// user. When startISO is set, the endpoint returns records on/after it.
async function fetchAllPaginated(basePath, accessToken, { startISO = null, endISO = null, perPage = 25 } = {}) {
  const records = [];
  let nextToken = null;
  let pages = 0;
  do {
    const params = new URLSearchParams();
    params.set("limit", String(perPage));
    if (startISO)  params.set("start",     startISO);
    if (endISO)    params.set("end",       endISO);
    if (nextToken) params.set("nextToken", nextToken);
    const data = await whoopGet(`${basePath}?${params}`, accessToken);
    if (Array.isArray(data?.records)) records.push(...data.records);
    nextToken = data?.next_token ?? null;
    pages++;
    if (pages >= MAX_PAGES_PER_TYPE) {
      console.warn(`[whoop-fetch-data] hit page cap (${MAX_PAGES_PER_TYPE}) on ${basePath}; truncating`);
      break;
    }
  } while (nextToken);
  return records;
}

function recordIdFor(dataType, payload) {
  // Cycle / sleep / workout records have a top-level `id`. Recovery
  // records don't — they're keyed by their owning cycle's `cycle_id`
  // (one recovery per cycle). Singletons (profile, body_measurement)
  // have no per-record id, so use the data_type itself as a sentinel.
  return payload?.id ?? payload?.cycle_id ?? dataType;
}

function cycleDateFor(dataType, payload, today) {
  if (dataType === "recovery") return payload?.created_at?.slice(0, 10) ?? today;
  if (dataType === "cycle" || dataType === "sleep" || dataType === "workout") {
    return payload?.start?.slice(0, 10) ?? today;
  }
  return today; // singletons
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

  // ── Backfill vs incremental ─────────────────────────────────────
  // First sync ever for this user (backfill_completed_at IS NULL):
  //   pull all Whoop history with no `start` filter, paginating until
  //   exhausted. Subsequent syncs only fetch since last_synced_at,
  //   with a 24h overlap so any records edited late don't slip past.
  const isBackfill = !tokenRow.backfill_completed_at;
  const startISO = isBackfill
    ? null
    : (tokenRow.last_synced_at
        ? new Date(new Date(tokenRow.last_synced_at).getTime() - 24 * 60 * 60 * 1000).toISOString()
        : null);
  const endISO = new Date().toISOString();
  const today  = endISO.slice(0, 10);

  const [recoveriesRes, cyclesRes, sleepsRes, workoutsRes, profileRes, bodyRes] =
    await Promise.allSettled([
      fetchAllPaginated("/developer/v2/recovery",         access_token, { startISO, endISO }),
      fetchAllPaginated("/developer/v2/cycle",            access_token, { startISO, endISO }),
      fetchAllPaginated("/developer/v2/activity/sleep",   access_token, { startISO, endISO }),
      fetchAllPaginated("/developer/v2/activity/workout", access_token, { startISO, endISO }),
      whoopGet("/developer/v2/user/profile/basic",        access_token),
      whoopGet("/developer/v2/user/measurement/body",     access_token),
    ]);

  const rows = [];
  const errors = {};
  const counts = {};

  function pushTimeSeries(settled, dataType) {
    if (settled.status !== "fulfilled") {
      errors[dataType] = settled.reason?.message ?? String(settled.reason);
      counts[dataType] = 0;
      return;
    }
    let n = 0;
    for (const r of settled.value) {
      rows.push({
        user_id:    userId,
        data_type:  dataType,
        record_id:  String(recordIdFor(dataType, r)),
        cycle_date: cycleDateFor(dataType, r, today),
        payload:    r,
      });
      n++;
    }
    counts[dataType] = n;
  }

  function pushSingleton(settled, dataType) {
    if (settled.status !== "fulfilled") {
      errors[dataType] = settled.reason?.message ?? String(settled.reason);
      counts[dataType] = 0;
      return;
    }
    rows.push({
      user_id:    userId,
      data_type:  dataType,
      record_id:  dataType,
      cycle_date: today,
      payload:    settled.value,
    });
    counts[dataType] = 1;
  }

  pushTimeSeries(recoveriesRes, "recovery");
  pushTimeSeries(cyclesRes,     "cycle");
  pushTimeSeries(sleepsRes,     "sleep");
  pushTimeSeries(workoutsRes,   "workout");
  pushSingleton(profileRes,     "profile");
  pushSingleton(bodyRes,        "body_measurement");

  if (Object.keys(errors).length > 0) {
    console.error("[whoop-fetch-data] partial failure", errors);
  }

  // Batch upserts so a backfill of thousands of records fits within
  // Supabase request limits.
  let upsertError = null;
  for (let i = 0; i < rows.length; i += UPSERT_BATCH) {
    const batch = rows.slice(i, i + UPSERT_BATCH);
    const { error: upErr } = await supabase.from("whoop_data").upsert(batch, {
      onConflict: "user_id,data_type,record_id",
    });
    if (upErr) {
      console.error("[whoop-fetch-data] supabase upsert failed", upErr, { batchIndex: i });
      upsertError = upErr.message;
      break;
    }
  }

  // Stamp sync state — but only if the upsert succeeded. If it failed,
  // leave backfill_completed_at NULL so the next sync retries the full
  // backfill rather than silently switching to incremental.
  if (!upsertError) {
    const tokenUpdate = { last_synced_at: new Date().toISOString() };
    if (isBackfill) tokenUpdate.backfill_completed_at = new Date().toISOString();
    const { error: stampErr } = await supabase
      .from("whoop_tokens")
      .update(tokenUpdate)
      .eq("user_id", userId);
    if (stampErr) console.error("[whoop-fetch-data] failed to stamp sync state", stampErr);
  }

  return new Response(JSON.stringify({
    synced: rows.length,
    counts,
    errors,
    upsertError,
    backfill: isBackfill,
  }), {
    status: upsertError ? 500 : 200,
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
};
