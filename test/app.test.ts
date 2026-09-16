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
