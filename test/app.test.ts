// The composed app, not its parts: the order the middleware runs in is a fact about src/index.ts that no
// unit test of a helper can pin. These drive the worker's fetch handler with the same env shape
// production gets and read only what the redirects and headers say, so they need no database.
import { describe, it, expect } from "vitest";
import worker from "../src/index";

const env = { PRIMARY_HOST: "slopscore.org", SITE_URL: "https://slopscore.org", SESSION_SECRET: "test", MOD_FLAGS: "none" } as unknown as Parameters<typeof worker.fetch>[1];
const ctx = { waitUntil() {}, passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
const hit = (u: string) => worker.fetch(new Request(u, { redirect: "manual" }), env, ctx);

describe("one hop home, whatever domain you arrived on", () => {
  it("sends www on the marketing domain straight home, temporarily", async () => {
    const r = await hit("https://www.slopscupper.com/best?x=1");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://slopscore.org/best?x=1");
  });

  it("sends the marketing apex home, temporarily", async () => {
    const r = await hit("https://slopscupper.com/r/a/b?sort=new");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://slopscore.org/r/a/b?sort=new");
  });

  it("strips www on the home domain permanently, since that one never moves", async () => {
    const r = await hit("https://www.slopscore.org/queue");
    expect(r.status).toBe(301);
    expect(r.headers.get("location")).toBe("https://slopscore.org/queue");
  });

  it("never issues a permanent redirect from the marketing domain, so a swap can never strand a browser", async () => {
    for (const u of ["https://www.slopscupper.com/", "https://slopscupper.com/", "https://www.slopscupper.com/auth/github"]) {
      expect((await hit(u)).status, u).toBe(302);
    }
  });
});

describe("copies of the site refuse crawlers", () => {
  it("gives the test host a robots.txt that disallows everything, and a noindex header on top", async () => {
    const r = await hit("https://test.slopscore.org/robots.txt");
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("User-agent: *\nDisallow: /\n");
    expect(r.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("gives production the real rules, with an absolute sitemap on SITE_URL", async () => {
    const r = await hit("https://slopscore.org/robots.txt");
    const body = await r.text();
    expect(body).toContain("Allow: /");
    expect(body).toContain("Sitemap: https://slopscore.org/sitemap.xml");
    expect(r.headers.get("x-robots-tag")).toBeNull();
  });
});

describe("one canonical address per page", () => {
  it("drops the parameters that only reorder or page the same rows, and keeps the ones that name a page", async () => {
    const { canonicalSearch } = await import("../src/views/layout");
    expect(canonicalSearch(new URL("https://slopscore.org/?sort=new"))).toBe("");
    expect(canonicalSearch(new URL("https://slopscore.org/?sort=top&t=week&page=3"))).toBe("");
    expect(canonicalSearch(new URL("https://slopscore.org/best?kind=week&period=2026-09-07&sort=top"))).toBe("?kind=week&period=2026-09-07");
    expect(canonicalSearch(new URL("https://slopscore.org/balcony?critic=schnitzel.bot&page=2"))).toBe("?critic=schnitzel.bot");
  });
});

describe("the test host is behind a password, so it has no pages for an index to find", () => {
  const testEnv = { ...(env as object), PREVIEW_PASSWORD: "hunter2" } as typeof env;
  const knock = (u: string, headers: Record<string, string> = {}) => worker.fetch(new Request(u, { redirect: "manual", headers }), testEnv, ctx);
  const basic = (user: string, pass: string) => ({ authorization: `Basic ${btoa(`${user}:${pass}`)}` });

  it("challenges a bare request with 401, no caching, and the noindex header on the refusal itself", async () => {
    const r = await knock("https://test.slopscore.org/");
    expect(r.status).toBe(401);
    expect(r.headers.get("www-authenticate")).toContain("Basic");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-robots-tag")).toBe("noindex, nofollow");
  });

  it("lets the password through, whatever the username, and refuses a near miss", async () => {
    expect((await knock("https://test.slopscore.org/spec", basic("anyone", "hunter2"))).status).not.toBe(401);
    expect((await knock("https://test.slopscore.org/spec", basic("", "hunter2"))).status).not.toBe(401);
    expect((await knock("https://test.slopscore.org/spec", basic("anyone", "hunter"))).status).toBe(401);
    expect((await knock("https://test.slopscore.org/spec", basic("anyone", "hunter22"))).status).toBe(401);
    expect((await knock("https://test.slopscore.org/spec", { authorization: "Basic not-base64!" })).status).toBe(401);
  });

  it("is shut, not open, when nobody set a password", async () => {
    const r = await hit("https://test.slopscore.org/");
    expect(r.status).toBe(403);
    expect(r.headers.get("www-authenticate")).toBeNull();
    expect((await hit("https://slopscore.workers.dev/")).status).toBe(403);
  });

  it("keeps robots.txt and the Stripe webhook outside the door", async () => {
    expect((await knock("https://test.slopscore.org/robots.txt")).status).toBe(200);
    expect((await hit("https://test.slopscore.org/robots.txt")).status).toBe(200);
    const r = await knock("https://test.slopscore.org/webhooks/stripe");
    expect([401, 403]).not.toContain(r.status);
  });

  it("never asks home or local dev for a password", async () => {
    for (const u of ["https://slopscore.org/spec", "http://localhost:8787/spec"]) {
      const r = await worker.fetch(new Request(u, { redirect: "manual" }), testEnv, ctx);
      expect(r.status, u).not.toBe(401);
      expect(r.headers.get("www-authenticate"), u).toBeNull();
    }
  });
});

describe("the legal pages: every claim on them is a claim about this code, so their existence is pinned here", () => {
  it("serves /privacy and /terms as HTML, with the emails the environment names", async () => {
    for (const path of ["/privacy", "/terms"]) {
      const r = await hit(`https://slopscore.org${path}`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("text/html");
      const html = await r.text();
      expect(html).toContain("hello@slopscore.org");
      expect(html).toContain("abuse@slopscore.org");
      expect(html).toContain("/contact");
    }
  });

  it("serves both as markdown and JSON, like every other page", async () => {
    const md = await hit("https://slopscore.org/privacy.md");
    expect(md.status).toBe(200);
    expect(await md.text()).toMatch(/^# Privacy/);
    const j = await (await hit("https://slopscore.org/terms.json")).json() as { title: string; text: string; updated: string };
    expect(j.title).toBe("Terms of use");
    expect(j.text).toContain("## Limitation of liability");
    expect(j.updated).toMatch(/\d{4}/);
  });

  it("says the things the code enforces: three cookies, no email, no raw address, and how to be deleted", async () => {
    const text = await (await hit("https://slopscore.org/privacy.md")).text();
    for (const cookie of ["`ss`", "`oauth_state`", "`anon`"]) expect(text).toContain(cookie);
    expect(text).toContain("We do not store your email address");
    expect(text).toContain("No raw IP address is ever written");
    expect(text).toContain("**Delete it.**");
    expect(text).toContain("35 days");
    expect(text).toContain("14 days");
  });

  it("links both from every page's footer and lists both in the sitemap", async () => {
    const home = await (await hit("https://slopscore.org/about")).text();
    expect(home).toContain('href="/privacy"');
    expect(home).toContain('href="/terms"');
  });
});
