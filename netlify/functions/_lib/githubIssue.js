const MAX_TITLE_LEN = 80;

// GitHub Markdown is the rendering target. Backticks/HTML get rendered, so we
// neutralise the most abusable characters before interpolation.
function escapeMarkdown(str) {
  return String(str ?? "")
    .replace(/​|‌|‍|﻿/g, "") // strip zero-width chars
    .replace(/[`<>]/g, m => ({ "`": "\\`", "<": "&lt;", ">": "&gt;" }[m]));
}

// Split out from create-github-issue.js's HTTP handler so submit-feedback.js
// can trigger it in-process — see supportEmail.js for why.
export async function createGithubIssue({ type, message, cleanAcct }) {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) return { ok: false, error: "misconfigured" };

  const label = type === "idea" ? "idea" : "bug";
  const title = `[${type.toUpperCase()}] ${message.slice(0, MAX_TITLE_LEN)}`;
  const issueBody = [
    `**Type:** ${escapeMarkdown(type)}`,
    `**Account ID:** ${escapeMarkdown(cleanAcct || "N/A")}`,
    "",
    escapeMarkdown(message),
  ].join("\n");

  const res = await fetch("https://api.github.com/repos/brandonla3/aurisar-app/issues", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      title,
      body: issueBody,
      labels: [label],
      assignees: ["brandonla3"],
    }),
  });

  return res.ok ? { ok: true } : { ok: false, error: "creation_failed" };
}
