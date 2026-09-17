import { describe, it, expect } from "vitest";
import { archiveRow, reportMd, reportTitle, shapeReport, type ReportRow } from "../src/jobs/report";
import type { TrendRow } from "../src/jobs/trends";
import { ReportArchive, ReportPage, SECTION_FIGURES, readView, splitSections, swingsOf, verdictSlices, weekText } from "../src/views/report";

const row = (over: Partial<TrendRow>): TrendRow => ({ cohort: "trawl", metric: "language", period: "", key: "python", n: 1, mean_score: null, ...over });
const snapshot = (k = 1): TrendRow[] => [
  row({ cohort: "trawl", metric: "totals", key: "listed", n: 120 * k }),
  row({ cohort: "trawl", metric: "totals", key: "owners", n: 100 * k }),
  row({ cohort: "opted", metric: "totals", key: "listed", n: 30 * k }),
  row({ cohort: "opted", metric: "totals", key: "owners", n: 25 * k }),
  row({ cohort: "trawl", metric: "built_with", key: "claude-code", n: 60 * k }),
  row({ cohort: "trawl", metric: "built_with", key: "cursor", n: 40 * k }),
  row({ cohort: "trawl", metric: "language", key: "typescript", n: 50 * k }),
  row({ cohort: "trawl", metric: "language", key: "python", n: 40 * k }),
  row({ cohort: "trawl", metric: "net", key: "a tool for people coding with AI", n: 30 * k }),
  row({ cohort: "listed", metric: "verdict", key: "app", n: 60 * k }),
  row({ cohort: "listed", metric: "verdict", key: "tool", n: 40 * k }),
  row({ cohort: "thrown-back", metric: "verdict", key: "tool-for-ai-coding", n: 70 * k }),
  row({ cohort: "thrown-back", metric: "verdict", key: "list-or-template", n: 30 * k }),
];
const view = shapeReport("2026-W37", "2026-09-14", "2026-09-07", snapshot(1), snapshot(0.5));
const first = shapeReport("2026-W37", "2026-09-14", null, snapshot(1), []);
const rowOf = (v: typeof view, data = JSON.stringify(v)): ReportRow => ({ slug: v.slug, at: 1_789_000_000, covers_from: v.since, covers_to: v.date, method: v.method, title: reportTitle(v.slug), body: reportMd(v), data });
const html = (x: unknown) => String(x);

describe("splitting the frozen prose", () => {
  it("finds every heading the bulletin writes today, and every one of them has a place in the figure map", () => {
    const parts = splitSections(reportMd(view));
    expect(parts[0].heading).toBeNull();
    expect(parts[0].md).toMatch(/^# The Trawl Report/);
    const headings = parts.slice(1).map((p) => p.heading);
    expect(headings).toEqual(["The trough", "How much of it is software", "Which tool gets the credit", "What it is written in", "What the net threw back", "The small print"]);
    // A rename in jobs/report.ts must fail here rather than silently losing a chart.
    for (const h of headings) expect(Object.keys(SECTION_FIGURES)).toContain(h);
  });

  it("keeps a body with no headings as one chunk of prose", () => {
    expect(splitSections("# Hello\n\nJust words.")).toEqual([{ heading: null, md: "# Hello\n\nJust words." }]);
  });
});

describe("the ring", () => {
  it("keeps the listable codes apart and folds every reason to throw back into one grey slice", () => {
    const s = verdictSlices(view.judged.codes);
    expect(s.map((x) => x.key)).toEqual(["app", "tool", "thrown back"]);
    expect(s.map((x) => x.cls)).toEqual(["c1", "c3", "c7"]); // app is always slot 1, tool always slot 3, whatever the order
    expect(s[2].n).toBe(100);
  });
});

describe("the page", () => {
  it("draws the masthead, the ring and the movers around the prose, which stays intact", () => {
    const out = html(ReportPage({ row: rowOf(view), archive: [], list: null }));
    expect(out).toContain('class="masthead"');
    expect(out).toContain("Week 37 of 2026");
    expect(out).toContain("+75 this week");
    expect(out).toContain('class="donut"');
    expect(out).toContain("<title>What the judge saw over 200 candidates</title>");
    expect(out).toContain('class="mwas"');
    for (const h of ["The trough", "How much of it is software", "Which tool gets the credit", "What it is written in", "What the net threw back", "The small print"]) expect(out).toContain(`>${h}</h2>`);
    // The frozen lists are still there under the figures: the prose is the record, the figure is the picture.
    expect(out).toMatch(/<li><strong>claude-code<\/strong>(<span class="why">.*?<\/span><\/span>)? — 60 \(60%\), flat<\/li>/);
    expect(out).toContain("how loudly each tool&#39;s users say its name");
    expect(out).not.toContain("<h2>The Trawl Report");
  });

  it("gives every counted section a ring beside its movers, and one swings chart for the week", () => {
    const out = html(ReportPage({ row: rowOf(view), archive: [], list: null }));
    expect(out.split('class="donut').length - 1).toBe(4); // verdict, tools, languages, net
    expect(out.split('class="movers').length - 1).toBe(4);
    expect(out).toContain('class="sbar"');
    // `view` is last week scaled by a half, so every share is flat and there is nothing to swing: no chart.
    expect(out).not.toContain("Biggest swings");
    // A week where cursor lost ground gets the swings chart, drawn from every section together.
    const moved = shapeReport("2026-W37", "2026-09-14", "2026-09-07", snapshot(1), snapshot(0.5).map((r) => (r.key === "cursor" ? { ...r, n: 40 } : r)));
    const out2 = html(ReportPage({ row: rowOf(moved), archive: [], list: null }));
    expect(out2).toContain(">Biggest swings this week</h2>");
    expect(out2).toContain('class="swings"');
    expect(out2).toContain('class="down"');
    const sw = swingsOf(moved);
    expect(sw.map((r) => r.group)).toEqual(expect.arrayContaining(["tool", "language", "verdict", "thrown back"]));
    expect(sw.find((r) => r.key === "cursor")!.points).toBeLessThan(0);
    expect(swingsOf(first)).toEqual([]);
  });

  it("draws no movement on a first bulletin", () => {
    const out = html(ReportPage({ row: rowOf(first), archive: [], list: null }));
    expect(out).toContain("nothing here moves yet");
    expect(out).not.toContain("Biggest swings");
    expect(out).not.toContain("mwas");
    expect(out).not.toContain("pts");
    expect(out).not.toContain("this week</span>");
  });

  it("falls back to the prose alone when the frozen numbers will not read", () => {
    for (const bad of ["", "not json", "{}", '{"totals":{}}']) {
      expect(readView(rowOf(view, bad))).toBeNull();
      const out = html(ReportPage({ row: rowOf(view, bad), archive: [], list: null }));
      expect(out).not.toContain("masthead");
      expect(out).not.toContain("donut");
      expect(out).toContain("<h2>The Trawl Report · 2026-W37</h2>");
      expect(out).toContain("claude-code");
    }
  });

  it("names the week for people", () => {
    expect(weekText("2026-W37")).toBe("Week 37 of 2026 · 7 to 13 September");
    expect(weekText("2026-W40")).toBe("Week 40 of 2026 · 28 September to 4 October");
    expect(weekText("whatever")).toBe("whatever");
  });
});

describe("the archive", () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => archiveRow({ slug: `2026-W${40 - i}`, at: 100 - i, title: "t", method: 1, listed: 300 - i * 20, added: i === n - 1 ? null : 20, seen: 100, software_share: 0.8 + i / 100 }));

  it("reads the frozen numbers null-safely, so an unreadable week still lists", () => {
    expect(archiveRow({ slug: "w", at: 1, title: "t", method: 1 })).toEqual({ slug: "w", at: 1, title: "t", method: 1, listed: null, added: null, seen: null, software_share: null });
    // A week the judge saw nothing in has no share, however the JSON spells it.
    expect(archiveRow({ slug: "w", at: 1, title: "t", method: 1, seen: 0, software_share: 0 }).software_share).toBeNull();
    expect(archiveRow({ slug: "w", at: 1, title: "t", method: 1, listed: "12" }).listed).toBeNull();
  });

  it("hides itself with one week, lists from two, and only draws a line from three", () => {
    expect(ReportArchive({ rows: rows(1), current: "2026-W40" })).toBeNull();
    const two = html(ReportArchive({ rows: rows(2), current: "2026-W40" }));
    expect(two).toContain('class="archive"');
    expect(two).toContain('class="now"');
    expect(two).toContain('href="/report/2026-W39"');
    expect(two).not.toContain("<svg");
    const three = html(ReportArchive({ rows: rows(3), current: "2026-W40" }));
    expect(three).toContain('class="spark"');
    expect(three).toContain("300 listed (+20)");
    expect(three).toContain("80% software");
  });
});
