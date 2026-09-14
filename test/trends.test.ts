import { describe, it, expect } from "vitest";
import {
  ageBucket, cohortOf, facetIsReal, monthsBack, netBucket, shapeTrends, starBucket, topN,
  CHART_FACETS, CLOUD_FACET, TEMPLATED_ON_TRAWL, type TrendRow,
} from "../src/jobs/trends";
import { JUDGE_CODES, JUDGE_DOMAINS, parseDomain, parseJudge } from "../src/lib/judge";
import { FACET_TITLE } from "../src/jobs/trends";
import { trendsMd } from "../src/views/trends";
import { MIN_STARS, MAX_STARS, PUSHED_WITHIN_DAYS } from "../src/lib/virtual";

const AT = Date.parse("2026-09-12T00:00:00Z") / 1000;
const row = (over: Partial<TrendRow>): TrendRow => ({ cohort: "trawl", metric: "language", period: "", key: "python", n: 1, mean_score: null, ...over });

describe("cohorts", () => {
  it("splits on how the repo got here, not on who submitted it", () => {
    expect(cohortOf("trawl")).toBe("trawl");
    expect(cohortOf("marker")).toBe("opted");
  });

  it("suppresses the facets a trawled listing only answers because the template said so", () => {
    // lib/virtual.ts writes ai_generated: mostly on every single trawled repo; charting it would be a lie.
    expect(facetIsReal("ai_generated", "trawl")).toBe(false);
    expect(facetIsReal("status", "trawl")).toBe(false);
    expect(facetIsReal("ai_generated", "opted")).toBe(true);
    // What GitHub tells us is equally true either way.
    for (const f of ["language", "topic", "license", "category", "built_with"]) expect(facetIsReal(f, "trawl")).toBe(true);
  });

  it("gives every charted facet a title and never templates one that isn't charted", () => {
    for (const f of CHART_FACETS) expect(FACET_TITLE[f]).toBeTruthy();
    for (const f of TEMPLATED_ON_TRAWL) expect(CHART_FACETS as readonly string[]).toContain(f);
  });
});

describe("buckets", () => {
  it("names the trawl's reject reasons in the words the funnel uses", () => {
    expect(netBucket("judge: tool-for-ai-coding")).toBe("a tool for people coding with AI");
    expect(netBucket("judge: list-or-template")).toBe("a list, guide or template");
    expect(netBucket("no past-tense claim that an AI tool wrote it")).toBe("never claims a model wrote it");
    expect(netBucket("license GPL-3.0 is not on the permissive list")).toBe("a licence we cannot quote from");
    expect(netBucket("denylist: spamword")).toBe("tripped the denylist");
    expect(netBucket("org-owned: nobody can log in as the repo owner")).toBe("owned by an org, so nobody can claim it");
  });

  it("folds an unknown judge answer in with the judge rather than inventing a category", () => {
    expect(netBucket("judge: openrouter 500")).toBe("the judge could not tell");
    expect(netBucket("something nobody has written yet")).toBe("something else");
  });

  it("refuses an age it cannot compute, including a listing older than its own repo", () => {
    expect(ageBucket(null, AT)).toBeNull();
    expect(ageBucket(AT, null)).toBeNull();
    expect(ageBucket(AT, AT - 86400)).toBeNull();
    expect(ageBucket(AT - 3 * 86400, AT)).toBe("under a week old");
    expect(ageBucket(AT - 200 * 86400, AT)).toBe("three months to a year");
    expect(ageBucket(AT - 800 * 86400, AT)).toBe("over a year old");
  });

  it("buckets stars across the trawl's own window", () => {
    expect(starBucket(0)).toBe("under 5");
    expect(starBucket(5)).toBe("5 to 9");
    expect(starBucket(1999)).toBe("500 or more");
  });
});

describe("the month axis", () => {
  it("ends on the current month and crosses a year boundary", () => {
    const m = monthsBack(AT, 12);
    expect(m).toHaveLength(12);
    expect(m[11]).toBe("2026-09");
    expect(m[0]).toBe("2025-10");
    expect([...m].sort()).toEqual(m); // oldest first
  });
});

describe("topN", () => {
  it("breaks ties by name so two identical nights produce identical snapshots", () => {
    const a = topN([{ key: "b", n: 3 }, { key: "a", n: 3 }, { key: "c", n: 9 }], 2);
    const b = topN([{ key: "a", n: 3 }, { key: "c", n: 9 }, { key: "b", n: 3 }], 2);
    expect(a).toEqual(b);
    expect(a.map((x) => x.key)).toEqual(["c", "a"]);
  });
});

describe("shapeTrends", () => {
  const rows: TrendRow[] = [
    row({ cohort: "trawl", metric: "totals", key: "listed", n: 200 }),
    row({ cohort: "opted", metric: "totals", key: "listed", n: 50 }),
    row({ cohort: "trawl", metric: "language", key: "python", n: 80 }),
    row({ cohort: "trawl", metric: "language", key: "typescript", n: 40 }),
    row({ cohort: "opted", metric: "language", key: "typescript", n: 30 }),
    row({ cohort: "opted", metric: "ai_generated", key: "mostly", n: 20 }),
    row({ cohort: "trawl", metric: "listings", period: "2026-08", key: "listed", n: 12 }),
    row({ cohort: "opted", metric: "listings", period: "2026-08", key: "listed", n: 3 }),
    row({ cohort: "trawl", metric: "listings", period: "2026-09", key: "listed", n: 7 }),
    row({ cohort: "trawl", metric: "tool", period: "2026-08", key: "claude-code", n: 9 }),
    row({ cohort: "opted", metric: "tool", period: "2026-08", key: "claude-code", n: 1 }),
    row({ cohort: "trawl", metric: "tool", period: "2026-08", key: "other", n: 30 }),
    row({ cohort: "trawl", metric: "tool", period: "2026-09", key: "cursor", n: 2 }),
    row({ cohort: "trawl", metric: "net", key: "a list, guide or template", n: 40 }),
    row({ cohort: "trawl", metric: "net", key: "tripped the denylist", n: 4 }),
    row({ cohort: "opted", metric: "turned-away", key: "contract", n: 6 }),
    row({ cohort: "trawl", metric: "stars", key: "100 to 499", n: 10 }),
    row({ cohort: "trawl", metric: "stars", key: "5 to 9", n: 90 }),
    row({ cohort: "trawl", metric: "topic", key: "nextjs", n: 60 }),
    row({ cohort: "trawl", metric: "topic", key: "aardvark", n: 1 }),
    row({ cohort: "opted", metric: "topic", key: "nextjs", n: 5 }),
    row({ cohort: "listed", metric: "use", key: "productivity", n: 12 }),
    row({ cohort: "thrown-back", metric: "use", key: "productivity", n: 30 }),
    row({ cohort: "thrown-back", metric: "use", key: "dev-tools", n: 40 }),
    row({ cohort: "listed", metric: "verdict", key: "app", n: 12 }),
    row({ cohort: "thrown-back", metric: "verdict", key: "list-or-template", n: 70 }),
  ];
  const d = shapeTrends("2026-09-12", rows);

  it("sizes each bar against the biggest in its own chart, not across cohorts", () => {
    const lang = d.facets.find((f) => f.facet === "language")!;
    expect(lang.trawl.map((b) => b.key)).toEqual(["python", "typescript"]);
    expect(lang.trawl[0].share).toBe(1);
    expect(lang.trawl[1].share).toBe(0.5);
    expect(lang.opted[0].share).toBe(1); // 30 is the whole of the opted-in chart
  });

  it("drops a facet nobody has any values for, and keeps one only the opted-in column answers", () => {
    expect(d.facets.map((f) => f.facet)).toContain("ai_generated");
    expect(d.facets.find((f) => f.facet === "ai_generated")!.trawl).toEqual([]);
    expect(d.facets.map((f) => f.facet)).not.toContain("domain");
  });

  it("sums both cohorts into the monthly listings and keeps the months in order", () => {
    expect(d.listings).toEqual([
      { period: "2026-08", trawl: 12, opted: 3, total: 15 },
      { period: "2026-09", trawl: 7, opted: 0, total: 7 },
    ]);
  });

  it("adds the tool series across cohorts and sorts 'other' last however big it is", () => {
    expect(d.tools.keys).toEqual(["claude-code", "cursor", "other"]);
    const aug = d.tools.months.find((m) => m.period === "2026-08")!;
    expect(aug.total).toBe(40);
    expect(aug.parts.map((p) => p.key)).toEqual(["claude-code", "other"]);
    expect(aug.parts[0].n).toBe(10); // both cohorts
    expect(aug.parts[0].share).toBeCloseTo(0.25);
  });

  it("puts a bucketed axis in its natural order rather than by size", () => {
    expect(d.stars.trawl.map((b) => b.key)).toEqual(["5 to 9", "100 to 499"]);
  });

  it("keeps the funnels apart", () => {
    expect(d.net[0].key).toBe("a list, guide or template");
    expect(d.turned_away.map((b) => b.key)).toEqual(["contract"]);
  });

  it("renders as markdown that says what the sample is and never charts the template", () => {
    const md = trendsMd(d);
    expect(md).toMatch(/# Trends/);
    expect(md).toMatch(/Snapshot 2026-09-12/);
    expect(md).toMatch(/no model is called/i);
    expect(md).toMatch(/- python: 80 \(40%\)/);
    // ai_generated is a template line on a trawled repo, so it is quarantined into its own section and the
    // trawled column is never printed for it.
    expect(md).toMatch(/## Questions only the paperwork can answer/);
    expect(md).toMatch(/### How much of it a model wrote \(ai_generated\)/);
    expect(md.split("## Questions only the paperwork can answer")[0]).not.toMatch(/ai_generated/);
  });

  it("draws topics as a cloud instead of a bar pair, tail and all", () => {
    // A cloud that only holds the top ten is a bar chart in fancy dress; the rare terms are the point.
    expect(d.facets.map((f) => f.facet)).not.toContain(CLOUD_FACET);
    expect(d.cloud.trawl.map((b) => b.key)).toEqual(["nextjs", "aardvark"]);
    expect(d.cloud.opted[0].n).toBe(5);
  });

  it("adds the judge's two sides together and keeps each n in reach", () => {
    expect(d.use.n_listed).toBe(12);
    expect(d.use.n_thrown_back).toBe(70);
    expect(d.use.all.map((b) => [b.key, b.n])).toEqual([["productivity", 42], ["dev-tools", 40]]);
    expect(d.verdict.all.map((b) => b.key)).toEqual(["list-or-template", "app"]);
  });
});

describe("the judge's verdict", () => {
  it("reads a domain only when it is one of the listed ones", () => {
    expect(parseDomain('{"code":"app","domain":"productivity"}')).toBe("productivity");
    expect(parseDomain('{"code":"app","domain":"PRODUCTIVITY"}')).toBe("productivity");
    expect(parseDomain('{"code":"app","domain":"vibes"}')).toBeNull();
    expect(parseDomain('{"code":"app"}')).toBeNull();
    // No regex fallback: a malformed answer must never put a stranger's words on a chart.
    expect(parseDomain("the domain is productivity")).toBeNull();
    expect(parseDomain(null)).toBeNull();
  });

  it("still gates on the code alone, whatever the domain says", () => {
    expect(parseJudge('{"code":"list-or-template","domain":"games-and-toys"}')).toBe("list-or-template");
    expect(parseJudge('{"code":"nonsense","domain":"finance"}')).toBeNull();
  });

  it("keeps both vocabularies closed and free of duplicates", () => {
    expect(new Set(JUDGE_DOMAINS).size).toBe(JUDGE_DOMAINS.length);
    expect(JUDGE_DOMAINS).toContain("other");
    expect(JUDGE_DOMAINS.every((d) => /^[a-z][a-z-]*[a-z]$/.test(d))).toBe(true);
    expect(JUDGE_CODES.some((c) => (JUDGE_DOMAINS as readonly string[]).includes(c))).toBe(false);
  });
});

describe("an empty site", () => {
  it("shapes into something the page can draw rather than throwing", () => {
    const d = shapeTrends("2026-09-12", []);
    expect(d.facets).toEqual([]);
    expect(d.listings).toEqual([]);
    expect(d.tools.keys).toEqual([]);
    expect(d.cloud.trawl).toEqual([]);
    expect(d.use.all).toEqual([]);
    expect(d.use.n_listed).toBe(0);
    expect(d.totals.trawl).toEqual({});
    expect(trendsMd(d)).toMatch(/# Trends/);
  });
});

describe("the sample's small print", () => {
  it("quotes the window the trawl actually filters on, not a number somebody typed", () => {
    const md = trendsMd(shapeTrends("2026-09-12", []));
    expect(md).toContain(`${MIN_STARS}-${MAX_STARS} stars, pushed within ${PUSHED_WITHIN_DAYS} days`);
  });
});
