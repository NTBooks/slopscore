// The sea against a real D1: the upsert and the nightly GROUP BY are SQL, and no unit test of the pure
// halves can tell whether the statements run. This one applies every migration to the pool's local
// database, writes a few sightings, refreshes one, counts the lot, and reads the dashboard back.
/// <reference types="@cloudflare/vitest-pool-workers/types" />
/// <reference types="vite/client" />
import { describe, it, expect, beforeAll } from "vitest";
import { env } from "cloudflare:test";
import type { GhRepo } from "../src/lib/github";
import type { Env } from "../src/env";
import { seenRow } from "../src/lib/seen";
import { upsert } from "../src/jobs/seen";
import { loadTrends, snapshotTrends } from "../src/jobs/trends";
import { Trends, trendsMd } from "../src/views/trends";
import { TRAWL_QUERIES } from "../src/lib/virtual";

const migrations = import.meta.glob("../migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

const AT = Date.parse("2026-09-18T00:00:00Z") / 1000;
const DAY = 86400;
const repo = (over: Partial<GhRepo> = {}): GhRepo => ({
  id: 1, full_name: "alice/one", name: "one", owner: { login: "alice", id: 70, type: "User", avatar_url: "" },
  description: "A weather widget, vibe coded", homepage: null, topics: ["vibe-coded"],
  language: "TypeScript", license: { spdx_id: "MIT", key: "mit" }, stargazers_count: 3, forks_count: 0, watchers_count: 3, open_issues_count: 0, size: 250,
  created_at: new Date((AT - 40 * DAY) * 1000).toISOString(), pushed_at: new Date((AT - 2 * DAY) * 1000).toISOString(), updated_at: new Date((AT - 2 * DAY) * 1000).toISOString(),
  archived: false, disabled: false, fork: false, private: false, default_branch: "main", ...over,
});
const sight = (g: GhRepo, at = AT) => seenRow(g, { at, qi: 0, nq: TRAWL_QUERIES.length, query: TRAWL_QUERIES[0], deny: [] });

const db = (env as unknown as { DB: D1Database }).DB;

/** A migration file as statements: comments off, split on the semicolon, trigger bodies (BEGIN … END) kept whole. */
export function statementsOf(sql: string): string[] {
  const out: string[] = [];
  let buf = "";
  for (const piece of sql.replace(/--[^\n]*/g, "").split(";")) {
    buf += (buf ? ";" : "") + piece;
    const open = /\bBEGIN\b/i.test(buf) && !/\bEND\s*$/i.test(buf.trim());
    if (open) continue;
    if (buf.trim()) out.push(buf.trim());
    buf = "";
  }
  return out;
}

beforeAll(async () => {
  for (const file of Object.keys(migrations).sort()) {
    for (const stmt of statementsOf(migrations[file])) await db.prepare(stmt).run();
  }
});

describe("sightings in a real table", () => {
  it("writes, refreshes the facts on a second pass, and keeps the first sighting's provenance", async () => {
    await db.batch([
      upsert(db, sight(repo())),
      upsert(db, sight(repo({ id: 2, full_name: "bob/zero", name: "zero", owner: { login: "bob", id: 71, type: "User", avatar_url: "" }, stargazers_count: 0, license: null, size: 12, created_at: new Date((AT - 3 * DAY) * 1000).toISOString(), pushed_at: new Date((AT - 3 * DAY + 600) * 1000).toISOString() }))),
      upsert(db, sight(repo({ id: 3, full_name: "acme/org", name: "org", owner: { login: "acme", id: 72, type: "Organization", avatar_url: "" }, stargazers_count: 40, language: "Python" }))),
    ]);
    const before = await db.prepare("SELECT first_seen, last_seen, stars, sieve FROM trawl_seen WHERE full_name = 'alice/one'").first<{ first_seen: number; last_seen: number; stars: number; sieve: string }>();
    expect(before).toMatchObject({ first_seen: AT, last_seen: AT, stars: 3, sieve: "candidate" });

    await upsert(db, sight(repo({ stargazers_count: 9 }), AT + DAY)).run();
    const after = await db.prepare("SELECT first_seen, last_seen, stars FROM trawl_seen WHERE full_name = 'alice/one'").first<{ first_seen: number; last_seen: number; stars: number }>();
    expect(after).toEqual({ first_seen: AT, last_seen: AT + DAY, stars: 9 });

    const zero = await db.prepare("SELECT stars, license, sieve, size_kb FROM trawl_seen WHERE full_name = 'bob/zero'").first<{ stars: number; license: string | null; sieve: string; size_kb: number }>();
    expect(zero).toMatchObject({ stars: 0, license: null, size_kb: 12 });
    expect(zero?.sieve).toMatch(/license none/); // the licence rule comes before the star rule in the trough's order
    expect((await db.prepare("SELECT count(*) AS n FROM trawl_seen").first<{ n: number }>())?.n).toBe(3);
  });

  it("counts the sea nightly, in buckets, and the dashboard reads it back", async () => {
    const at = AT + 2 * DAY;
    const r = await snapshotTrends({ DB: db } as unknown as Env, at);
    expect(r.rows).toBeGreaterThan(0);
    const rows = (await db.prepare("SELECT metric, period, key, n FROM trends_daily WHERE cohort = 'seen' AND date = ?").bind(new Date(at * 1000).toISOString().slice(0, 10)).all<{ metric: string; period: string; key: string; n: number }>()).results ?? [];
    const of = (metric: string) => Object.fromEntries(rows.filter((x) => x.metric === metric && !x.period).map((x) => [x.key, x.n]));
    expect(of("totals")).toEqual({ seen: 3, owners: 3, new_30d: 3, unstarred: 1, unlicensed: 1, candidates: 1 });
    expect(of("stars")).toEqual({ "no stars": 1, "5 to 9": 1, "25 to 99": 1 });
    expect(of("licence")).toEqual({ permissive: 2, "no licence": 1 });
    expect(of("owner")).toEqual({ "a person": 2, "an organisation": 1 });
    expect(of("language")).toEqual({ typescript: 2, python: 1 });
    expect(of("sieve")).toMatchObject({ "would reach the judge": 1, "a licence we cannot quote from": 1, "owned by an org, so nobody could claim or remove it": 1 });
    expect(of("life")).toEqual({ "one push and gone": 1, "one to three months": 2 }); // created 40 days back, pushed 2 days back
    expect(of("size")).toEqual({ "under 100 KB": 1, "100 KB to 1 MB": 2 });
    expect(of("ground")).toEqual({ "The Vibe Banks": 3 });
    expect(of("signal")).toEqual({ "vibe-coded": 3 });
    const born = rows.filter((x) => x.metric === "born_w");
    expect(born.length).toBeGreaterThanOrEqual(12);
    expect(born.reduce((s, x) => s + x.n, 0)).toBe(3);

    const view = await loadTrends(db);
    expect(view?.sea?.totals.seen).toBe(3);
    expect(view?.sea?.stars.map((b) => b.key)).toEqual(["no stars", "5 to 9", "25 to 99"]);
    expect(view?.sea?.born_w).toHaveLength(born.length);
    expect(trendsMd(view!)).toContain("3 repos seen in the last 90 days");
    // The page itself: the section renders, in its own colour, with the four headline numbers.
    const html = String(Trends({ d: view! }));
    expect(html).toContain('id="sea"');
    expect(html).toContain("bars seen");
    expect(html).toContain("would reach the judge");
    expect(html).toContain('href="#sea"');
  });

  it("leaves a repo behind once it falls out of the window", async () => {
    const r = await snapshotTrends({ DB: db } as unknown as Env, AT + 200 * DAY);
    expect(r.rows).toBeGreaterThan(0);
    const seen = await db.prepare("SELECT n FROM trends_daily WHERE cohort = 'seen' AND metric = 'totals' AND key = 'seen' AND date = ?").bind(new Date((AT + 200 * DAY) * 1000).toISOString().slice(0, 10)).first<{ n: number }>();
    expect(seen).toBeNull(); // no sea rows at all: the snapshot says null, not zero, and the page draws nothing
  });
});
