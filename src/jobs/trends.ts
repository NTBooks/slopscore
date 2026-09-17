// The trends snapshot: what the corpus looks like tonight, written once so /trends costs one indexed query.
//
// Cost, because this is the part that could quietly get expensive:
//   - No model is called. Not one token. Every number below is a GROUP BY over rows some earlier job already
//     paid for — the facets a scan wrote into repo_tags, the verdict the trawl's judge already reached, the gate
//     that turned a submission away. The analysis was bought when the repo was picked or scanned; this counts it.
//     Two of the charts (metrics `use` and `verdict`) therefore count a model's labels rather than a maker's; they
//     are drawn under their own heading and the page says whose opinion they are.
//   - It runs once a day inside the 00:05 UTC tick, not per request. A full pass scans the corpus a handful of
//     times (tens of thousands of row reads against a 5M/day free-tier allowance) and writes ~500 rows.
//   - The page reads one day's rows behind lib/cache, so a visitor normally costs zero D1 reads.
//   - `period` is '' for "as it stands", 'YYYY-MM' for the monthly series and 'YYYY-Www' for the weekly one
//     (metrics `listings_w` and `tool_w`). The weekly series exists so a young site has a chart at all.
//
// Cohorts are the whole point of the dashboard. `trawl` repos were picked by the Cap'm out of GitHub search and
// never asked to be here, so as a sample of "software whose author says in public that a model wrote it" they
// are close to random. `opted` repos committed slopscore.md, which is self-selection: people proud enough to
// file paperwork are not the average maker. Anything read off the opted-in column describes that crowd, not
// the world, and the page says so.
import type { Env } from "../env";
import { cached, markDirty } from "../lib/cache";
import { isoDate, isoWeek, now, weekStart } from "../lib/time";

/** How long snapshots are kept. Long enough to watch a season turn, short enough that the table stays small. */
export const TRENDS_KEEP_DAYS = 180;
/** Months of history in the derived series. Older than that is a different era of the tooling. */
export const TRENDS_MONTHS = 12;
/**
 * Weeks of history in the same series at a finer grain. A site a month old has one monthly column and eleven
 * blanks; the page draws weeks (metrics `listings_w` and `tool_w`, period `YYYY-Www`) until three months have
 * anything in them, then switches. Twelve, not fifty-two: it exists to bridge the first quarter.
 */
export const TRENDS_WEEKS = 12;
/** Values kept per facet per cohort. The tail is long, uninformative, and costs rows. */
const TOP_N = 12;
/** Tools tracked as their own band in the monthly series. More than this and the chart is a plate of spaghetti. */
const SERIES_TOOLS = 6;

/**
 * The facet drawn as a tag cloud rather than a bar chart: GitHub topics, which are the one free-vocabulary
 * label both cohorts carry (the owner wrote them, we only read them). A cloud is the right shape for it —
 * the interesting part of a thousand topics is the tail, and ten bars would hide exactly that.
 */
export const CLOUD_FACET = "topic";
/** Terms kept for the cloud. Enough to show the tail, few enough to stay a paragraph rather than a wall. */
const CLOUD_N = 80;

export type Cohort = "trawl" | "opted";
export const COHORTS: Cohort[] = ["trawl", "opted"];
export const COHORT_LABEL: Record<Cohort, string> = { trawl: "trawled", opted: "opted in" };

/** Facets worth charting, in display order. */
export const CHART_FACETS = [
  "language", "category", "built_with", "topic", "license", "frameworks", "models",
  "interface", "platforms", "audience", "data", "status", "ai_generated", "human_touch", "domain",
] as const;
export type ChartFacet = (typeof CHART_FACETS)[number];

/** What each chart is actually asking, in the site's words. */
export const FACET_TITLE: Record<ChartFacet, string> = {
  language: "Languages",
  category: "What it is",
  built_with: "Which tool gets the credit",
  topic: "How they tag it on GitHub",
  license: "Licences",
  frameworks: "Frameworks",
  models: "Models named by name",
  interface: "How you touch it",
  platforms: "Where it runs",
  audience: "Who it says it is for",
  data: "What it does with your data",
  status: "How finished they say it is",
  ai_generated: "How much of it a model wrote",
  human_touch: "How much a human went back over",
  domain: "Subject matter",
};

/**
 * Facets a trawled listing does not actually answer.
 *
 * A trawled repo's paperwork is a template the Cap'm wrote (lib/virtual.ts): every single one of them says
 * ai_generated: mostly, human_touch: light, status: works-on-my-machine, and declares nothing else. Charting
 * those for the trawl cohort would draw a bar at 100% and dress it up as a finding. They are counted for the
 * opted-in cohort, where a person chose the value, and suppressed for the trawl.
 */
export const TEMPLATED_ON_TRAWL = new Set<string>([
  "ai_generated", "human_touch", "status", "interface", "platforms", "audience", "data", "domain", "models", "frameworks",
]);

/** True when this facet is a real answer for this cohort rather than a line of the stand-in template. */
export function facetIsReal(facet: string, cohort: Cohort): boolean {
  return cohort === "opted" || !TEMPLATED_ON_TRAWL.has(facet);
}

export interface TrendRow { cohort: string; metric: string; period: string; key: string; n: number; mean_score: number | null }

// ---- pure shaping helpers (unit-tested; the SQL around them is deliberately dumb) ----

/** `repos.source` in the language of the dashboard. */
export const cohortOf = (source: string): Cohort => (source === "trawl" ? "trawl" : "opted");

/**
 * The trawl's reject reasons, bucketed for the funnel. The strings come from lib/virtual.ts and jobs/trawl.ts,
 * so in practice this is a closed set; anything new lands in "something else" rather than inventing a category.
 */
export function netBucket(reason: string): string {
  const r = String(reason ?? "").toLowerCase();
  if (r.startsWith("judge: tool-for-ai-coding")) return "a tool for people coding with AI";
  if (r.startsWith("judge: list-or-template")) return "a list, guide or template";
  if (r.startsWith("judge: needs-disclosure")) return "needs disclosures it does not make";
  if (r.startsWith("judge: low-effort")) return "a stub with no real README";
  if (r.startsWith("judge: not-ai-made")) return "the claim was not about this code";
  if (r.startsWith("judge:")) return "the judge could not tell";
  if (r.includes("past-tense claim")) return "never claims a model wrote it";
  if (r.startsWith("license ") || r.includes("permissive list")) return "a licence we cannot quote from";
  if (r.startsWith("denylist")) return "tripped the denylist";
  if (r.includes("prompt pack") || r.includes("not vibe-coded software")) return "writing about vibe coding, not vibe-coded";
  if (r.includes("org-owned")) return "owned by an org, so nobody could claim or remove it";
  if (r.includes("stars")) return "outside the star window";
  if (r.includes("pushed")) return "not touched in 90 days";
  if (r.includes("description")) return "no description to quote";
  if (r.includes("already")) return "already known here";
  return "something else";
}

/** The gate that stopped a submission, in the words its own page uses (lib/scan.ts POLICY_LABELS). */
export function gateLabel(gate: string): string {
  return ({
    denylist: "prohibited terms or links",
    metadata: "repository eligibility",
    contract: "the slopscore.md paperwork",
    content: "content policy",
    risk: "risk review",
    "owner-request": "the owner asked",
    admin: "a moderator",
  } as Record<string, string>)[gate] ?? "no report stored";
}

/** How old the repo was when it was listed: the closest thing we have to how fast this stuff appears. */
export function ageBucket(createdAt: number | null, listedAt: number | null): string | null {
  if (!createdAt || !listedAt || listedAt < createdAt) return null;
  const d = (listedAt - createdAt) / 86400;
  if (d < 7) return "under a week old";
  if (d < 30) return "under a month";
  if (d < 90) return "one to three months";
  if (d < 365) return "three months to a year";
  return "over a year old";
}

/** Star buckets. The trawl only ever looks at MIN_STARS..MAX_STARS (../lib/virtual), so its two ends are a rule, not a finding. */
export function starBucket(stars: number): string {
  if (stars < 5) return "under 5";
  if (stars < 10) return "5 to 9";
  if (stars < 25) return "10 to 24";
  if (stars < 100) return "25 to 99";
  if (stars < 500) return "100 to 499";
  return "500 or more";
}

/** The last `n` months, oldest first, as YYYY-MM. The series x-axis, so a quiet month still gets a column. */
export function monthsBack(at: number, n = TRENDS_MONTHS): string[] {
  const d = new Date(at * 1000);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    out.push(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  }
  return out;
}

/** The last `n` ISO weeks, oldest first, as YYYY-Www. Sibling of monthsBack for the weekly series. */
export function weeksBack(at: number, n = TRENDS_WEEKS): string[] {
  const monday = weekStart(isoWeek(at))!;
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(isoWeek(monday - i * 7 * 86400));
  return out;
}

/**
 * Which grain the page draws a time series at. Months once three of them have anything in, weeks until then;
 * no weekly series at all (a snapshot from before it existed) means months, whatever they look like.
 */
export function pickGrain(months: { total: number }[], weeks: { total: number }[] | undefined): "month" | "week" {
  if (!weeks?.length) return "month";
  return months.filter((m) => m.total > 0).length >= 3 ? "month" : "week";
}

/** Top `n`, biggest first, ties broken by name so the snapshot is stable from one night to the next. */
export function topN<T extends { key: string; n: number }>(rows: T[], n = TOP_N): T[] {
  return [...rows].sort((a, b) => b.n - a.n || a.key.localeCompare(b.key)).slice(0, n);
}

// ---- the nightly pass ----

interface Out { cohort: string; metric: string; period: string; key: string; n: number; mean?: number | null }

/**
 * Recompute today's snapshot. Idempotent: a second run in the same day replaces the day's rows rather than
 * doubling them, so a manual `/__cron?cron=trends` is always safe.
 */
export async function snapshotTrends(env: Env, at = now()): Promise<{ date: string; rows: number; listed: Record<string, number> }> {
  const db = env.DB;
  const day = isoDate(at);
  const months = monthsBack(at);
  const since = months[0];
  const weeks = weeksBack(at);
  const out: Out[] = [];

  // 1. The corpus as it stands: every charted facet for both cohorts, one grouped pass.
  const ph = CHART_FACETS.map(() => "?").join(",");
  const facets = await db.prepare(
    `SELECT r.source AS source, rt.facet AS facet, rt.value AS value, count(*) AS n, avg(r.score) AS mean
       FROM repo_tags rt JOIN repos r ON r.id = rt.repo_id
      WHERE r.status = 'listed' AND rt.facet IN (${ph})
      GROUP BY r.source, rt.facet, rt.value`,
  ).bind(...CHART_FACETS).all<{ source: string; facet: string; value: string; n: number; mean: number }>();
  const byFacet = new Map<string, { key: string; n: number; mean: number }[]>();
  for (const r of facets.results ?? []) {
    const cohort = cohortOf(r.source);
    if (!facetIsReal(r.facet, cohort)) continue; // a template line is not an answer
    const k = `${cohort}|${r.facet}`;
    const list = byFacet.get(k) ?? [];
    list.push({ key: r.value, n: r.n, mean: r.mean });
    byFacet.set(k, list);
  }
  for (const [k, rows] of byFacet) {
    const [cohort, metric] = k.split("|");
    // Means are stored to one decimal: the JSON is a public dataset, not a float dump.
    for (const t of topN(rows, metric === CLOUD_FACET ? CLOUD_N : TOP_N)) out.push({ cohort, metric, period: "", key: t.key, n: t.n, mean: t.mean == null ? null : Math.round(t.mean * 10) / 10 });
  }

  // 2. Headline totals plus the star and age shapes, from one scan of the listed repos.
  // One row per listed repo, counted in memory: eight small columns, so this stays comfortable into six figures
  // of listings. If the trough ever outgrows that, this becomes several GROUP BY passes instead.
  const repos = await db.prepare(
    "SELECT source, tier, stars, score, listed_at, gh_created_at, owner, demo_url FROM repos WHERE status = 'listed'",
  ).all<{ source: string; tier: string; stars: number; score: number; listed_at: number | null; gh_created_at: number | null; owner: string; demo_url: string | null }>();
  const blank = () => ({ listed: 0, submitted: 0, with_demo: 0, stars: 0, score: 0, new_30d: 0, owners: new Set<string>() });
  const totals: Record<Cohort, ReturnType<typeof blank>> = { trawl: blank(), opted: blank() };
  const counts = new Map<string, number>(); // "cohort|metric|period|key" -> n
  // Every month on the axis, including the empty ones: a quiet month is a fact about the year, and without
  // a zero here the chart would silently close the gap and make the run look steadier than it was.
  for (const m of months) for (const c of COHORTS) counts.set(`${c}|listings|${m}|listed`, 0);
  for (const w of weeks) for (const c of COHORTS) counts.set(`${c}|listings_w|${w}|listed`, 0);
  const add = (cohort: string, metric: string, period: string, key: string) => {
    const k = `${cohort}|${metric}|${period}|${key}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  };
  for (const r of repos.results ?? []) {
    const cohort = cohortOf(r.source);
    const t = totals[cohort];
    t.listed++;
    if (r.tier === "submitted") t.submitted++;
    if (r.demo_url) t.with_demo++;
    t.stars += r.stars ?? 0;
    t.score += r.score ?? 0;
    if (r.listed_at && r.listed_at >= at - 30 * 86400) t.new_30d++;
    t.owners.add(r.owner);
    add(cohort, "stars", "", starBucket(r.stars ?? 0));
    const age = ageBucket(r.gh_created_at, r.listed_at);
    if (age) add(cohort, "age", "", age);
    const month = isoDate(r.listed_at).slice(0, 7);
    if (month && month >= since) add(cohort, "listings", month, "listed");
    if (r.listed_at) {
      const week = isoWeek(r.listed_at);
      if (week >= weeks[0]) add(cohort, "listings_w", week, "listed");
    }
  }
  for (const cohort of COHORTS) {
    const t = totals[cohort];
    const mean = (sum: number) => (t.listed ? Math.round(sum / t.listed) : 0);
    for (const [key, n] of [
      ["listed", t.listed], ["owners", t.owners.size], ["submitted", t.submitted], ["with_demo", t.with_demo],
      ["new_30d", t.new_30d], ["mean_stars", mean(t.stars)], ["mean_score", mean(t.score)],
    ] as [string, number][]) out.push({ cohort, metric: "totals", period: "", key, n });
  }

  // 3. Which tool gets the credit, month by month and week by week. Derived from listed_at, so both series are
  //    complete on day one rather than starting the night this job first ran. Grouped by day in SQL -- SQLite's
  //    week formats are not ISO weeks, and D1's version is not pinned -- then folded into months and weeks here.
  const monthSince = Date.UTC(Number(since.slice(0, 4)), Number(since.slice(5, 7)) - 1, 1) / 1000;
  const weekSince = weekStart(weeks[0]) ?? monthSince;
  const series = await db.prepare(
    // repo_tags has a `source` column too, so every reference here stays qualified or aliased apart.
    `SELECT r.source AS repo_source, (r.listed_at / 86400) AS day, rt.value AS value, count(*) AS n
       FROM repo_tags rt JOIN repos r ON r.id = rt.repo_id
      WHERE r.status = 'listed' AND rt.facet = 'built_with' AND r.listed_at >= ?
      GROUP BY r.source, day, rt.value`,
  ).bind(Math.min(monthSince, weekSince)).all<{ repo_source: string; day: number; value: string; n: number }>();
  const seriesRows = series.results ?? [];
  const toolTotals = new Map<string, number>();
  for (const r of seriesRows) toolTotals.set(r.value, (toolTotals.get(r.value) ?? 0) + r.n);
  const tracked = new Set(topN([...toolTotals].map(([key, n]) => ({ key, n })), SERIES_TOOLS).map((t) => t.key));
  const folded = new Map<string, number>();
  for (const r of seriesRows) {
    const ts = r.day * 86400;
    const cohort = cohortOf(r.repo_source);
    const key = tracked.has(r.value) ? r.value : "other";
    const month = isoDate(ts).slice(0, 7);
    const week = isoWeek(ts);
    if (month >= since) folded.set(`${cohort}|tool|${month}|${key}`, (folded.get(`${cohort}|tool|${month}|${key}`) ?? 0) + r.n);
    if (week >= weeks[0]) folded.set(`${cohort}|tool_w|${week}|${key}`, (folded.get(`${cohort}|tool_w|${week}|${key}`) ?? 0) + r.n);
  }
  for (const [k, n] of folded) {
    const [cohort, metric, period, key] = k.split("|");
    out.push({ cohort, metric, period, key, n });
  }

  // 4. The net: what the auto-trawl looked at over 30 days and threw back. Free, because the reasons are
  //    already written down so that the same repo is never evaluated twice.
  const net = await db.prepare("SELECT reason, count(*) AS n FROM trawl_skipped WHERE at >= ? GROUP BY reason").bind(at - 30 * 86400).all<{ reason: string; n: number }>();
  const netBuckets = new Map<string, number>();
  for (const r of net.results ?? []) {
    const b = netBucket(r.reason);
    netBuckets.set(b, (netBuckets.get(b) ?? 0) + r.n);
  }
  for (const t of topN([...netBuckets].map(([key, n]) => ({ key, n })), 10)) out.push({ cohort: "trawl", metric: "net", period: "", key: t.key, n: t.n });

  // 4b. The judge's own answers, over every candidate it ever looked at — the ones it let through (repos) and the
  //     larger number it did not (trawl_skipped). Free: the model was paid for at trawl time and the verdict is now
  //     written down instead of thrown away. This is the only near-random read this site has on what people are
  //     building, so both halves are counted and the page keeps them apart.
  const verdicts = await db.batch<{ k: string; n: number }>([
    db.prepare("SELECT judge_code AS k, count(*) AS n FROM repos WHERE source = 'trawl' AND judge_code IS NOT NULL GROUP BY judge_code"),
    db.prepare("SELECT judge_code AS k, count(*) AS n FROM trawl_skipped WHERE judge_code IS NOT NULL GROUP BY judge_code"),
    db.prepare("SELECT judge_domain AS k, count(*) AS n FROM repos WHERE source = 'trawl' AND judge_domain IS NOT NULL GROUP BY judge_domain"),
    db.prepare("SELECT judge_domain AS k, count(*) AS n FROM trawl_skipped WHERE judge_domain IS NOT NULL GROUP BY judge_domain"),
  ]);
  // cohort is reused here as "which side of the decision", which is what the split means for a judged candidate.
  for (const [i, metric, side] of [[0, "verdict", "listed"], [1, "verdict", "thrown-back"], [2, "use", "listed"], [3, "use", "thrown-back"]] as [number, string, string][]) {
    for (const r of verdicts[i]?.results ?? []) if (r.k) out.push({ cohort: side, metric, period: "", key: String(r.k), n: r.n });
  }

  // 5. The other door: which gate turned a submission away. The gate name is already in the stored report.
  const gates = await db.prepare(
    `SELECT coalesce(json_extract(scan, '$.policy'), 'unknown') AS gate, count(*) AS n
       FROM repos WHERE status IN ('rejected','quarantined') AND source = 'marker' GROUP BY gate`,
  ).all<{ gate: string; n: number }>();
  for (const g of gates.results ?? []) out.push({ cohort: "opted", metric: "turned-away", period: "", key: gateLabel(String(g.gate)), n: g.n });

  for (const [k, n] of counts) {
    const [cohort, metric, period, key] = k.split("|");
    out.push({ cohort, metric, period, key, n });
  }

  // Replace the day rather than appending to it, then drop snapshots nobody will chart again.
  await db.prepare("DELETE FROM trends_daily WHERE date = ?").bind(day).run();
  for (let i = 0; i < out.length; i += 100) {
    await db.batch(out.slice(i, i + 100).map((r) =>
      db.prepare("INSERT OR REPLACE INTO trends_daily (date, cohort, metric, period, key, n, mean_score) VALUES (?,?,?,?,?,?,?)")
        .bind(day, r.cohort, r.metric, r.period, r.key, r.n, r.mean ?? null)));
  }
  await db.prepare("DELETE FROM trends_daily WHERE date < ?").bind(isoDate(at - TRENDS_KEEP_DAYS * 86400)).run();
  await markDirty(db);
  return { date: day, rows: out.length, listed: { trawl: totals.trawl.listed, opted: totals.opted.listed } };
}

// ---- the read side ----

export interface Bar { key: string; n: number; share: number; mean: number | null }
export interface FacetChart { facet: ChartFacet; trawl: Bar[]; opted: Bar[] }
export interface ToolMonth { period: string; total: number; parts: { key: string; n: number; share: number }[] }
/** Two sides of one decision, plus the whole sample: the judged population is small, so the n travels with it. */
export interface JudgedChart { all: Bar[]; listed: Bar[]; thrown_back: Bar[]; n_listed: number; n_thrown_back: number }

export interface TrendsView {
  date: string;
  months: string[];
  /** The weekly axis. Empty on a snapshot written before the weekly series existed, and the page then draws months. */
  weeks: string[];
  /** Which axis the page draws the time series on (jobs/trends pickGrain). Both series are always in the JSON. */
  granularity: "month" | "week";
  totals: Record<Cohort, Record<string, number>>;
  facets: FacetChart[];
  listings: { period: string; trawl: number; opted: number; total: number }[];
  tools: { keys: string[]; months: ToolMonth[] };
  /** The same two series by ISO week. `tools_w.months` is a list of weeks; the shape is shared so one component draws both. */
  listings_w: { period: string; trawl: number; opted: number; total: number }[];
  tools_w: { keys: string[]; months: ToolMonth[] };
  /** GitHub topics, long tail included: the tag cloud. Drawn instead of a bar pair, never as well as one. */
  cloud: Record<Cohort, Bar[]>;
  /** What the judge said the software is for, over every candidate it saw. */
  use: JudgedChart;
  /** What the judge said the repo *is*: app, game, tool, library, hardware, or one of the reasons to pass. */
  verdict: JudgedChart;
  net: Bar[];
  turned_away: Bar[];
  stars: Record<Cohort, Bar[]>;
  age: Record<Cohort, Bar[]>;
}

/** Counted rows to drawable bars: sorted, and each one sized against the biggest in its own chart. */
function bars(rows: TrendRow[]): Bar[] {
  const sorted = [...rows].sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
  const max = sorted[0]?.n ?? 0;
  return sorted.map((r) => ({ key: r.key, n: r.n, share: max ? r.n / max : 0, mean: r.mean_score }));
}

/** Keeps a bucketed axis in its natural order rather than by size: "under a week" before "over a year". */
const inOrder = (rows: Bar[], order: string[]): Bar[] => order.map((k) => rows.find((r) => r.key === k)).filter((x): x is Bar => Boolean(x));
export const STAR_ORDER = ["under 5", "5 to 9", "10 to 24", "25 to 99", "100 to 499", "500 or more"];
export const AGE_ORDER = ["under a week old", "under a month", "one to three months", "three months to a year", "over a year old"];

/** The whole dashboard in one query against the newest snapshot, served from cache between data versions. */
export async function loadTrends(db: D1Database): Promise<TrendsView | null> {
  return cached(db, "trends:v2", async () => {
    const latest = await db.prepare("SELECT max(date) AS d FROM trends_daily").first<{ d: string | null }>();
    if (!latest?.d) return null;
    const rows = (await db.prepare("SELECT cohort, metric, period, key, n, mean_score FROM trends_daily WHERE date = ?").bind(latest.d).all<TrendRow>()).results ?? [];
    return shapeTrends(latest.d, rows);
  });
}

/** Pure: snapshot rows in, dashboard out. Keeps the view free of SQL and the shaping testable. */
export function shapeTrends(date: string, rows: TrendRow[]): TrendsView {
  const pick = (cohort: string, metric: string, period = "") => rows.filter((r) => r.cohort === cohort && r.metric === metric && r.period === period);
  const totals = Object.fromEntries(COHORTS.map((c) => [c, Object.fromEntries(pick(c, "totals").map((r) => [r.key, r.n]))])) as TrendsView["totals"];

  // The cloud facet is drawn as a cloud, so it is lifted out of the bar-chart list rather than shown twice.
  const facets: FacetChart[] = CHART_FACETS
    .filter((facet) => facet !== CLOUD_FACET)
    .map((facet) => ({ facet, trawl: bars(pick("trawl", facet)), opted: bars(pick("opted", facet)) }))
    .filter((f) => f.trawl.length + f.opted.length > 0);
  const cloud = { trawl: bars(pick("trawl", CLOUD_FACET)), opted: bars(pick("opted", CLOUD_FACET)) };

  /** One judged metric: each side on its own, plus the two added together, which is the only sample worth a %. */
  const judged = (metric: string): JudgedChart => {
    const listed = pick("listed", metric);
    const thrown = pick("thrown-back", metric);
    const merged = new Map<string, number>();
    for (const r of [...listed, ...thrown]) merged.set(r.key, (merged.get(r.key) ?? 0) + r.n);
    return {
      all: bars([...merged].map(([key, n]) => ({ cohort: "", metric, period: "", key, n, mean_score: null }))),
      listed: bars(listed), thrown_back: bars(thrown),
      n_listed: listed.reduce((a, r) => a + r.n, 0), n_thrown_back: thrown.reduce((a, r) => a + r.n, 0),
    };
  };

  // Two grains of the same two series. The axis for each is its own metrics' periods: a weekly period must never
  // leak into the month axis, or the month chart grows a column called 2026-W37.
  const periodsOf = (...metrics: string[]) => [...new Set(rows.filter((r) => r.period && metrics.includes(r.metric)).map((r) => r.period))].sort();
  const months = periodsOf("listings", "tool");
  const weeks = periodsOf("listings_w", "tool_w");
  const at = (cohort: string, metric: string, period: string, key?: string) =>
    rows.filter((r) => r.cohort === cohort && r.metric === metric && r.period === period && (key === undefined || r.key === key)).reduce((s, r) => s + r.n, 0);
  const listingsOn = (metric: string, axis: string[]) => axis.map((period) => {
    const trawl = at("trawl", metric, period);
    const opted = at("opted", metric, period);
    return { period, trawl, opted, total: trawl + opted };
  });

  // One key order for both grains, so a tool keeps its colour when the page switches from weeks to months.
  const toolRows = rows.filter((r) => r.metric === "tool" || r.metric === "tool_w");
  const byTool = new Map<string, number>();
  for (const r of toolRows.filter((r) => r.metric === "tool")) byTool.set(r.key, (byTool.get(r.key) ?? 0) + r.n);
  for (const r of toolRows.filter((r) => r.metric === "tool_w")) if (!byTool.has(r.key)) byTool.set(r.key, 0);
  // "other" is a bucket, not a tool: it sorts last however big it gets.
  const keys = [...byTool].sort((a, b) => (a[0] === "other" ? 1 : b[0] === "other" ? -1 : b[1] - a[1] || a[0].localeCompare(b[0]))).map(([k]) => k);
  const toolsOn = (metric: string, axis: string[]): ToolMonth[] => axis.map((period) => {
    const here = toolRows.filter((r) => r.metric === metric && r.period === period);
    const total = here.reduce((s, r) => s + r.n, 0);
    const parts = keys
      .map((key) => ({ key, n: here.filter((r) => r.key === key).reduce((s, r) => s + r.n, 0) }))
      .filter((p) => p.n > 0)
      .map((p) => ({ ...p, share: total ? p.n / total : 0 }));
    return { period, total, parts };
  });
  const listings = listingsOn("listings", months);
  const listings_w = listingsOn("listings_w", weeks);

  return {
    date, months, weeks, granularity: pickGrain(listings, listings_w), totals, facets, listings, listings_w, cloud,
    use: judged("use"), verdict: judged("verdict"),
    tools: { keys, months: toolsOn("tool", months) },
    tools_w: { keys, months: toolsOn("tool_w", weeks) },
    net: bars(pick("trawl", "net")),
    turned_away: bars(pick("opted", "turned-away")),
    stars: { trawl: inOrder(bars(pick("trawl", "stars")), STAR_ORDER), opted: inOrder(bars(pick("opted", "stars")), STAR_ORDER) },
    age: { trawl: inOrder(bars(pick("trawl", "age")), AGE_ORDER), opted: inOrder(bars(pick("opted", "age")), AGE_ORDER) },
  };
}
