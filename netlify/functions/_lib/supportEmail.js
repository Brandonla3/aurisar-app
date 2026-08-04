import { renderEmail, escapeHtml } from "./emailTemplate.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// The Resend send, split out from send-support-email.js's HTTP handler so
// submit-feedback.js can trigger it in-process — one Turnstile verification
// covering both the DB write and this notification, instead of the caller
// re-submitting an already-consumed (single-use) Cloudflare token.
export async function sendSupportEmail({ type, message, cleanEmail, cleanAcct }) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_API_KEY) return { ok: false, error: "misconfigured" };

  const labelMap = { bug: "BUG", idea: "IDEA", help: "HELP" };
  const label = labelMap[type];
  const safeLabel = escapeHtml(label);
  const safeEmail = escapeHtml(cleanEmail || "anonymous");
  const safeAcct  = escapeHtml(cleanAcct  || "N/A");
  const safeMsg   = escapeHtml(message);
  const subject = `[${label}] ${message.slice(0, 80)}`;
  const badgeBg = type === "bug" ? "rgba(224,85,85,.15)" : type === "idea" ? "rgba(196,148,40,.15)" : "rgba(100,160,220,.15)";
  const badgeFg = type === "bug" ? "#e05555" : type === "idea" ? "#c49428" : "#64a0dc";

  const html = renderEmail({
    title: `Aurisar Support — ${label}`,
    tagline: "Support",
    maxWidth: 560,
    footerNote: "Submitted via aurisargames.com",
    bodyHtml: `<div style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:.7rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;margin-bottom:16px;background:${badgeBg};color:${badgeFg}">${safeLabel}</div>
      <table style="width:100%;border-collapse:collapse;font-size:.85rem;margin-bottom:20px">
        <tr><td style="color:#8a8478;padding:4px 0;width:110px">From</td><td style="color:#d4cec4">${safeEmail}</td></tr>
        <tr><td style="color:#8a8478;padding:4px 0">Account ID</td><td style="color:#d4cec4">${safeAcct}</td></tr>
      </table>
      <div style="border-top:1px solid rgba(180,172,158,.08);padding-top:16px;font-size:.9rem;color:#d4cec4;line-height:1.6;white-space:pre-wrap">${safeMsg}</div>`,
  });

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Aurisar Support <support@aurisargames.com>",
      to: ["support@aurisargames.com"],
      reply_to: cleanEmail && EMAIL_RE.test(cleanEmail) ? cleanEmail : undefined,
      subject,
      html,
    }),
  });

  return res.ok ? { ok: true } : { ok: false, error: "send_failed" };
}
