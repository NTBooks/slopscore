import { describe, it, expect } from "vitest";
import { CHANGES, LISTABLE_CODES, METHOD_FROZEN, METHOD_VERSION, methodJson, methodMd, toolAdditions } from "../src/lib/method";
import { STATIC_TOOLS, type ToolRow } from "../src/lib/tools";

const KIRO: ToolRow = { key: "kiro", name: "Kiro", aliases: ["kiro"], claim_topics: ["built-with-kiro"], topics: ["kiro"], phrases: [], note: "Amazon's agentic IDE.", approved_by: "NTBooks", approved_at: Date.parse("2026-09-20T10:00:00Z") / 1000, retired_at: null };
const META: ToolRow = { key: "muse-code", name: "Muse Code", aliases: ["meta ai studio"], claim_topics: [], topics: ["meta-ai"], phrases: [], note: null, approved_by: "NTBooks", approved_at: Date.parse("2026-09-21T10:00:00Z") / 1000, retired_at: Date.parse("2026-09-22T10:00:00Z") / 1000 };

describe("the tool dictionary on the method page", () => {
  it("is frozen at v2's sixteen and says so, with the rule that it grows by approval", () => {
    expect(methodJson().tools.frozen).toEqual(STATIC_TOOLS.map((t) => t.key));
    expect(methodJson().tools.added).toEqual([]);
    expect(methodMd()).toContain("## The tools");
    expect(methodMd()).toContain("None yet. The scout proposes");
    expect(CHANGES.find((c) => c.version === 3)?.what).toMatch(/does not bump the version/);
  });
});

describe("the sea on the method page", () => {
  it("is the fourth version, a third cohort, and a rule change the trough did not make", () => {
    expect(METHOD_VERSION).toBe(4);
    expect(CHANGES[0].what).toMatch(/trough's rules do not change/);
    const md = methodMd();
    expect(md).toContain("## Three samples, never mixed");
    expect(md).toContain("- **Seen.**");
    expect(md).toContain("## The sea");
    expect(md).toContain("no star clause");
    expect(md).toContain("Nothing in it is read, judged or listed");
    // The sea's own biases sit beside the others, and the star floor is now called what it is.
    expect(md).toContain("the floor is most of the population");
    expect(md).toContain("**The sea is search-shaped too.**");
    expect(md).toContain("**A sea row is a sighting, not a repo.**");
    const j = methodJson();
    expect(j.cohorts.seen).toMatch(/any star count/);
    expect(j.sea).toMatchObject({ stars: "any", licenses: "any", owners: "any", read: false, judged: false, listed: false, named: false });
    expect(j.sea.records.length).toBeGreaterThanOrEqual(6);
    expect(j.known_biases.length).toBeGreaterThanOrEqual(8);
  });
  it("lists every addition with its date, who approved it, whether it widened a frozen tool, and a retirement", () => {
    const md = methodMd([META, KIRO]);
    expect(md).toContain("- **kiro** (Kiro) · 2026-09-20 · approved by NTBooks — Amazon's agentic IDE.");
    expect(md).toContain("- **muse-code** (Muse Code) · 2026-09-21 · approved by NTBooks · widens a frozen tool · retired 2026-09-22");
    expect(md.indexOf("**kiro**")).toBeLessThan(md.indexOf("**muse-code** (Muse Code) · 2026-09-21"));
    expect(md).toContain("**The New Waters** — repos that name a tool the scout found and a moderator approved. Searches: `kiro`");
    const j = methodJson([META, KIRO]);
    expect(j.tools.added.map((a) => a.key)).toEqual(["kiro"]);
    expect(j.tools.retired.map((a) => a.key)).toEqual(["muse-code"]);
    expect(toolAdditions([KIRO])[0]).toMatchObject({ extends: false, approved_at: "2026-09-20" });
  });
});

import { MAX_STARS, MIN_STARS, PERMISSIVE, PUSHED_WITHIN_DAYS, TRAWL_GROUNDS } from "../src/lib/virtual";
import { JUDGE_CODES, judgeKeeps, type JudgeCode } from "../src/lib/judge";

describe("the method is versioned rather than edited", () => {
  it("has a dated line for every version, newest first", () => {
    expect(CHANGES.length).toBeGreaterThan(0);
    expect(CHANGES[0].version).toBe(METHOD_VERSION);
    expect(METHOD_FROZEN).toBe(CHANGES[0].date);
    for (const c of CHANGES) {
      expect(c.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(c.what.length).toBeGreaterThan(20);
    }
    const versions = CHANGES.map((c) => c.version);
    expect(versions).toEqual([...versions].sort((a, b) => b - a));
    expect(new Set(versions).size).toBe(versions.length);
  });
});

describe("the page quotes the crawler instead of retyping it", () => {
  // The whole point of reading these off lib/virtual.ts is that loosening a filter rewrites the page. If
  // somebody hardcodes a number back into the prose, this fails and they find out in the same commit.
  it("prints the star window the trawl actually filters on", () => {
    const md = methodMd();
    expect(md).toContain(`${MIN_STARS.toLocaleString("en-US")} to ${MAX_STARS.toLocaleString("en-US")} stars`);
    expect(md).toContain(`last ${PUSHED_WITHIN_DAYS} days`);
  });

  it("lists every licence the trawl will read and no others", () => {
    const md = methodMd();
    for (const l of PERMISSIVE) expect(md).toContain(l);
    expect(methodJson().trawl_filters.licenses.sort()).toEqual([...PERMISSIVE].sort());
  });

  it("names every search ground, because that is where the tool bias comes from", () => {
    const md = methodMd();
    for (const g of TRAWL_GROUNDS) {
      expect(md).toContain(g.name);
      for (const q of g.queries) expect(md).toContain(q);
    }
  });

  it("splits the judge's codes the way the judge actually splits them", () => {
    for (const c of LISTABLE_CODES) expect(judgeKeeps(c as JudgeCode)).toBe(true);
    for (const c of JUDGE_CODES) if (!(LISTABLE_CODES as readonly string[]).includes(c)) expect(judgeKeeps(c)).toBe(false);
  });
});

describe("the biases are first-class, not a footnote", () => {
  const md = methodMd();

  it("says what the sample is, and what it is not, before anything else", () => {
    expect(md).toContain("does not measure AI-written software");
    expect(md.indexOf("does not measure AI-written software")).toBeLessThan(md.indexOf("Known biases"));
  });

  it("refuses to let tool share be read as market share", () => {
    expect(md).toContain("query-shaped");
    expect(md).toContain("It is not market share");
  });

  it("keeps the six we know about", () => {
    for (const b of ["label is the sample", "query-shaped", "Permissive licences only", "star window", "self-selected", "stock, not flow"]) {
      expect(md).toContain(b);
    }
    expect(methodJson().known_biases.length).toBeGreaterThanOrEqual(6);
  });

  it("disclaims the four things a reader would otherwise assume", () => {
    for (const c of ["code quality", "security", "No ranking of one tool's output", "statistical significance"]) {
      expect(md).toContain(c);
    }
  });
});

describe("the machine-readable half says the same thing as the prose", () => {
  it("carries the version, the window and the judge's enums", () => {
    const j = methodJson();
    expect(j.method_version).toBe(METHOD_VERSION);
    expect(j.frozen).toBe(METHOD_FROZEN);
    expect(j.trawl_filters.stars).toEqual([MIN_STARS, MAX_STARS]);
    expect(j.trawl_filters.pushed_within_days).toBe(PUSHED_WITHIN_DAYS);
    expect(j.judge.codes).toEqual([...JUDGE_CODES]);
    expect(j.judge.may_write_prose).toBe(false);
    expect(j.trawl_filters.grounds).toHaveLength(TRAWL_GROUNDS.length);
  });
});
