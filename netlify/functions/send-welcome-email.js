export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { email } = await req.json();
  if (!email) {
    return new Response(JSON.stringify({ error: "Missing email" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Welcome to Aurisar Fitness</title></head>
<body style="background:#0c0c0a;color:#d4cec4;font-family:Arial,sans-serif;margin:0;padding:32px 16px">
  <div style="max-width:480px;margin:0 auto">
    <div style="text-align:center;margin-bottom:28px">
      <h1 style="font-size:2rem;font-weight:900;letter-spacing:.18em;color:#c49428;margin:0">AURISAR</h1>
      <div style="font-size:.85rem;letter-spacing:.35em;color:#8a8478;text-transform:uppercase;margin-top:4px">Fitness</div>
    </div>
    <div style="background:rgba(45,42,36,.4);border:1px solid rgba(180,172,158,.08);border-radius:12px;padding:28px">
      <h2 style="color:#d4cec4;font-size:1.2rem;margin:0 0 12px">Welcome, Warrior.</h2>
      <p style="color:#8a8478;font-size:.9rem;line-height:1.6;margin:0 0 16px">Your account has been forged. The journey to elite fitness begins now.</p>
      <p style="color:#8a8478;font-size:.9rem;line-height:1.6;margin:0 0 24px">Complete your onboarding to unlock your warrior class, earn your first XP, and claim your place.</p>
      <div style="text-align:center">
        <a href="https://aurisargames.com" style="display:inline-block;padding:12px 32px;background:rgba(196,148,40,.15);color:#c49428;border:1px solid rgba(196,148,40,.25);border-radius:8px;text-decoration:none;font-size:.78rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase">Enter the Realm &rarr;</a>
      </div>
    </div>
    <div style="text-align:center;margin-top:20px;font-size:.65rem;color:#3a3834">
      Aurisar Games &middot; You&apos;re receiving this because you created an account at aurisargames.com
    </div>
  </div>
</body>
</html>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Aurisar Fitness <welcome@aurisargames.com>",
      to: [email],
      subject: "Welcome to Aurisar Fitness — Your Journey Begins",
      html,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    return new Response(JSON.stringify({ error: err }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

export const config = { path: "/api/send-welcome-email" };
