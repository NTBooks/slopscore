import { describe, it, expect } from "vitest";
import {
  absoluteLinks, bigMoves, dispatchMail, isReportDay, isoWeek, movers, newcomers, newsletter,
  reportMd, shapeReport, teaserLine, weekOf, REPORT_WEEKDAY, type Move,
} from "../src/jobs/report";
import { METHOD_VERSION } from "../src/lib/method";
import { STATIC_TOOLS } from "../src/lib/tools";
import type { TrendRow } from "../src/jobs/trends";

const at = (iso: string) => Date.parse(iso) / 1000;
const row = (over: Partial<TrendRow>): TrendRow => ({ cohort: "trawl", metric: "language", period: "", key: "python", n: 1, mean_score: null, ...over });

/** A week's snapshot, scaled: `k` multiplies every count so "a week ago" is one argument away. */
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

describe("which week a report belongs to", () => {
  it("names the ISO week, not the day the job ran", () => {
    // 2026-01-01 is a Thursday, so it belongs to week 1 of 2026.
    expect(isoWeek(at("2026-01-01T12:00:00Z"))).toBe("2026-W01");
    expect(isoWeek(at("2026-09-14T00:05:00Z"))).toBe("2026-W38");
    // A Sunday belongs to the week that is ending, not the one about to start.
    expect(isoWeek(at("2026-09-13T23:00:00Z"))).toBe("2026-W37");
  });

  it("hands a Monday run the week that just ended", () => {
    expect(weekOf(at("2026-09-14T00:05:00Z"))).toBe("2026-W37");
  });

  it("only calls one weekday the report day", () => {
    const days = [0, 1, 2, 3, 4, 5, 6].map((d) => isReportDay(at(`2026-09-${13 + d}T00:05:00Z`)));
    expect(days.filter(Boolean)).toHaveLength(1);
    expect(new Date(at("2026-09-14T00:05:00Z") * 1000).getUTCDay()).toBe(REPORT_WEEKDAY);
  });

  it("puts a year boundary on the right side of itself", () => {
    // 2027-01-01 is a Friday, so it is still week 53 of 2026.
    expect(isoWeek(at("2027-01-01T12:00:00Z"))).toBe("2026-W53");
  });
});

describe("movement", () => {
  const now = [row({ key: "a", n: 60 }), row({ key: "b", n: 30 }), row({ key: "c", n: 10 })];
  const before = [row({ key: "a", n: 20 }), row({ key: "b", n: 20 })];

  it("reports count and share, because either one alone misleads", () => {
    const [a, b, c] = movers(now, before);
    expect(a).toMatchObject({ key: "a", n: 60, was: 20, added: 40 });
    expect(a.share).toBeCloseTo(0.6);
    expect(a.was_share).toBeCloseTo(0.5);
    expect(a.points).toBeCloseTo(0.1);
    // b grew by half and still lost a fifth of its share. Counting alone would have called that growth.
    expect(b).toMatchObject({ key: "b", n: 30, was: 20 });
    expect(b.points!).toBeLessThan(0);
    // A key nobody saw last week is new, which is a different fact from zero.
    expect(c.was).toBeNull();
    expect(c.points).toBeNull();
  });

  it("keeps a new key out of the swing list and in the newcomers list", () => {
    const rows = movers(now, before);
    expect(bigMoves(rows).map((r) => r.key)).not.toContain("c");
    expect(newcomers(rows).map((r) => r.key)).toEqual(["c"]);
  });

  it("treats the first week as having nothing to compare against", () => {
    for (const r of movers(now, [])) {
      expect(r.was).toBeNull();
      expect(r.points).toBeNull();
    }
  });
});

describe("the bulletin", () => {
  const view = shapeReport("2026-W37", "2026-09-14", "2026-09-07", snapshot(1), snapshot(0.5));

  it("counts both cohorts and keeps them apart", () => {
    expect(view.totals.listed).toBe(150);
    expect(view.totals.trawl).toBe(120);
    expect(view.totals.opted).toBe(30);
    expect(view.totals.added).toBe(75);
  });

  it("adds the judge's two halves into one population and reports the pass rate", () => {
    // app + tool were listed; tool-for-ai-coding + list-or-template were thrown back. Half of what it saw
    // was software somebody made, and that number is only available because the rejects are kept.
    expect(view.judged.seen).toBe(200);
    expect(view.judged.software).toBe(100);
    expect(view.judged.software_share).toBeCloseTo(0.5);
  });

  it("denominates tool credits on credits, not repos", () => {
    expect(view.tools.total).toBe(100);
    expect(view.tools.rows[0]).toMatchObject({ key: "claude-code", n: 60 });
  });

  it("never prints a tool number without saying what it does not mean", () => {
    const md = reportMd(view);
    expect(md).toContain("claude-code");
    expect(md).toMatch(/how loudly each tool's users say its name/);
    expect(md).toMatch(/not market share/);
  });

  it("stamps the method version it was written under", () => {
    expect(view.method).toBe(METHOD_VERSION);
    expect(reportMd(view)).toContain(`Method v${METHOD_VERSION}`);
  });

  it("links the frozen numbers behind it, which outlive the snapshot", () => {
    expect(reportMd(view)).toContain("/report/2026-W37.json");
  });

  it("holds the hedge on tool share for longer than anywhere else", () => {
    // 33 credits cleared the general floor of 20 and printed no warning, which is how the first live bulletin
    // shipped "claude-code 54.5%" bare. Tool share is the most screenshotted line and a repo can contribute
    // more than one credit, so it keeps its hedge until the sample is genuinely worth quoting.
    const tools = (n: number) => shapeReport("2026-W37", "2026-09-14", "2026-09-07",
      [row({ cohort: "trawl", metric: "built_with", key: "claude-code", n })],
      [row({ cohort: "trawl", metric: "built_with", key: "claude-code", n: n - 1 })]);
    expect(reportMd(tools(33))).toContain("is noise");
    expect(reportMd(tools(80))).not.toContain("is noise");
  });

  it("says a small sample is noise instead of calling it a trend", () => {
    const thin = shapeReport("2026-W37", "2026-09-14", "2026-09-07", [
      row({ cohort: "trawl", metric: "built_with", key: "cursor", n: 3 }),
    ], [row({ cohort: "trawl", metric: "built_with", key: "cursor", n: 1 })]);
    expect(reportMd(thin)).toContain("is noise");
  });

  it("says so on the first week rather than printing movement it cannot see", () => {
    const first = shapeReport("2026-W37", "2026-09-14", null, snapshot(1), []);
    expect(first.first).toBe(true);
    expect(first.since).toBeNull();
    expect(first.totals.added).toBeNull();
    const md = reportMd(first);
    expect(md).toContain("The first bulletin");
    expect(md).not.toMatch(/points from/);
    // Every key is absent from a snapshot that does not exist. Calling them all "new this week" would be a
    // finding about growth invented out of having no history at all.
    expect(md).not.toContain("new this week");
  });

  it("falls back to the opted-in column when the trawl has nothing, and says it did", () => {
    const noTrawl = shapeReport("2026-W37", "2026-09-14", null, [
      row({ cohort: "opted", metric: "totals", key: "listed", n: 16 }),
      row({ cohort: "opted", metric: "language", key: "typescript", n: 9 }),
    ], []);
    expect(noTrawl.languages.cohort).toBe("opted");
    expect(noTrawl.languages.total).toBe(9);
    const md = reportMd(noTrawl);
    expect(md).toContain("typescript");
    expect(md).toContain("a fact about volunteers");
  });

  it("prefers the near-random column whenever it has one", () => {
    const both = shapeReport("2026-W37", "2026-09-14", null, [
      row({ cohort: "trawl", metric: "language", key: "python", n: 40 }),
      row({ cohort: "opted", metric: "language", key: "typescript", n: 9 }),
    ], []);
    expect(both.languages.cohort).toBe("trawl");
    expect(both.languages.rows.map((r) => r.key)).toEqual(["python"]);
  });

  it("holds together on a site with nothing in it", () => {
    const md = reportMd(shapeReport("2026-W37", "2026-09-14", null, [], []));
    expect(md).toContain("# The Trawl Report");
    expect(md).toContain("no pass rate to report");
    expect(md).not.toContain("NaN");
    expect(md).not.toContain("undefined");
  });

  it("freezes the tools the credit was counted over, defaulting to the frozen sixteen", () => {
    expect(view.registry).toEqual(STATIC_TOOLS.map((t) => t.key));
    expect(reportMd(view)).toContain("counted over the 16 tools the dictionary held that night");
    const wider = shapeReport("2026-W37", "2026-09-14", "2026-09-07", snapshot(1), snapshot(0.5), [...STATIC_TOOLS.map((t) => t.key), "kiro"]);
    expect(reportMd(wider)).toContain("17 tools");
    expect(reportMd(wider)).toContain("kiro");
  });

  it("points every reader at the method before they quote anything", () => {
    expect(reportMd(view)).toContain("/method");
  });
});

describe("a mover's phrasing", () => {
  const md = (m: Partial<Move>) => reportMd(shapeReport("w", "d", "s",
    [row({ cohort: "trawl", metric: "built_with", key: m.key ?? "x", n: m.n ?? 50 }), row({ cohort: "trawl", metric: "built_with", key: "other", n: 50 })],
    [row({ cohort: "trawl", metric: "built_with", key: m.key ?? "x", n: m.was ?? 50 }), row({ cohort: "trawl", metric: "built_with", key: "other", n: 50 })]));

  it("calls a flat line flat rather than inventing a swing", () => {
    expect(md({ n: 50, was: 50 })).toMatch(/\*\*x\*\* — 50 \(50%\), flat/);
  });

  it("uses a minus sign a reader can see for a fall", () => {
    expect(md({ n: 20, was: 80 })).toContain("−");
  });
});

describe("handing it to a newsletter", () => {
  const view = shapeReport("2026-W37", "2026-09-14", "2026-09-07", snapshot(1), snapshot(0.5));
  const list = { url: "https://enshittification.substack.com", name: "enshittification.substack.com" };

  it("only accepts an https destination, and names it from the host when nobody named it", () => {
    expect(newsletter({ NEWSLETTER_URL: "https://x.substack.com" })).toEqual({ url: "https://x.substack.com", name: "x.substack.com" });
    expect(newsletter({ NEWSLETTER_URL: "https://www.x.com", NEWSLETTER_NAME: "The Report" })?.name).toBe("The Report");
    // No list configured is a supported state, not an error: the bulletin still publishes and still has RSS.
    expect(newsletter({})).toBeNull();
    expect(newsletter({ NEWSLETTER_URL: "  " })).toBeNull();
    // Nothing that is not a real https URL becomes a link on a public page.
    for (const bad of ["substack.com", "http://x.com", "javascript:alert(1)", "//x.com"]) {
      expect(newsletter({ NEWSLETTER_URL: bad })).toBeNull();
    }
  });

  it("rewrites every site-relative link, because a pasted bulletin leaves this host", () => {
    const md = absoluteLinks("see [how](/method) and [this](/report/2026-W37.json)", "https://slopscore.org");
    expect(md).toBe("see [how](https://slopscore.org/method) and [this](https://slopscore.org/report/2026-W37.json)");
    // Links that were already absolute are left exactly as they were.
    expect(absoluteLinks("[x](https://github.com/a/b)", "https://slopscore.org")).toBe("[x](https://github.com/a/b)");
    // A trailing slash on the site URL must not produce a double slash in every link in the post.
    expect(absoluteLinks("[x](/method)", "https://slopscore.org/")).toBe("[x](https://slopscore.org/method)");
  });

  it("mails a draft that can be pasted without editing", () => {
    const { subject, text } = dispatchMail(view, reportMd(view), "https://slopscore.org", list);
    expect(subject).toContain("2026-W37");
    expect(text).toContain("https://slopscore.org/report/2026-W37");
    expect(text).toContain(list.url);
    // The whole bulletin travels with it, link-absolute, or the operator has to go and fetch it.
    expect(text).toContain("Which tool gets the credit");
    expect(text).toContain("(https://slopscore.org/method)");
    expect(text).not.toMatch(/\]\(\/[a-z]/);
  });

  it("carries a rendered HTML part, so the paste lands as headings rather than asterisks", () => {
    const { html } = dispatchMail(view, reportMd(view), "https://slopscore.org", list);
    expect(html).toContain("<h2>");
    expect(html).toContain("<li>");
    expect(html).toContain('href="https://slopscore.org/method"');
    // Nothing site-relative survives into the copy that leaves the building.
    expect(html).not.toMatch(/href="\/[a-z]/);
    // The instructions sit above the rule; the post sits below it.
    expect(html.indexOf("Select everything below the line")).toBeLessThan(html.indexOf("<hr"));
  });

  it("points a syndicated copy back at the original", () => {
    const { text, html } = dispatchMail(view, reportMd(view), "https://slopscore.org", list);
    expect(text).toContain("Originally published at [https://slopscore.org/report/2026-W37]");
    expect(html).toContain("Originally published at");
    // And the canonical note is never baked into the stored bulletin, which IS the original.
    expect(reportMd(view)).not.toContain("Originally published at");
  });

  it("says which address is the citable one, so the copy never outranks the original", () => {
    const { text } = dispatchMail(view, reportMd(view), "https://slopscore.org", list);
    expect(text).toContain("is the citable address");
  });

  it("still produces a usable draft when no newsletter is configured", () => {
    const { text } = dispatchMail(view, reportMd(view), "https://slopscore.org", null);
    expect(text).toContain("No NEWSLETTER_URL is set");
    expect(text).toContain("Which tool gets the credit");
  });
});

describe("advertising the bulletin", () => {
  it("leads the teaser with the finding when there is one", () => {
    expect(teaserLine({ slug: "2026-W37", at: 0, listed: 214, software_share: 0.864 }))
      .toBe("86.4% of what the net looked at was software somebody made. 214 repos counted.");
  });

  it("falls back to the size of the pile before the judge has seen anything", () => {
    const line = teaserLine({ slug: "2026-W37", at: 0, listed: 214, software_share: null });
    expect(line).toContain("214 repos counted");
    expect(line).not.toContain("%");
    expect(line).not.toContain("NaN");
  });

  it("does not claim a finding on an empty site", () => {
    expect(teaserLine({ slug: "2026-W37", at: 0, listed: 0, software_share: null })).toContain("0 repos counted");
  });
});
