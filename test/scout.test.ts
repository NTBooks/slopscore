import { describe, it, expect } from "vitest";
import { SCOUT_MIN, scoutMail, shapeCandidates, topicTerm, type SightingRow } from "../src/jobs/scout";
import { STATIC_TOOLS, knownTerms } from "../src/lib/tools";
import { DAILY_JOBS, JOB_INFO } from "../src/lib/crawlclock";

const AT = Date.parse("2026-09-16T00:05:00Z") / 1000;
const known = knownTerms(STATIC_TOOLS);
const row = (term: string, full_name: string, kind = "topic", at = AT): SightingRow => ({ term, kind, full_name, at });

describe("the scout's count", () => {
  it("surfaces a term said by three distinct repos, with its evidence and three examples", () => {
    const c = shapeCandidates([
      row("kiro", "a/one"), row("kiro", "b/two", "phrase", AT - 86400), row("kiro", "a/one", "phrase"), row("kiro", "C/Three", "declared", AT - 5 * 86400),
      row("amazon-q", "a/one"), row("amazon-q", "d/four"),
    ], known);
    expect(c).toEqual([{ term: "kiro", n: 3, kinds: ["declared", "phrase", "topic"], samples: ["a/one", "b/two", "c/three"], first_seen: AT - 5 * 86400, last_seen: AT }]);
  });

  it("keeps refreshing a term that already has a row, however small it has become", () => {
    const rows = [row("amazon-q", "a/one"), row("amazon-q", "d/four")];
    expect(shapeCandidates(rows, known)).toEqual([]);
    expect(shapeCandidates(rows, known, new Set(["amazon-q"]))[0]).toMatchObject({ term: "amazon-q", n: 2 });
  });

  it("drops what the registry knows and what is not a tool, even when the sighting predates the knowledge", () => {
    const rows = ["claude code", "GitHub Copilot", "gpt", "love", "react", "ai", "an ai", "muse"].flatMap((t) => ["a/1", "b/2", "c/3"].map((r) => row(t, r, "phrase")));
    expect(shapeCandidates(rows, known)).toEqual([]);
    // A registry tool is known the night after it is approved, so its own sightings stop being candidates.
    expect(shapeCandidates(["a/1", "b/2", "c/3"].map((r) => row("kiro", r)), new Set([...known, "kiro"]))).toEqual([]);
  });

  it("orders by weight, then name, and needs SCOUT_MIN repos", () => {
    const rows = [...["a/1", "b/2", "c/3", "d/4"].map((r) => row("zed-ai", r)), ...["a/1", "b/2", "c/3"].map((r) => row("amp", r))];
    expect(shapeCandidates(rows, known).map((c) => c.term)).toEqual(["zed-ai", "amp"]);
    expect(SCOUT_MIN).toBe(3);
  });

  it("reads a built-with topic as the tool it names", () => {
    expect(topicTerm("built-with-kiro")).toBe("kiro");
    expect(topicTerm("Made-With-Amazon-Q")).toBe("amazon-q");
    expect(topicTerm("kiro")).toBeNull();
  });
});

describe("the scout's mail", () => {
  it("says what was found, who said it, and where to decide", () => {
    const { subject, text } = scoutMail("https://slopscore.org", [{ term: "kiro", n: 4, kinds: ["phrase", "topic"], samples: ["a/one", "b/two"], first_seen: AT, last_seen: AT }]);
    expect(subject).toBe("[SlopScore] The scout found a tool: kiro");
    expect(text).toContain("https://github.com/a/one");
    expect(text).toContain("https://slopscore.org/mod#scout");
    expect(text).toContain("One mail a day at most");
    expect(scoutMail("x", [{ term: "a", n: 3, kinds: [], samples: [], first_seen: 0, last_seen: 0 }, { term: "b", n: 3, kinds: [], samples: [], first_seen: 0, last_seen: 0 }]).subject).toContain("2 tools: a, b");
  });
});

describe("the scout is a watched daily job", () => {
  it("is on the nightly round with a label of its own", () => {
    expect(DAILY_JOBS).toContain("scout");
    expect(JOB_INFO.scout.does).toMatch(/tool names/);
  });
});
