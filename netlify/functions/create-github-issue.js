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

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) {
    return new Response(JSON.stringify({ error: "Server misconfigured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const label = type === "idea" ? "idea" : type === "bug" ? "bug" : null;
  const title = `[${type.toUpperCase()}] ${message.slice(0, 80)}`;
  const body = [
    `**Type:** ${type}`,
    `**Email:** ${email || "anonymous"}`,
    `**Account ID:** ${accountId || "N/A"}`,
    "",
    message,
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
      body,
      labels: label ? [label] : [],
      assignees: ["brandonla3"],
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

export const config = { path: "/api/create-github-issue" };
