// GitHub web OAuth (scope read:user; the GitHub token is discarded after /user). Device flow lands in phase 5.
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv } from "../env";
import { GitHub, parseGhDate } from "../lib/github";
import { upsertUser } from "../lib/db";
import { issueWebSession, clearWebSession, sign } from "../lib/session";

export const auth = new Hono<AppEnv>();

function safeNext(n: string | undefined): string {
  if (!n || !n.startsWith("/") || n.startsWith("//")) return "/";
  return n;
}

auth.get("/github", (c) => {
  if (!c.env.GITHUB_CLIENT_ID) return c.text("GitHub OAuth is not configured (GITHUB_CLIENT_ID). Set it in .dev.vars or wrangler secrets.", 503);
  const state = crypto.randomUUID();
  const next = safeNext(c.req.query("next"));
  setCookie(c, "oauth_state", `${state}|${next}`, { httpOnly: true, sameSite: "Lax", path: "/auth", maxAge: 600, secure: new URL(c.req.url).protocol === "https:" });
  const redirect = new URL("/auth/callback", c.req.url).toString();
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", c.env.GITHUB_CLIENT_ID);
  u.searchParams.set("redirect_uri", redirect);
  u.searchParams.set("scope", "read:user");
  u.searchParams.set("state", state);
  return c.redirect(u.toString());
});

auth.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const saved = getCookie(c, "oauth_state") ?? "";
  deleteCookie(c, "oauth_state", { path: "/auth" });
  const [savedState, next] = saved.split("|");
  if (!code || !state || state !== savedState) return c.text("OAuth state mismatch. Try logging in again.", 400);
  if (!c.env.GITHUB_CLIENT_ID || !c.env.GITHUB_CLIENT_SECRET) return c.text("OAuth not configured", 503);
  const token = await GitHub.exchangeCode(c.env.GITHUB_CLIENT_ID, c.env.GITHUB_CLIENT_SECRET, code);
  if (!token) return c.text("GitHub did not return a token.", 502);
  const gh = await GitHub.userFromToken(token);
  if (!gh) return c.text("Could not read your GitHub profile.", 502);
  await upsertUser(c.env.DB, {
    id: gh.id, login: gh.login, avatar_url: gh.avatar_url, gh_created_at: parseGhDate(gh.created_at),
    public_repos: gh.public_repos ?? 0, followers: gh.followers ?? 0,
  });
  await issueWebSession(c, gh.id, c.env.SESSION_SECRET);
  return c.redirect(safeNext(next));
});

auth.post("/logout", (c) => {
  clearWebSession(c);
  return c.redirect("/");
});

// ---- GitHub device flow for agents: no browser on the agent, the GitHub token never leaves the server ----
const DEVICE_TTL = 90 * 86400;

auth.get("/device", (c) => c.json({
  how: "POST /auth/device/start → show the user the verification_uri + user_code → poll POST /auth/device/poll {device_code} every `interval` seconds → receive {token}; then send Authorization: Bearer <token> on writes.",
  scope: "read:user (we keep your GitHub id, login, avatar; the GitHub token is discarded)",
  token_lifetime_days: DEVICE_TTL / 86400,
}));

auth.post("/device/start", async (c) => {
  if (!c.env.GITHUB_CLIENT_ID) return c.json({ error: "GitHub OAuth is not configured" }, 503);
  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": "slopscore" },
    body: JSON.stringify({ client_id: c.env.GITHUB_CLIENT_ID, scope: "read:user" }),
  });
  if (!res.ok) return c.json({ error: `GitHub device flow failed (${res.status}). The OAuth app must have "Enable Device Flow" ticked.` }, 502);
  const j = (await res.json()) as { device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number };
  return c.json({ device_code: j.device_code, user_code: j.user_code, verification_uri: j.verification_uri, expires_in: j.expires_in, interval: j.interval, poll: "/auth/device/poll" });
});

auth.post("/device/poll", async (c) => {
  if (!c.env.GITHUB_CLIENT_ID) return c.json({ error: "GitHub OAuth is not configured" }, 503);
  const b = (await c.req.json().catch(() => ({}))) as { device_code?: string };
  if (!b.device_code) return c.json({ error: "device_code required" }, 400);
  const res = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": "slopscore" },
    body: JSON.stringify({ client_id: c.env.GITHUB_CLIENT_ID, device_code: b.device_code, grant_type: "urn:ietf:params:oauth:grant-type:device_code" }),
  });
  const j = (await res.json()) as { access_token?: string; error?: string; interval?: number };
  if (!j.access_token) return c.json({ pending: true, error: j.error ?? "authorization_pending", interval: j.interval }, j.error === "authorization_pending" || j.error === "slow_down" ? 202 : 400);
  const gh = await GitHub.userFromToken(j.access_token);
  if (!gh) return c.json({ error: "could not read the GitHub profile" }, 502);
  await upsertUser(c.env.DB, { id: gh.id, login: gh.login, avatar_url: gh.avatar_url, gh_created_at: parseGhDate(gh.created_at), public_repos: gh.public_repos ?? 0, followers: gh.followers ?? 0 });
  const token = await sign({ uid: gh.id, exp: Math.floor(Date.now() / 1000) + DEVICE_TTL, kind: "device" }, c.env.SESSION_SECRET);
  return c.json({ token, login: gh.login, expires_in: DEVICE_TTL, use: "Authorization: Bearer <token>" });
});

// Local-dev only: impersonate a seeded user without GitHub. Enabled when GITHUB_CLIENT_ID is unset and host is localhost.
auth.get("/dev/:id", async (c) => {
  const host = new URL(c.req.url).hostname;
  if (c.env.GITHUB_CLIENT_ID || (host !== "localhost" && host !== "127.0.0.1")) return c.notFound();
  const id = Number(c.req.param("id"));
  const u = await c.env.DB.prepare("SELECT id FROM users WHERE id = ?").bind(id).first();
  if (!u) return c.text("no such seeded user", 404);
  await issueWebSession(c, id, c.env.SESSION_SECRET);
  return c.redirect(safeNext(c.req.query("next")));
});
