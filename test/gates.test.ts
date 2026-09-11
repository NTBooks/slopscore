import { describe, it, expect } from "vitest";
import { denylistGate, extractLinks } from "../src/lib/denylist";
import { riskScore } from "../src/lib/risk";
import { findSecrets, judgeGuard, estimateGuardNeurons } from "../src/lib/content";
import { nextInterval } from "../src/lib/scan";
import { isoWeek } from "../src/jobs/awards";
import type { GhRepo } from "../src/lib/github";

const repo = (over: Partial<GhRepo> = {}): GhRepo => ({
  id: 1, full_name: "a/b", name: "b", owner: { login: "a", id: 1, type: "User", avatar_url: "" }, description: "d", homepage: null,
  language: "TypeScript", license: null, stargazers_count: 3, forks_count: 0, watchers_count: 0, open_issues_count: 0, size: 10,
  created_at: new Date(Date.now() - 100 * 86400e3).toISOString(), pushed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  archived: false, disabled: false, fork: false, private: false, default_branch: "main", ...over,
});

describe("gate 0: denylist + links", () => {
  it("rejects shortener, IP, and executable links; flags invites", () => {
    const r = denylistGate("nice tool", "see https://bit.ly/x and http://10.0.0.1/a and https://ok.example.com/setup.exe and https://discord.gg/abc", []);
    expect(r.reject.join(" ")).toMatch(/bit\.ly/);
    expect(r.reject.join(" ")).toMatch(/IP address/);
    expect(r.reject.join(" ")).toMatch(/executable/);
    expect(r.flags).toContain("chat invite link");
    expect(r.links.length).toBe(4);
  });
  it("admin slur terms reject in short fields but only flag in long text", () => {
    const rows = [{ term: "badword", kind: "slur" as const, scope: "title" as const }];
    expect(denylistGate("a badword tool", "", rows).reject.length).toBe(1);
    const r = denylistGate("a tool", "the readme says badword once", rows);
    expect(r.reject.length).toBe(0);
    expect(r.flags.join(" ")).toMatch(/prohibited term in body/);
  });
  it("spam phrases and crypto bait flag, profanity flags once", () => {
    const r = denylistGate("free robux generator", "guaranteed profit, airdrop now. shit happens. shit again.", []);
    expect(r.flags.some((f) => f.includes("spam phrase"))).toBe(true);
    expect(r.flags).toContain("crypto bait phrasing");
    expect(r.flags.filter((f) => f.startsWith("profanity")).length).toBe(1);
  });
  it("more than 30 links rejects", () => {
    const many = Array.from({ length: 31 }, (_, i) => `https://e${i}.example.com/`).join(" ");
    expect(denylistGate("t", many, []).reject.join(" ")).toMatch(/31 links/);
  });
  it("flags mixed-script titles", () => {
    expect(denylistGate("pаypal tool", "", []).flags).toContain("mixed-script title"); // Cyrillic а
  });
  it("extractLinks trims trailing punctuation", () => {
    expect(extractLinks("see https://x.example.com/a).")).toEqual(["https://x.example.com/a"]);
  });
});

describe("gate 2b: risk", () => {
  const base = { ownerCreatedAt: Math.floor(Date.now() / 1000) - 400 * 86400, ownerFollowers: 10, ownerPublicRepos: 5, commitCount: 20, languages: { TypeScript: 100 }, contents: [], readmeChars: 2000, denyFlags: [], title: "x", writeEligible: true, contentFlags: [] };
  it("is low for a normal repo", () => {
    expect(riskScore({ repo: repo(), ...base }).score).toBe(0);
  });
  it("quarantines the classic drive-by", () => {
    const r = riskScore({ repo: repo(), ...base, ownerCreatedAt: Math.floor(Date.now() / 1000) - 2 * 86400, ownerFollowers: 0, ownerPublicRepos: 1, commitCount: 1, contents: [{ name: "setup.exe", path: "setup.exe", sha: "", size: 5, type: "file" }], readmeChars: 50, writeEligible: false });
    expect(r.score).toBeGreaterThanOrEqual(40);
    expect(r.reasons.join(" ")).toMatch(/binaries at repo root/);
  });
  it("flags implausible stars", () => {
    const r = riskScore({ repo: repo({ stargazers_count: 5000, created_at: new Date(Date.now() - 86400e3).toISOString() }), ...base });
    expect(r.reasons.join(" ")).toMatch(/stars implausible/);
  });
});

describe("gate 3: content", () => {
  it("finds secrets", () => {
    expect(findSecrets("key AKIAABCDEFGHIJKLMNOP and ghp_" + "a".repeat(36))).toEqual(["AWS access key", "GitHub personal token"]);
    expect(findSecrets("nothing here")).toEqual([]);
  });
  it("Llama Guard categories map to disclosures", () => {
    const g = { ran: true, safe: false, categories: ["S12", "S6", "S8"], neurons: 100 };
    const undisclosed = judgeGuard(g, []);
    expect(undisclosed.reject.join(" ")).toMatch(/sexual content/);
    expect(undisclosed.flags.join(" ")).toMatch(/specialized advice/);
    expect(undisclosed.reject.join(" ")).not.toMatch(/intellectual/);
    const disclosed = judgeGuard({ ...g, categories: ["S6", "S2"] }, ["medical", "security-research"]);
    expect(disclosed.reject).toEqual([]);
    expect(disclosed.flags.length).toBe(2);
  });
  it("estimates neurons from text length with the cap", () => {
    expect(estimateGuardNeurons("a".repeat(100_000))).toBeLessThan(260);
    expect(estimateGuardNeurons("short")).toBeLessThan(5);
  });
});

describe("recrawl interval + awards week", () => {
  it("fresh pushes recrawl hourly, stale ones weekly, hot ones at most every 6h", () => {
    const t = Math.floor(Date.now() / 1000);
    expect(nextInterval(t, 0)).toBe(3600);
    expect(nextInterval(t - 60 * 86400, 0)).toBe(7 * 86400);
    expect(nextInterval(t - 60 * 86400, 5)).toBe(6 * 3600);
  });
  it("iso week", () => {
    expect(isoWeek(new Date(Date.UTC(2026, 0, 1)))).toBe("2026-W01");
    expect(isoWeek(new Date(Date.UTC(2026, 8, 7)))).toBe("2026-W37");
  });
});

describe("vision verdict parsing", async () => {
  const { parseVision, VISION_HARD } = await import("../src/lib/content");
  it("only hard categories reject; gross cartoons flag", () => {
    expect(parseVision("SAFE, a cartoon pig")).toEqual({ safe: true });
    expect(parseVision("UNSAFE other: looks like vomit")).toEqual({ safe: false, category: "other" });
    expect(parseVision("UNSAFE nudity, explicit")).toEqual({ safe: false, category: "nudity" });
    expect(VISION_HARD.has("other")).toBe(false);
    expect(VISION_HARD.has("gore")).toBe(true);
  });
});

describe("vote burst allowance", async () => {
  const { burstAllowance } = await import("../src/lib/views");
  it("never below the floor, half the visitors above it", () => {
    expect(burstAllowance(0)).toBe(10);
    expect(burstAllowance(18)).toBe(10);
    expect(burstAllowance(100)).toBe(50);
    expect(burstAllowance(1001)).toBe(500);
  });
});

describe("stripe signature helpers", async () => {
  const { hmacHex, timingSafeEqual } = await import("../src/routes/pay");
  it("hmac matches a known vector and compares in constant time", async () => {
    const h = await hmacHex("whsec_test", "1700000000.{\"id\":\"evt\"}");
    expect(h).toHaveLength(64);
    expect(timingSafeEqual(h, h)).toBe(true);
    expect(timingSafeEqual(h, h.slice(0, 63) + "0")).toBe(h.endsWith("0"));
    expect(timingSafeEqual("a", "ab")).toBe(false);
  });
});

describe("osv purl mapping", async () => {
  const { fromPurl } = await import("../src/lib/osv");
  it("maps common ecosystems and skips unknown or unversioned ones", () => {
    expect(fromPurl("pkg:npm/lodash@4.17.21")).toEqual({ ecosystem: "npm", name: "lodash", version: "4.17.21" });
    expect(fromPurl("pkg:npm/%40hono/zod-openapi@0.16.0")).toEqual({ ecosystem: "npm", name: "@hono/zod-openapi", version: "0.16.0" });
    expect(fromPurl("pkg:pypi/requests@2.31.0")).toEqual({ ecosystem: "PyPI", name: "requests", version: "2.31.0" });
    expect(fromPurl("pkg:maven/org.apache/log4j@2.14.1")).toEqual({ ecosystem: "Maven", name: "org.apache:log4j", version: "2.14.1" });
    expect(fromPurl("pkg:githubactions/actions/checkout@v4")).toBeNull();
    expect(fromPurl("pkg:npm/lodash")).toBeNull();
  });
});

describe("moderation flags", async () => {
  const { parseFlags, ALL_FLAGS } = await import("../src/lib/flags");
  it("defaults to all, supports lists, negations, all/none", () => {
    expect([...parseFlags(undefined)]).toEqual([...ALL_FLAGS]);
    expect([...parseFlags("all")]).toEqual([...ALL_FLAGS]);
    expect(parseFlags("none").size).toBe(0);
    expect([...parseFlags("weight, guard")]).toEqual(["weight", "guard"]);
    const noBurst = parseFlags("-burst,-crowd");
    expect(noBurst.has("burst")).toBe(false); expect(noBurst.has("crowd")).toBe(false); expect(noBurst.has("weight")).toBe(true);
    expect(parseFlags("bogus,weight").has("weight")).toBe(true);
  });
});
