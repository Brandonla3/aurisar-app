/**
 * Daily reminder producer — the "bidirectional" half of the notification
 * scheduler. Where notifications-drain.js consumes outbox rows, this one
 * produces them: a nightly call to produce_daily_reminders() inserts
 * streak_at_risk and workout_reminder rows, which then flow through the
 * exact same checkpoint + projections as every other event.
 *
 * 23:00 UTC ≈ 4pm PT / 7pm ET — late enough that "no check-in yet today"
 * is meaningful, early enough that US users can still act on it.
 */

export default async () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("[reminders-producer] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
    return new Response("misconfigured", { status: 500 });
  }

  const res = await fetch(`${url}/rest/v1/rpc/produce_daily_reminders`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  });

  if (!res.ok) {
    console.error(
      "[reminders-producer] rpc failed:",
      res.status,
      await res.text().catch(() => "")
    );
    return new Response("rpc failed", { status: 500 });
  }

  const [counts] = await res.json();
  console.log(
    `[reminders-producer] streak_at_risk=${counts?.streak_rows ?? 0} workout_reminder=${counts?.workout_rows ?? 0}`
  );
  return new Response("ok", { status: 200 });
};

export const config = { schedule: "0 23 * * *" };
