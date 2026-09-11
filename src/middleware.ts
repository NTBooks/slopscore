import type { MiddlewareHandler } from "hono";
import type { AppEnv, SessionUser } from "./env";
import { adminLogins } from "./env";
import { readSession, csrfToken } from "./lib/session";
import { getUser } from "./lib/db";
import { now } from "./lib/time";
import { setFlags } from "./lib/flags";

/** Loads the session user (cookie or bearer) into c.var.user. Never blocks. */
export const loadUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  setFlags(c.env.MOD_FLAGS);
  c.set("user", null);
  const sess = await readSession(c, c.env.SESSION_SECRET);
  if (sess) {
    const u = await getUser(c.env.DB, sess.uid);
    if (u) {
      const admins = adminLogins(c.env);
      const minAge = Number(c.env.MIN_ACCOUNT_AGE_DAYS || 30) * 86400;
      const oldEnough = (u.gh_created_at ?? now()) <= now() - minAge;
      const user: SessionUser = {
        id: u.id, login: u.login, avatar_url: u.avatar_url, gh_created_at: u.gh_created_at, public_repos: u.public_repos,
        banned_at: u.banned_at,
        isAdmin: admins.has(u.login.toLowerCase()),
        canWrite: !u.banned_at && (oldEnough || u.public_repos >= 1),
        csrf: await csrfToken(u.id, c.env.SESSION_SECRET),
        row: u,
      };
      c.set("user", user);
    }
  }
  await next();
};

/** For POST handlers: requires a session; enforces CSRF for cookie sessions (bearer requests are exempt). */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get("user");
  if (!user) return c.json({ error: "login required", login: "/auth/github" }, 401);
  const isBearer = (c.req.header("authorization") ?? "").toLowerCase().startsWith("bearer ");
  if (!isBearer) {
    const ct = c.req.header("content-type") ?? "";
    let token: string | undefined;
    if (ct.includes("application/json")) {
      token = ((await c.req.json().catch(() => ({}))) as { csrf?: string }).csrf;
    } else {
      token = (await c.req.parseBody())["csrf"] as string | undefined;
    }
    if (token !== user.csrf) return c.json({ error: "bad csrf token" }, 403);
  }
  if (user.banned_at) return c.json({ error: "account is banned" }, 403);
  await next();
};

/** Reads the request body as an object for either form or JSON posts. Safe to call after requireUser. */
export async function body(c: Parameters<MiddlewareHandler<AppEnv>>[0]): Promise<Record<string, string>> {
  const ct = c.req.header("content-type") ?? "";
  if (ct.includes("application/json")) {
    const j = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, v == null ? "" : String(v)]));
  }
  const b = await c.req.parseBody();
  return Object.fromEntries(Object.entries(b).map(([k, v]) => [k, typeof v === "string" ? v : ""]));
}

export const wantsJson = (c: Parameters<MiddlewareHandler<AppEnv>>[0]) => {
  const a = c.req.header("accept") ?? "";
  return a.includes("application/json") || (c.req.header("authorization") ?? "").toLowerCase().startsWith("bearer ");
};
