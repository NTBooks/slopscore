import type { MiddlewareHandler } from "hono";
import type { AppEnv, SessionUser } from "./env";
import { adminLogins } from "./env";
import { readSession, csrfToken } from "./lib/session";
import { getUser } from "./lib/db";
import { now } from "./lib/time";
import { setFlags, flagOn } from "./lib/flags";
import { csp } from "./lib/csp";
import { classify, doorExempt, isShut, record, BLOCK_SECONDS } from "./lib/tripwire";
import { ipHash } from "./lib/trust";
import { isPreviewHost, previewChallenge } from "./lib/host";

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
        isCritic: u.bot === 1,
        canWrite: !u.banned_at && (oldEnough || u.public_repos >= 1),
        csrf: await csrfToken(u.id, c.env.SESSION_SECRET),
        row: u,
      };
      c.set("user", user);
    }
  }
  await next();
};

/**
 * The password on the test host (lib/host.ts). Runs after loadUser so a request that already proved itself
 * with a site session walks through, and inside `secure` so the refusal carries the noindex header too.
 */
export const previewGate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const shut = previewChallenge(c.req.raw, c.env, { signedIn: Boolean(c.get("user")) });
  return shut ?? next();
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

/**
 * The headers every response carries, and the CSP on the HTML ones.
 *
 * The CSP is the layer under GitHub's sanitiser and ours: repo pages render third-party README HTML
 * verbatim, and this assumes both passes failed (see lib/csp.ts). It goes on HTML only -- a JSON or XML
 * response has no script to govern, and /badge/*.svg is embedded in other people's READMEs on purpose.
 */
export const secure: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  c.header("x-content-type-options", "nosniff");
  c.header("referrer-policy", "strict-origin-when-cross-origin");
  // The test environment and preview deploys are never indexed, on every format: robots.txt says so for
  // crawlers that ask, and this says so for the ones that arrive by a link.
  if (isPreviewHost(new URL(c.req.url).hostname)) c.header("x-robots-tag", "noindex, nofollow");
  if ((c.res.headers.get("content-type") ?? "").includes("text/html")) {
    c.header("content-security-policy", await csp());
    c.header("x-frame-options", "DENY");
  }
};

/**
 * The tripwire (lib/tripwire.ts): count requests shaped like an attack, and refuse a source that earned a
 * 24-hour block. Recording happens after the response is sent, so a probe never costs a real visitor
 * latency, and the whole thing is wrapped: a broken tripwire must never be able to 500 a page.
 *
 * A verified search crawler or a logged-in admin is counted but never blocked. Googlebot following a
 * mangled link must not be able to take this site out of the index, and locking the moderator out of the
 * mod console is how a false positive becomes an outage.
 */
export const tripwire: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!flagOn("tripwire")) return next();
  const url = new URL(c.req.url);
  const trip = classify(url);
  let hash: string | null = null;
  try {
    hash = await ipHash(c.req.header("cf-connecting-ip"), c.env.SESSION_SECRET);
    // The appeal route stays open to a shut-out address, or the refusal below would be telling people to
    // use a page it refuses to show them.
    if (!doorExempt(url.pathname) && await isShut(c.env.DB, hash)) {
      c.header("retry-after", String(BLOCK_SECONDS));
      return c.text(
        `Refused. This address sent several things shaped like an attack today, so it is shut out for 24 hours.

If that was not you (a shared connection, say), or it was and you were only curious, say so at ${c.env.SITE_URL ?? "https://slopscore.org"}/contact -- that page still answers you -- and it will be lifted.
`,
        403,
      );
    }
  } catch { /* the door is stuck open: serve the request */ }
  if (!trip) return next();
  const cf = c.req.raw.cf as { verifiedBotCategory?: string; botManagement?: { verifiedBot?: boolean } } | undefined;
  const exempt = Boolean(cf?.verifiedBotCategory || cf?.botManagement?.verifiedBot || c.get("user")?.isAdmin);
  c.executionCtx.waitUntil(record(c.env, trip, hash, exempt).catch(() => {}));
  return next();
};
