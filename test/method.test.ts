import { describe, it, expect } from "vitest";
import { CHANGES, LISTABLE_CODES, METHOD_FROZEN, METHOD_VERSION, methodJson, methodMd } from "../src/lib/method";
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
