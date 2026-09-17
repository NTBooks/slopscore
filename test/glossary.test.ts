import { describe, it, expect } from "vitest";
import { GLOSSARY, explain } from "../src/lib/glossary";
import { JUDGE_CODES } from "../src/lib/judge";
import { BUILT_WITH } from "../src/lib/vocab";
import { netBucket } from "../src/jobs/trends";
import { reportMd, reportTitle, shapeReport, type ReportRow } from "../src/jobs/report";
import { ReportPage } from "../src/views/report";
import { annotateKeys, whyHtml } from "../src/views/why";
import type { TrendRow } from "../src/jobs/trends";

describe("every key the report can print has a line in the glossary", () => {
  it("covers the judge's codes", () => {
    for (const c of JUDGE_CODES) expect(explain(c), c).toBeTruthy();
  });

  it("covers every tool in the built_with vocabulary", () => {
    for (const t of BUILT_WITH) expect(explain(t), t).toBeTruthy();
  });

  it("covers every bucket the net can print, including the label an old week was frozen under", () => {
    const reasons = [
      "judge: tool-for-ai-coding", "judge: list-or-template", "judge: needs-disclosure", "judge: low-effort", "judge: not-ai-made", "judge: unclear",
      "no past-tense claim in description or README", "license GPL-3.0 is not on the permissive list", "denylist: casino",
      "a list, guide or prompt pack about vibe coding, not vibe-coded software", "org-owned: nobody can log in as the repo owner",
      "fewer than 1 stars", "not pushed in 90 days", "no description", "already known", "the dog ate it",
    ];
    for (const r of reasons) expect(explain(netBucket(r)), netBucket(r)).toBeTruthy();
    expect(explain("owned by an org, so nobody can claim it")).toBeTruthy();
  });

  it("covers the criteria the masthead and captions count in", () => {
    for (const k of ["listed", "trawled", "opted in", "the judge has seen", "candidates judged", "credits", "language credits", "candidates thrown back in 30 days", "share points", "thrown back", "software somebody made"]) {
      expect(explain(k), k).toBeTruthy();
    }
  });

  it("says nothing about a language, which needs no explaining", () => {
    expect(explain("python")).toBeNull();
    expect(Object.keys(GLOSSARY).length).toBeGreaterThan(40);
  });
});

describe("the marker", () => {
  it("is one focusable question mark and one tooltip, escaped", () => {
    const h = whyHtml("app");
    expect(h).toContain('class="why"');
    expect(h).toContain('tabindex="0"');
    expect(h).toContain('role="tooltip"');
    expect(h).toContain("an application somebody made");
    expect(whyHtml("python")).toBe("");
    expect(whyHtml("needs-disclosure")).toContain("Cap&#39;m");
  });

  it("annotates a frozen list without changing a word of it", () => {
    const li = "<li><strong>tool-for-ai-coding</strong> — 8 (7.8%)</li>";
    const out = annotateKeys(li);
    expect(out.startsWith("<li><strong>tool-for-ai-coding</strong><span class=\"why\">")).toBe(true);
    expect(out.replace(/<span class="why">.*?<\/span><\/span>/, "")).toBe(li);
    expect(annotateKeys("<li><strong>python</strong> — 101 (16%)</li>")).toBe("<li><strong>python</strong> — 101 (16%)</li>");
  });
});

describe("on the page", () => {
  const row = (over: Partial<TrendRow>): TrendRow => ({ cohort: "trawl", metric: "language", period: "", key: "python", n: 1, mean_score: null, ...over });
  const snapshot: TrendRow[] = [
    row({ metric: "totals", key: "listed", n: 120 }), row({ metric: "totals", key: "owners", n: 100 }),
    row({ cohort: "opted", metric: "totals", key: "listed", n: 30 }), row({ cohort: "opted", metric: "totals", key: "owners", n: 25 }),
    row({ metric: "built_with", key: "claude-code", n: 60 }), row({ metric: "built_with", key: "cursor", n: 40 }),
    row({ metric: "language", key: "typescript", n: 50 }),
    row({ metric: "net", key: "owned by an org, so nobody could claim or remove it", n: 30 }),
    row({ cohort: "listed", metric: "verdict", key: "app", n: 60 }),
    row({ cohort: "thrown-back", metric: "verdict", key: "tool-for-ai-coding", n: 70 }),
  ];
  const view = shapeReport("2026-W37", "2026-09-14", null, snapshot, []);
  const rowOf: ReportRow = { slug: view.slug, at: 1757464000, covers_from: null, covers_to: view.date, method: view.method, title: reportTitle(view.slug), body: reportMd(view), data: JSON.stringify(view) };

  it("puts a marker on the criteria, on every charted key, and on the keys in the frozen prose", () => {
    const out = String(ReportPage({ row: rowOf, archive: [], list: null }));
    expect(out).toContain("what trawled means");
    expect(out).toContain("what opted in means");
    expect(out).toContain("what credits means");
    expect(out).toContain("what language credits means");
    // The chart legend and the prose list both carry the key, and both get the same line.
    expect(out.split("what tool-for-ai-coding means").length - 1).toBeGreaterThanOrEqual(2);
    expect(out).toContain("nobody can log in as an org");
    // Languages need no explaining, so typescript gets no marker anywhere.
    expect(out).not.toContain("what typescript means");
  });
});
