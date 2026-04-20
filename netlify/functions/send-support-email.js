export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const { type, message, email, accountId } = await req.json();
  if (!type || !message) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), {
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

  const labelMap = { bug: "BUG", idea: "IDEA", help: "HELP" };
  const label = labelMap[type] || type.toUpperCase();
  const subject = `[${label}] ${message.slice(0, 80)}`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Aurisar Support — ${label}</title></head>
<body style="background:#0c0c0a;color:#d4cec4;font-family:Arial,sans-serif;margin:0;padding:32px 16px">
  <div style="max-width:560px;margin:0 auto">
    <div style="text-align:center;margin-bottom:24px">
      <h1 style="font-size:2rem;font-weight:900;letter-spacing:.18em;color:#c49428;margin:0">AURISAR</h1>
      <div style="font-size:.85rem;letter-spacing:.35em;color:#8a8478;text-transform:uppercase;margin-top:4px">Support</div>
    </div>
    <div style="background:rgba(45,42,36,.4);border:1px solid rgba(180,172,158,.08);border-radius:12px;padding:28px">
      <div style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:16px;background:${type === "bug" ? "rgba(224,85,85,.15)" : type === "idea" ? "rgba(196,148,40,.15)" : "rgba(100,160,220,.15)"};color:${type === "bug" ? "#e05555" : type === "idea" ? "#c49428" : "#64a0dc"}">${label}</div>
      <table style="width:100%;border-collapse:collapse;font-size:.85rem;margin-bottom:20px">
        <tr><td style="color:#8a8478;padding:4px 0;width:110px">From</td><td style="color:#d4cec4">${email || "anonymous"}</td></tr>
        <tr><td style="color:#8a8478;padding:4px 0">Account ID</td><td style="color:#d4cec4">${accountId || "N/A"}</td></tr>
      </table>
      <div style="border-top:1px solid rgba(180,172,158,.08);padding-top:16px;font-size:.9rem;color:#d4cec4;line-height:1.6;white-space:pre-wrap">${message.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</div>
    </div>
    <div style="text-align:center;margin-top:20px;font-size:.65rem;color:#3a3834">
      Aurisar Games &middot; Submitted via aurisargames.com
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
      from: "Aurisar Support <support@aurisargames.com>",
      to: ["support@aurisargames.com"],
      reply_to: email || undefined,
      subject,
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

export const config = { path: "/api/send-support-email" };
