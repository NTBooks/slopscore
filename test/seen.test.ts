import { describe, it, expect } from "vitest";
import type { GhRepo } from "../src/lib/github";
import {
  SEEN_BASE, SEEN_FACTS, SEEN_NOT, SEEN_STAR_ORDER, LIFE_ORDER, LIFE_SQL, SIZE_ORDER, SIZE_SQL, LICENCE_ORDER, OWNER_ORDER,
  licenceClass, lifeBucket, ownerClass, seenQueryList, seenRow, seenSieve, seenStarBucket, signalOf, sizeBucket, toolNamed,
} from "../src/lib/seen";
import { TRAWL_QUERIES, trawlQueries, trawlQueryList } from "../src/lib/virtual";
import { seenCap, trawlAtSea, SEEN_CALLS, SEEN_PER_DAY, SEEN_QUERIES_PER_RUN } from "../src/jobs/seen";
import { netBucket, sieveBucket } from "../src/jobs/trends";
import { CRON_JOBS, JOBS, JOB_INFO } from "../src/lib/crawlclock";
import type { ToolRow } from "../src/lib/tools";

const AT = Date.parse("2026-09-18T00:00:00Z") / 1000;
const repo = (over: Partial<GhRepo> = {}): GhRepo => ({
  id: 7, full_name: "Alice/SnackBot", name: "SnackBot", owner: { login: "Alice", id: 70, type: "User", avatar_url: "" },
  description: "A snack-ordering Discord bot, vibe coded over a weekend", homepage: null, topics: ["discord-bot", "vibe-coded", "claude-code"],
  language: "TypeScript", license: { spdx_id: "MIT", key: "mit" }, stargazers_count: 14, forks_count: 1, watchers_count: 14, open_issues_count: 2, size: 340,
  created_at: "2026-06-01T00:00:00Z", pushed_at: "2026-09-10T00:00:00Z", updated_at: "2026-09-10T00:00:00Z",
  archived: false, disabled: false, fork: false, private: false, default_branch: "main", ...over,
});
const sight = (g: GhRepo, deny: { term: string; kind: "slur" | "spam" | "domain"; scope: "title" | "any" }[] = []) =>
  seenRow(g, { at: AT, qi: 0, nq: TRAWL_QUERIES.length, query: TRAWL_QUERIES[0], deny });

describe("the sea's searches", () => {
  it("are the trough's searches with the star clause and the push clause taken off, in the same order", () => {
    const seen = seenQueryList();
    expect(seen).toHaveLength(TRAWL_QUERIES.length);
    seen.forEach((q, i) => {
      expect(q.startsWith(TRAWL_QUERIES[i])).toBe(true);
      expect(q).toContain(SEEN_BASE);
      expect(q).not.toMatch(/stars:/);
      expect(q).not.toMatch(/pushed:/);
    });
    // The trough's own searches do carry the clause; that is the difference between the two cohorts.
    expect(trawlQueries(AT)[0]).toMatch(/stars:1\.\.2000/);
  });

  it("follows the registry the way the trough does, so an approved tool is sounded from the next run", () => {
    const kiro: ToolRow = { key: "kiro", name: "Kiro", aliases: ["kiro"], claim_topics: ["built-with-kiro"], topics: ["kiro"], phrases: ['"built with kiro" in:description'], note: null, approved_by: "NTBooks", approved_at: 1, retired_at: null };
    const seen = seenQueryList([kiro]);
    expect(seen).toHaveLength(trawlQueryList([kiro]).length);
    expect(seen.at(-1)).toBe(`"built with kiro" in:description ${SEEN_BASE}`);
  });
});

describe("a sighting", () => {
  it("keeps the facts, lowercases the key, and keeps nothing a stranger wrote", () => {
    const r = sight(repo({ stargazers_count: 0, homepage: "https://snack.example" }));
    expect(r.full_name).toBe("alice/snackbot");
    expect(r.repo_id).toBe(7);
    expect(r.ground).toBe(0);
    expect(r.query).toBe(TRAWL_QUERIES[0]);
    expect(r).toMatchObject({ stars: 0, forks: 1, size_kb: 340, open_issues: 2, language: "TypeScript", license: "MIT", owner_type: "User", described: 1, topics_n: 3, homepage: 1 });
    expect(r.created_at).toBe(Date.parse("2026-06-01T00:00:00Z") / 1000);
    expect(r.pushed_at).toBe(Date.parse("2026-09-10T00:00:00Z") / 1000);
    expect(r.tool).toBe("claude-code");
    expect(r.signal).toBe("vibe-coded");
    expect(Object.keys(r)).not.toContain("description");
    expect(JSON.stringify(r)).not.toContain("snack-ordering");
  });

  it("records the absence of a licence and a description as facts, not as blanks", () => {
    const r = sight(repo({ license: null, description: "   ", homepage: "" }));
    expect(r.license).toBeNull();
    expect(r.described).toBe(0);
    expect(r.homepage).toBe(0);
    expect(r.signal).toBe("topic"); // the vibe-coded topic still says so
  });

  it("says what the trough would have done, in the trough's order", () => {
    expect(seenSieve(repo(), { deny: [], at: AT })).toBe("candidate");
    expect(seenSieve(repo({ stargazers_count: 0 }), { deny: [], at: AT })).toMatch(/fewer than 1 stars/);
    expect(seenSieve(repo({ license: null }), { deny: [], at: AT })).toMatch(/license none/);
    expect(seenSieve(repo({ owner: { ...repo().owner, type: "Organization" } }), { deny: [], at: AT })).toMatch(/org-owned/);
    // An org repo with no stars is stopped by the org rule: the column is the first rule in the trough's order, not a ranking.
    expect(seenSieve(repo({ stargazers_count: 0, owner: { ...repo().owner, type: "Organization" } }), { deny: [], at: AT })).toMatch(/org-owned/);
    expect(seenSieve(repo({ topics: [], description: "A Discord bot" }), { deny: [], at: AT })).toMatch(/no vibe-coded signal/);
    expect(seenSieve(repo({ fork: true }), { deny: [], at: AT })).toMatch(/fork/);
  });

  it("keeps the fact of a denylist hit and drops the term", () => {
    const r = sight(repo({ description: "A badword bot, vibe coded" }), [{ term: "badword", kind: "slur", scope: "any" }]);
    expect(r.sieve).toBe("denylist");
    expect(JSON.stringify(r)).not.toContain("badword");
  });

  it("reads the tool and the claim shape the way a listing would", () => {
    expect(toolNamed(repo({ topics: [], description: "Built with Cursor over a weekend" }))).toBe("cursor");
    expect(toolNamed(repo({ topics: ["built-with-claude-code"], description: "x" }))).toBe("claude-code");
    expect(toolNamed(repo({ topics: [], description: "plain" }))).toBeNull();
    expect(signalOf(repo({ topics: [], description: "Built with Cursor" }))).toBe("built-with");
    expect(signalOf(repo({ topics: ["ai-generated"], description: "x" }))).toBe("topic");
    expect(signalOf(repo({ topics: [], description: "An AI-generated tool" }))).toBe("ai-generated");
    expect(signalOf(repo({ topics: [], description: "nothing" }))).toBeNull();
  });

  it("lists what it keeps and what it refuses, for the method page", () => {
    expect(SEEN_FACTS.length).toBeGreaterThanOrEqual(6);
    expect(SEEN_NOT).toContain("the README");
    expect(SEEN_NOT).toContain("the description");
  });
});

describe("the buckets the sea is drawn in", () => {
  it("give zero stars a bar of its own", () => {
    expect(seenStarBucket(0)).toBe("no stars");
    expect(seenStarBucket(1)).toBe("1 to 4");
    expect(seenStarBucket(4)).toBe("1 to 4");
    expect(seenStarBucket(24)).toBe("10 to 24");
    expect(seenStarBucket(600)).toBe("500 or more");
    expect(SEEN_STAR_ORDER[0]).toBe("no stars");
    for (const s of [0, 1, 7, 12, 60, 200, 5000]) expect(SEEN_STAR_ORDER).toContain(seenStarBucket(s));
  });

  it("classes a licence by whether the site could quote from it, and NOASSERTION as a licence it cannot name", () => {
    expect(licenceClass(null)).toBe("no licence");
    expect(licenceClass("MIT")).toBe("permissive");
    expect(licenceClass("GPL-3.0")).toBe("another licence");
    expect(licenceClass("NOASSERTION")).toBe("another licence");
    for (const k of ["MIT", "GPL-3.0", null]) expect(LICENCE_ORDER).toContain(licenceClass(k));
    expect(ownerClass("Organization")).toBe("an organisation");
    expect(ownerClass("User")).toBe("a person");
    expect(OWNER_ORDER).toHaveLength(2);
  });

  it("calls one push inside a day a stub, and keeps the SQL in step with the JS", () => {
    expect(lifeBucket(AT, AT + 3600)).toBe("one push and gone");
    expect(lifeBucket(AT, AT + 3 * 86400)).toBe("under a week");
    expect(lifeBucket(AT, AT + 10 * 86400)).toBe("a week to a month");
    expect(lifeBucket(AT, AT + 200 * 86400)).toBe("over three months");
    expect(lifeBucket(AT, AT - 5)).toBe("one push and gone"); // clock skew never makes a negative life
    expect(sizeBucket(12)).toBe("under 100 KB");
    expect(sizeBucket(500)).toBe("100 KB to 1 MB");
    expect(sizeBucket(20000)).toBe("over 10 MB");
    for (const k of LIFE_ORDER) expect(LIFE_SQL).toContain(`'${k}'`);
    for (const k of SIZE_ORDER) expect(SIZE_SQL).toContain(`'${k}'`);
  });

  it("names the sieve in the funnel's words", () => {
    expect(sieveBucket("candidate")).toBe("would reach the judge");
    expect(sieveBucket("fewer than 1 stars")).toBe("outside the star window");
    expect(sieveBucket("no vibe-coded signal in topics or description")).toBe("no claim in its topics or description");
    expect(sieveBucket("license none is not on the permissive list")).toBe("a licence we cannot quote from");
    expect(sieveBucket("org-owned: nobody can log in as the repo owner")).toBe("owned by an org, so nobody could claim or remove it");
    expect(sieveBucket("denylist")).toBe("tripped the denylist");
    expect(netBucket("private, fork, archived, disabled or template")).toBe("a fork, an archive or a template");
    expect(netBucket("no description")).toBe("no description to quote");
  });
});

describe("the sounding's place in the rota", () => {
  it("rides the ten-minute tick, never the trawl's minute, and is on the clock", () => {
    expect(CRON_JOBS["*/10 * * * *"]).toContain("seen");
    expect(CRON_JOBS["7 * * * *"]).not.toContain("seen");
    expect(CRON_JOBS["*/5 * * * *"]).not.toContain("seen");
    expect(JOBS).toContain("seen");
    expect(JOB_INFO.seen.does).toMatch(/search response/);
  });

  it("stays in while the trawl holds its lease", () => {
    expect(trawlAtSea(String(AT + 60), AT)).toBe(true);
    expect(trawlAtSea(String(AT - 1), AT)).toBe(false);
    expect(trawlAtSea(null, AT)).toBe(false);
    expect(trawlAtSea("junk", AT)).toBe(false);
  });

  it("reads its daily cap from the environment, treats zero as a pause, and stays under the search minute", () => {
    expect(seenCap({})).toBe(SEEN_PER_DAY);
    expect(seenCap({ SEEN_PER_DAY: "0" })).toBe(0);
    expect(seenCap({ SEEN_PER_DAY: "x" })).toBe(SEEN_PER_DAY);
    expect(SEEN_CALLS).toBeLessThan(30);
    expect(SEEN_QUERIES_PER_RUN).toBeGreaterThan(0);
  });
});
