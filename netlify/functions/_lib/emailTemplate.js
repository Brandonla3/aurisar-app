// Shared transactional email shell — the dark/gold Aurisar branding that
// was previously copy-pasted into three functions. Every outbound email
// renders through renderEmail() so layout, footer and brand stay in sync.

// Escape every HTML special character. Do not use a partial substitution
// (e.g. only `<` / `>`) — `&`, `"`, `'`, `/` all matter for safe HTML output.
export function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\//g, "&#x2F;");
}

/**
 * Render the branded shell around a content card.
 *
 * @param {object} opts
 * @param {string} opts.title        <title> text (plain, escaped here)
 * @param {string} opts.tagline      Small caps line under AURISAR ("Fitness", "Support")
 * @param {string} opts.bodyHtml     Pre-escaped/trusted HTML for the card body
 * @param {string} [opts.ctaText]    Optional gold CTA button label (plain text)
 * @param {string} [opts.ctaUrl]     CTA href — must be a caller-constructed URL,
 *                                   never user input
 * @param {string} [opts.linkFallback] Show the raw URL under the CTA (invite-style)
 * @param {string} opts.footerNote   Why-you-got-this line (plain text, escaped here)
 * @param {number} [opts.maxWidth]   Card width, default 480
 */
export function renderEmail({
  title,
  tagline = "Fitness",
  bodyHtml,
  ctaText,
  ctaUrl,
  linkFallback,
  footerNote,
  maxWidth = 480,
}) {
  const cta =
    ctaText && ctaUrl
      ? `<div style="text-align:center${linkFallback ? ";margin-bottom:20px" : ""}">
        <a href="${ctaUrl}" style="display:inline-block;padding:12px 32px;background:rgba(196,148,40,.15);color:#c49428;border:1px solid rgba(196,148,40,.25);border-radius:8px;text-decoration:none;font-size:.78rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase">${escapeHtml(ctaText)} &rarr;</a>
      </div>` +
        (linkFallback
          ? `<p style="color:#5a5650;font-size:.7rem;margin:0;text-align:center;word-break:break-all">Or paste this link: ${ctaUrl}</p>`
          : "")
      : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body style="background:#0c0c0a;color:#d4cec4;font-family:Arial,sans-serif;margin:0;padding:32px 16px">
  <div style="max-width:${maxWidth}px;margin:0 auto">
    <div style="text-align:center;margin-bottom:28px">
      <h1 style="font-size:2rem;font-weight:900;letter-spacing:.18em;color:#c49428;margin:0">AURISAR</h1>
      <div style="font-size:.85rem;letter-spacing:.35em;color:#8a8478;text-transform:uppercase;margin-top:4px">${escapeHtml(tagline)}</div>
    </div>
    <div style="background:rgba(45,42,36,.4);border:1px solid rgba(180,172,158,.08);border-radius:12px;padding:28px">
      ${bodyHtml}
      ${cta}
    </div>
    <div style="text-align:center;margin-top:20px;font-size:.65rem;color:#3a3834">
      Aurisar Games &middot; ${escapeHtml(footerNote)}
    </div>
  </div>
</body>
</html>`;
}

// Convenience for the common heading + paragraphs card body.
export function cardBody(heading, paragraphs) {
  const ps = paragraphs
    .map(
      (p, i) =>
        `<p style="color:#8a8478;font-size:.9rem;line-height:1.6;margin:0 0 ${i === paragraphs.length - 1 ? 24 : 16}px">${p}</p>`
    )
    .join("\n      ");
  return `<h2 style="color:#d4cec4;font-size:1.2rem;margin:0 0 12px">${heading}</h2>
      ${ps}`;
}
