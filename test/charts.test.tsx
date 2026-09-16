import { describe, it, expect } from "vitest";
import {
  arcPath, donutArcs, donutSlices, pickGrain, sparkPath, periodText, slotClass, OTHER_CLASS,
  Donut, Movers, PeriodLabel, Sparkline, Kpi,
} from "../src/views/charts";
import { isoWeek, weekStart } from "../src/lib/time";

const html = (node: unknown) => String(node);

describe("folding a ring", () => {
  it("keeps six named slices and folds the tail into one grey other, sum preserved", () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, n: 9 - i }));
    const s = donutSlices(rows);
    expect(s).toHaveLength(7);
    expect(s[6]).toEqual({ key: "other", n: 3 + 2 + 1, cls: OTHER_CLASS });
    expect(s.reduce((a, x) => a + x.n, 0)).toBe(rows.reduce((a, x) => a + x.n, 0));
    expect(s.slice(0, 6).map((x) => x.cls)).toEqual(["c1", "c2", "c3", "c4", "c5", "c6"]);
  });

  it("adds no other when there is no tail, and never a grey slot for a named series", () => {
    expect(donutSlices([{ key: "a", n: 1 }, { key: "b", n: 2 }]).map((x) => x.key)).toEqual(["a", "b"]);
    expect(slotClass(6)).toBe("c6");
    expect(slotClass(40)).toBe("c6");
  });

  it("lets the caller colour a slice by what it is rather than where it sits", () => {
    const s = donutSlices([{ key: "app", n: 5 }, { key: "list", n: 2 }], 6, (r) => (r.key === "app" ? "c1" : "c7"));
    expect(s.map((x) => x.cls)).toEqual(["c1", "c7"]);
  });
});

describe("arcs", () => {
  it("draws one slice as a whole ring rather than an arc from a point to itself", () => {
    const a = donutArcs([{ key: "only", n: 4, cls: "c1" }, { key: "none", n: 0, cls: "c2" }], 46);
    expect(a).toHaveLength(1);
    expect(a[0].d).toBeNull();
    expect(a[0].share).toBe(1);
  });

  it("gives every live slice its share and leaves a gap between neighbours", () => {
    const a = donutArcs([{ key: "a", n: 1, cls: "c1" }, { key: "b", n: 1, cls: "c2" }, { key: "c", n: 3, cls: "c3" }], 46);
    expect(a.map((x) => x.share)).toEqual([0.2, 0.2, 0.6]);
    for (const x of a) expect(x.d).toMatch(/^M[\d.]+ [\d.]+A46 46 0 [01] 1 [\d.]+ [\d.]+$/);
    // Only the slice past half the ring needs the large-arc flag.
    expect(a[2].d).toContain("A46 46 0 1 1");
    expect(a[0].d).toContain("A46 46 0 0 1");
  });

  it("keeps a sliver rather than trimming it away into its own gaps", () => {
    const a = donutArcs([{ key: "big", n: 999, cls: "c1" }, { key: "sliver", n: 1, cls: "c2" }], 46);
    expect(a).toHaveLength(2);
    expect(a[1].d).not.toBeNull();
  });

  it("rounds coordinates so the markup is stable", () => {
    expect(arcPath(60, 60, 46, 0, Math.PI / 3)).toBe("M60 14A46 46 0 0 1 99.84 37");
  });

  it("is empty for an empty sample", () => {
    expect(donutArcs([], 46)).toEqual([]);
  });
});

describe("a sparkline", () => {
  it("fits the points to the box and runs flat when nothing changes", () => {
    expect(sparkPath([1, 2, 3], 100, 24)).toBe("M2 22L50 12L98 2");
    expect(sparkPath([5, 5, 5], 100, 24)).toBe("M2 12L50 12L98 12");
    expect(sparkPath([1])).toBe("");
  });

  it("is not drawn for fewer than three weeks", () => {
    expect(Sparkline({ values: [1, 2], title: "x" })).toBeNull();
    expect(html(Sparkline({ values: [1, 2, 3], title: "listed" }))).toContain("<svg");
  });
});

describe("the grain of a time series", () => {
  const months = (n: number) => Array.from({ length: 12 }, (_, i) => ({ total: i >= 12 - n ? 5 : 0 }));
  it("draws weeks until three months have anything in them", () => {
    expect(pickGrain(months(1), [{ total: 1 }])).toBe("week");
    expect(pickGrain(months(2), [{ total: 1 }])).toBe("week");
    expect(pickGrain(months(3), [{ total: 1 }])).toBe("month");
  });
  it("draws months when there is no weekly series at all (an older snapshot)", () => {
    expect(pickGrain(months(1), undefined)).toBe("month");
    expect(pickGrain(months(1), [])).toBe("month");
  });
});

describe("weeks and their labels", () => {
  it("starts an ISO week on its Monday and round-trips through isoWeek", () => {
    const monday = weekStart("2026-W37")!;
    expect(new Date(monday * 1000).toISOString()).toBe("2026-09-07T00:00:00.000Z");
    expect(isoWeek(monday)).toBe("2026-W37");
    expect(isoWeek(monday + 6 * 86400)).toBe("2026-W37");
    expect(isoWeek(monday + 7 * 86400)).toBe("2026-W38");
    expect(weekStart("2026-09")).toBeNull();
  });

  it("labels a week by its Monday and a month by its name, with the year only where it changes", () => {
    expect(html(PeriodLabel({ period: "2026-W37" }))).toBe("7 Sep<span class=\"yr\"> ’26</span>");
    expect(html(PeriodLabel({ period: "2026-W38", prev: "2026-W37" }))).toBe("14 Sep");
    expect(html(PeriodLabel({ period: "2026-09", prev: "2025-12" }))).toBe("Sep<span class=\"yr\"> ’26</span>");
    expect(periodText("2026-W37")).toBe("the week of 7 Sep 2026");
    expect(periodText("2026-09")).toBe("September 2026");
  });
});

describe("rendering", () => {
  it("draws a ring with a title on every slice and the same numbers as text beside it", () => {
    const out = html(Donut({ slices: donutSlices([{ key: "app", n: 3 }, { key: "tool", n: 1 }]), hero: "75%", caption: "software", title: "What the judge saw" }));
    expect(out).toContain('role="img"');
    expect(out).toContain("<title>What the judge saw</title>");
    expect(out).toContain("<title>app: 3 (75%)</title>");
    expect(out).toContain('class="slice c1"');
    expect(out).toContain("<strong>75%</strong>");
    expect(out).toMatch(/dlegend[\s\S]*app[\s\S]*75%/);
  });

  it("says nothing here yet instead of drawing an empty ring", () => {
    expect(html(Donut({ slices: [], hero: "", caption: "", title: "t", empty: "The judge has not seen anything yet." }))).toContain("The judge has not seen anything yet.");
  });

  it("draws movement only when there is a week to move from", () => {
    const rows = [
      { key: "claude-code", n: 18, share: 0.6, was_share: 0.5, points: 0.1 },
      { key: "cursor", n: 2, share: 0.1, was_share: null, points: null },
    ];
    const moved = html(Movers({ rows }));
    expect(moved).toContain('class="mwas"');
    expect(moved).toContain("+10.0 pts");
    expect(moved).toContain('class="delta new"');
    const first = html(Movers({ rows, first: true }));
    expect(first).not.toContain("mwas");
    expect(first).not.toContain("pts");
    expect(first).not.toContain("new");
  });

  it("renders a headline number with a signed move", () => {
    expect(html(Kpi({ label: "listed", value: 214, delta: 12, since: "this week" }))).toContain("+12 this week");
    expect(html(Kpi({ label: "listed", value: 214, delta: -3 }))).toContain("−3");
    expect(html(Kpi({ label: "listed", value: 214, delta: null }))).not.toContain("delta");
  });
});
