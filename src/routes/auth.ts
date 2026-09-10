// GitHub web OAuth (scope read:user; the GitHub token is discarded after /user). Device flow lands in phase 5.
import { Hono } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { AppEnv } from "../env";
import { GitHub, parseGhDate } from "../lib/github";
import { upsertUser } from "../lib/db";
import { issueWebSession, clearWebSession } from "../lib/session";

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

auth.get("/device", (c) => c.text("Device login lands in phase 5. For now: log in on the web, then use the cookie, or wait for /auth/device/start.", 501));

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
