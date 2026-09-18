// The Trawl Report: one bulletin a week, written by counting, published without anyone pressing a button.
//
// Why this exists at all. /trends is a dashboard, and a dashboard is a thing people look at once. A report is a
// thing people can cite, argue with, and subscribe to, and it is the only artefact this site produces that is
// still worth reading a year later. It is also the only one that survives its own data: trends_daily is pruned
// after TRENDS_KEEP_DAYS, so a number quoted from a dashboard eventually becomes unverifiable. A report freezes
// the prose, the numbers behind it, and the method version in force that night, all three in one row.
//
// Three rules, and they are the whole design:
//
//   1. **No model is called.** Not one token. Every sentence is a template filled with a count, so the bulletin
//      cannot hallucinate, costs nothing, and needs no review before it goes out. That is what makes "fully
//      automatic" a safe thing to say rather than a thing to worry about.
//   2. **Every number carries its denominator and its caveat.** The interesting findings here are the ones a
//      competitor would rather we phrased loosely: tool share especially, which is query-shaped (see
//      lib/method.ts) and is never printed without saying so in the same paragraph.
//   3. **Idempotent.** The slug is the ISO week, so a second run in the same week writes nothing. A manual run
//      is always safe, which is what lets the job ride the existing nightly cron instead of needing a weekly
//      trigger of its own.
//
// It rides the 00:05 UTC daily round. On the report weekday it writes last week's bulletin and on every other
// day it returns "not the day" and costs one indexed read. The first report writes itself the first night there
// is anything to write, so a new deployment is not silent for six days.
//
// Distribution stops at the edge of this file, on purpose. The bulletin is published here, carried by RSS, and
// handed to whoever runs the newsletter as a finished, link-absolute draft in an email to the operator. What it
// does NOT do is keep a list of subscribers: that would mean storing strangers' email addresses, and the one
// promise this site has made from the first commit is that it stores nothing it does not own. A newsletter
// somebody else operates costs us no table, no double opt-in, no unsubscribe token, and no privacy policy.
import type { Env } from "../env";
import { markDirty } from "../lib/cache";
import { encodeHeader } from "../lib/mail";
import { pingIndexNow } from "../lib/indexnow";
import { escapeHtml, renderMarkdown } from "../lib/markdown";
import { isoDate, isoWeek, now } from "../lib/time";
import { METHOD_VERSION, LISTABLE_CODES } from "../lib/method";
import { PUSHED_WITHIN_DAYS, TRAWL_GROUNDS } from "../lib/virtual";
import { SEEN_STAR_ORDER } from "../lib/seen";
import { COHORT_LABEL, type Cohort, type TrendRow } from "./trends";
import { STATIC_TOOLS, allTools, loadToolRows } from "../lib/tools";

/** UTC weekday the bulletin goes out. 1 = Monday, so it covers the week that ended the night before. */
export const REPORT_WEEKDAY = 1;
/** Days back the report compares against. One week; the snapshot nearest that day is used. */
export const REPORT_SPAN_DAYS = 7;
/** How far back a comparison snapshot may be before the week is treated as having no "before". */
const COMPARE_SLACK_DAYS = 14;
/** Rows a section needs before its movement is quoted as anything but noise. */
const NOISE_FLOOR = 20;
/**
 * The same threshold for the tool chart, which needs a stricter one.
 *
 * Not because that chart is less reliable — because it is the one that gets screenshotted. "Tool X: 54%" is
 * the most quotable line in the bulletin and the most attackable, its caveat paragraph is already doing more
 * work than any other, and a repo can contribute more than one credit, so the count overstates how many
 * independent observations are behind it. It keeps the hedge until it has earned the right to drop it.
 */
const TOOL_NOISE_FLOOR = 50;
/** Movers printed per section. Enough to see a shape, few enough that the tail is not dressed as news. */
const MOVERS = 5;

/** ISO-8601 week, `YYYY-Www`. Lives in lib/time (the weekly trends series needs it too); re-exported so nothing that imported it here moves. */
export { isoWeek };

/** The week a run at `at` reports on: the one that ended yesterday. */
export const weekOf = (at: number): string => isoWeek(at - 86400);

export const isReportDay = (at: number): boolean => new Date(at * 1000).getUTCDay() === REPORT_WEEKDAY;

// ---- shaping (pure, and therefore the part with tests) ----

/** One row of a section: where it stands, where it stood a week ago, and the gap. */
export interface Move {
  key: string;
  n: number;
  was: number | null;
  added: number | null;
  share: number;
  was_share: number | null;
  /** Share points moved. The honest movement number: a section that grew moves every key's count and only some keys' share. */
  points: number | null;
}

/**
 * Two weeks of one metric, joined on key.
 *
 * Counts and shares both, because they answer different questions and each one alone misleads. A key can gain
 * twenty repos and lose share in a week the whole corpus doubled; a key can hold its share while the thing it
 * measures dies. `was` is null for a key that was not there last week, which is a different fact from zero and
 * is printed differently.
 */
export function movers(nowRows: TrendRow[], prevRows: TrendRow[]): Move[] {
  const total = nowRows.reduce((s, r) => s + r.n, 0);
  const wasTotal = prevRows.reduce((s, r) => s + r.n, 0);
  const before = new Map(prevRows.map((r) => [r.key, r.n]));
  return nowRows
    .map((r) => {
      const was = before.has(r.key) ? before.get(r.key)! : null;
      const share = total ? r.n / total : 0;
      const wasShare = was != null && wasTotal ? was / wasTotal : null;
      return { key: r.key, n: r.n, was, added: was == null ? null : r.n - was, share, was_share: wasShare, points: wasShare == null ? null : share - wasShare };
    })
    .sort((a, b) => b.n - a.n || a.key.localeCompare(b.key));
}

/** The rows that actually moved, biggest swing first. Ties and non-movers fall out. */
export const bigMoves = (rows: Move[], limit = MOVERS): Move[] =>
  rows.filter((r) => r.points != null && Math.abs(r.points) >= 0.005).sort((a, b) => Math.abs(b.points!) - Math.abs(a.points!)).slice(0, limit);

/** Keys that were not in last week's snapshot at all. New, not grown: a different sentence. */
export const newcomers = (rows: Move[], limit = MOVERS): Move[] => rows.filter((r) => r.was == null).slice(0, limit);

/**
 * One counted section, and which cohort it was counted over.
 *
 * The trawled cohort is the one worth reporting: nobody volunteered for it. But a site whose trawl has not run
 * yet still knows what its opted-in repos are written in, and printing "nothing yet" over a fact we hold is
 * worse than printing the fact with its caveat attached. So the section falls back, says which cohort it fell
 * back to, and the prose changes with it rather than quietly reading one column as if it were the other.
 */
export interface Section { cohort: Cohort; total: number; was_total: number | null; rows: Move[] }

/**
 * The sea (method v4): everything the searches return before the trough's rules, counted from the search
 * response alone. `first` is its own flag, because the sea can be a week old on a site whose trough is not:
 * the first bulletin after v4 has a trough to compare and no sea to compare it with.
 */
export interface SeaReport {
  seen: number;
  was_seen: number | null;
  owners: number;
  unstarred: number;
  unlicensed: number;
  candidates: number;
  first: boolean;
  sieve: Move[];
  stars: Move[];
  languages: Move[];
}

export interface ReportView {
  slug: string;
  /** Snapshot the report was written from, and the one it compared against. */
  date: string;
  since: string | null;
  method: number;
  /** No week before this one: the first report says so instead of printing dashes. */
  first: boolean;
  totals: { listed: number; trawl: number; opted: number; owners: number; added: number | null; added_trawl: number | null; added_opted: number | null };
  judged: { seen: number; was_seen: number | null; software: number; software_share: number; codes: Move[] };
  tools: Section;
  languages: Section;
  net: Section;
  /** Every tool key the credit was counted over that night, frozen with the numbers. Absent on bulletins written before v3. */
  registry?: string[];
  /** The searches' whole population, before any rule. Absent on a snapshot without a sea in it (before v4, or before the first sounding). */
  sea?: SeaReport;
}

/** Pure: two days of snapshot rows in, a report out. The SQL around it is deliberately dumb. */
export function shapeReport(slug: string, date: string, since: string | null, nowRows: TrendRow[], prevRows: TrendRow[], registry: string[] = STATIC_TOOLS.map((t) => t.key)): ReportView {
  const first = since == null || prevRows.length === 0;
  const prev = first ? [] : prevRows;
  const pick = (rows: TrendRow[], cohort: string, metric: string, period = "") =>
    rows.filter((r) => r.cohort === cohort && r.metric === metric && r.period === period);
  const total = (rows: TrendRow[], cohort: string, key: string) => pick(rows, cohort, "totals").find((r) => r.key === key)?.n ?? 0;

  const over = (cohort: Cohort, metric: string): Section => {
    const rows = movers(pick(nowRows, cohort, metric), pick(prev, cohort, metric));
    return { cohort, total: rows.reduce((s, r) => s + r.n, 0), was_total: first ? null : pick(prev, cohort, metric).reduce((s, r) => s + r.n, 0), rows };
  };
  const section = (metric: string): Section => {
    const trawled = over("trawl", metric);
    return trawled.total ? trawled : over("opted", metric);
  };

  const listedNow = total(nowRows, "trawl", "listed") + total(nowRows, "opted", "listed");
  const listedWas = first ? null : total(prev, "trawl", "listed") + total(prev, "opted", "listed");

  // The judge's verdict over everything it ever saw: the repos it let through and the larger number it threw
  // back. Both halves are one population — every candidate the trawl paid to look at — so they add up here.
  const verdictRows = [...pick(nowRows, "listed", "verdict"), ...pick(nowRows, "thrown-back", "verdict")];
  const verdictPrev = [...pick(prev, "listed", "verdict"), ...pick(prev, "thrown-back", "verdict")];
  const fold = (rows: TrendRow[]): TrendRow[] => {
    const by = new Map<string, number>();
    for (const r of rows) by.set(r.key, (by.get(r.key) ?? 0) + r.n);
    return [...by].map(([key, n]) => ({ cohort: "", metric: "verdict", period: "", key, n, mean_score: null }));
  };
  const codes = movers(fold(verdictRows), fold(verdictPrev));
  const seen = codes.reduce((s, r) => s + r.n, 0);
  const wasSeen = first ? null : verdictPrev.reduce((s, r) => s + r.n, 0);
  const software = codes.filter((r) => (LISTABLE_CODES as readonly string[]).includes(r.key)).reduce((s, r) => s + r.n, 0);

  // The sea has its own "first": a snapshot from before v4 has a trough to set this week against and no sea.
  const seaTotals = (rows: TrendRow[]) => Object.fromEntries(pick(rows, "seen", "totals").map((r) => [r.key, r.n])) as Record<string, number>;
  const seaNow = seaTotals(nowRows);
  const seaWas = seaTotals(prev);
  const seaFirst = first || !seaWas.seen;
  const seaPrev = seaFirst ? [] : prev;
  const sea: SeaReport | undefined = seaNow.seen
    ? {
      seen: seaNow.seen, was_seen: seaFirst ? null : seaWas.seen, owners: seaNow.owners ?? 0,
      unstarred: seaNow.unstarred ?? 0, unlicensed: seaNow.unlicensed ?? 0, candidates: seaNow.candidates ?? 0, first: seaFirst,
      sieve: movers(pick(nowRows, "seen", "sieve"), pick(seaPrev, "seen", "sieve")),
      stars: movers(pick(nowRows, "seen", "stars"), pick(seaPrev, "seen", "stars")),
      languages: movers(pick(nowRows, "seen", "language"), pick(seaPrev, "seen", "language")),
    }
    : undefined;

  return {
    slug, date, since: first ? null : since, method: METHOD_VERSION, first,
    totals: {
      listed: listedNow,
      trawl: total(nowRows, "trawl", "listed"),
      opted: total(nowRows, "opted", "listed"),
      owners: total(nowRows, "trawl", "owners") + total(nowRows, "opted", "owners"),
      added: listedWas == null ? null : listedNow - listedWas,
      added_trawl: first ? null : total(nowRows, "trawl", "listed") - total(prev, "trawl", "listed"),
      added_opted: first ? null : total(nowRows, "opted", "listed") - total(prev, "opted", "listed"),
    },
    judged: { seen, was_seen: wasSeen, software, software_share: seen ? software / seen : 0, codes },
    tools: section("built_with"),
    languages: section("language"),
    // No opted-in equivalent exists: only the trawl evaluates and rejects, so this one never falls back.
    net: over("trawl", "net"),
    registry,
    sea,
  };
}

// ---- the bulletin (pure, templated, no model) ----

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const points = (x: number) => `${x > 0 ? "+" : "−"}${(Math.abs(x) * 100).toFixed(1)} points`;
/** A week's change on a headline count: "+61 this week", or the honest "no change this week" rather than "+0". */
const thisWeek = (n: number | null) => (n == null ? "" : n === 0 ? ", no change this week" : `, ${signed(n)} this week`);
/** The same for a parenthesised sub-count. */
const paren = (n: number | null) => (n == null ? "" : n === 0 ? " (no change)" : ` (${signed(n)})`);
/** Small counts read better as words in running prose. */
const words = (n: number) => ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"][n] ?? String(n);

/**
 * One mover as a phrase. Says what it is now, then what moved, and never claims movement it cannot see.
 *
 * `first` is not decoration. On a week with nothing behind it every key is absent from the previous snapshot,
 * and calling all of them "new this week" would turn "we have no history" into a made-up finding about growth.
 */
function line(m: Move, first = false): string {
  const head = `**${m.key}** — ${m.n} (${pct(m.share)})`;
  if (first) return head;
  if (m.was == null) return `${head}, new this week`;
  if (m.points == null || Math.abs(m.points) < 0.005) return `${head}, flat`;
  return `${head}, ${points(m.points)} from ${m.was} (${pct(m.was_share!)})`;
}

/**
 * The caveat a small section gets instead of a trend. Printed, not omitted: n is the finding at this size.
 * On a first bulletin there is no movement to disown, so the warning is about the sample rather than the swing.
 */
const noise = (n: number, first: boolean, floor = NOISE_FLOOR) => (
  n >= floor ? ""
    : first ? ` At n=${n} the sample is too thin to lean on. It is printed because it is the count, not because it means anything yet.`
      : ` At n=${n} a week's swing is noise. Quote the count and leave the movement alone.`
);

/** Which column a section was counted over, said out loud whenever it is not the near-random one. */
const counted = (s: Section) => (s.cohort === "trawl" ? "" : " Counted over the **opted-in** repos, because the trawl has nothing here yet. That makes it a fact about volunteers, not about makers at large.");

/** The report as published. Frozen into the row at write time, so this function never rewrites an old week. */
export function reportMd(r: ReportView): string {
  const out: string[] = [];
  const push = (...xs: string[]) => out.push(...xs);

  push(`# The Trawl Report · ${r.slug}`, "");
  push(
    r.first
      ? `The first bulletin. Counted from the snapshot of ${r.date}, with no earlier snapshot to set it against, so nothing below moves yet. Method v${r.method}. No model wrote a word of this: every sentence is a template with a count in it.`
      : `Counted from the snapshot of ${r.date}, set against the one from ${r.since}. Method v${r.method}. No model wrote a word of this: every sentence is a template with a count in it.`,
    "",
  );
  push(`> The Cap'm counts what came up in the net and what went back over the side. Read [how we count](/method) before you quote any of it, the tool numbers most of all: they measure how loudly a tool's users say its name, not what anybody uses.`, "");

  // The sea comes first because it is the denominator of everything after it. It is only printed when the
  // snapshot has one: a bulletin from before v4 does not grow a section it was never written with.
  if (r.sea) {
    const s = r.sea;
    const share = (n: number) => pct(s.seen ? n / s.seen : 0);
    push("## The sea", "");
    push(
      `${s.seen.toLocaleString()} repos seen in the last ${PUSHED_WITHIN_DAYS} days that say in public an AI tool wrote them${thisWeek(s.was_seen == null ? null : s.seen - s.was_seen)}, from ${s.owners.toLocaleString()} owners. Counted from GitHub's search results alone: no star floor, no licence filter, no README read, no model asked, and nothing listed. This is the water the trough below is drawn from.`,
      "",
      `- **${share(s.unstarred)}** have no stars at all`,
      `- **${share(s.unlicensed)}** carry no licence`,
      `- **${share(s.candidates)}** would reach the judge under the trough's rules`,
      "",
    );
    const stars = SEEN_STAR_ORDER.map((k) => s.stars.find((m) => m.key === k)).filter((m): m is Move => Boolean(m));
    if (stars.length) push(`By stars: ${stars.map((m) => `${m.key} ${pct(m.share)}`).join(", ")}.`, "");
    const stopped = s.sieve.filter((m) => m.key !== "would reach the judge");
    if (stopped.length) push("What stops the rest, by the first rule that stopped it:", "", ...stopped.slice(0, 8).map((m) => `- ${line(m, s.first)}`), "");
    push(`The sea is the trough's own searches with the ropes taken off, so it inherits [bias 1 and bias 2](/method) whole: still repos whose owners said so, still found by searches named after tools. What it takes off is the star floor and the licence filter, and the three lines above are how much of the population those two rules hold back.${noise(s.seen, s.first)}`, "");
  }

  push("## The trough", "");
  push(
    `${r.totals.listed.toLocaleString()} repos listed${thisWeek(r.totals.added)}, from ${r.totals.owners.toLocaleString()} owners.`,
    `- ${COHORT_LABEL.trawl}: ${r.totals.trawl.toLocaleString()}${paren(r.totals.added_trawl)} — dragged out of public GitHub; nobody submitted them`,
    `- ${COHORT_LABEL.opted}: ${r.totals.opted.toLocaleString()}${paren(r.totals.added_opted)} — committed a slopscore.md and asked to be counted`,
    "",
  );

  push("## How much of it is software", "");
  if (!r.judged.seen) {
    push("The judge has not seen a candidate yet, so there is no pass rate to report.", "");
  } else {
    push(
      `The judge has looked at ${r.judged.seen.toLocaleString()} candidates so far${r.judged.was_seen == null ? "" : ` (${r.judged.seen - r.judged.was_seen === 0 ? "none new" : `${signed(r.judged.seen - r.judged.was_seen)} new`} this week)`}, and **${pct(r.judged.software_share)} were software somebody made**: an app, a game, a tool, a library, or something with hardware attached. The rest went back over the side.`,
      "",
      "That is the number this bulletin exists for, and the reason the trawl keeps what it rejects. A leaderboard that keeps only what it accepted can tell you what its winners look like and nothing about the pile they came out of. The pile, largest bucket first:",
      "",
      ...r.judged.codes.slice(0, 8).map((m) => `- ${line(m, r.first)}`),
      "",
      `These are a model's labels, picked from a closed list, not a maker's own words. They are the only judged numbers in the bulletin, and they say so wherever they appear.${noise(r.judged.seen, r.first)}`,
      "",
    );
  }

  push("## Which tool gets the credit", "");
  if (!r.tools.total) {
    push("No repo in either cohort credits a tool by name yet.", "");
  } else {
    push(
      `${r.tools.total.toLocaleString()} credits in the ${r.tools.cohort === "trawl" ? "trawled" : "opted-in"} sample. A repo can name more than one tool, so the shares are of credits, not of repos.`,
      "",
      ...r.tools.rows.slice(0, 8).map((m) => `- ${line(m, r.first)}`),
      "",
      `**Read this as how loudly each tool's users say its name in public.** Most of the trawl's ${words(TRAWL_GROUNDS.length)} grounds are named after a tool ([method](/method), bias 2), so a tool whose users never tag or describe their repos is undercounted by construction. It is not market share and it is not usage.${counted(r.tools)}${noise(r.tools.total, r.first, TOOL_NOISE_FLOOR)}`,
      "",
    );
    const moved = bigMoves(r.tools.rows);
    if (moved.length) push(`Biggest swings since last week: ${moved.map((m) => `${m.key} ${points(m.points!)}`).join(", ")}.`, "");
  }

  push("## What it is written in", "");
  if (!r.languages.total) push("No languages to count yet.", "");
  else {
    push(...r.languages.rows.slice(0, 8).map((m) => `- ${line(m, r.first)}`), "");
    // Only newcomers the list above did not already flag; a key in the top eight has said "new this week" itself.
    const shown = new Set(r.languages.rows.slice(0, 8).map((m) => m.key));
    const fresh = r.first ? [] : newcomers(r.languages.rows).filter((m) => !shown.has(m.key));
    if (fresh.length) push(`Also new to the sample this week, below the top eight: ${fresh.map((m) => `${m.key} (${m.n})`).join(", ")}.`, "");
    // repo_tags holds every language GitHub lists for a repo, so this is language credits, not repos.
    push(`Shares are of ${r.languages.total.toLocaleString()} language credits over the ${r.languages.cohort === "trawl" ? "trawled" : "opted-in"} sample. GitHub lists every language a repo uses, so one repo can count more than once.${counted(r.languages)}${noise(r.languages.total, r.first)}`, "");
  }

  push("## What the net threw back", "");
  if (!r.net.total) push("The net came up empty: nothing looked at and rejected in the last 30 days.", "");
  else {
    push(
      `${r.net.total.toLocaleString()} candidates looked at in the last 30 days and not listed, by reason. The window rolls, so movement here is the mix of reasons shifting, not one week's intake.`,
      "",
      ...r.net.rows.slice(0, 8).map((m) => `- ${line(m, r.first)}`),
      "",
    );
  }

  push("## The small print", "");
  push(
    `- Counted under method v${r.method}, frozen and versioned at [/method](/method). When a rule changes the version goes up and the change is dated; nothing is edited in place.`,
    "- This site measures software whose author **says in public** that an AI tool wrote it. It does not measure AI-written software, and no number here can.",
    ...(r.registry ? [`- Tool credit was counted over the ${r.registry.length} tools the dictionary held that night: ${r.registry.join(", ")}. A tool not on that list was not looked for. [Which tools were added, and when](/method).`] : []),
    ...(r.sea ? ["- The sea is counted from GitHub search results alone. Nothing in it is read, judged, listed or named, and its facts are as of the last time the sounding passed. [How it is sounded](/method)."] : []),
    `- The numbers behind every sentence above: [\`/report/${r.slug}.json\`](/report/${r.slug}.json), frozen with the bulletin and still there after the nightly snapshot they came from has been pruned.`,
    "- Spotted an error? [Say so](/contact). Corrections run in the next bulletin; nothing is edited in quietly.",
  );
  return out.join("\n");
}

export const reportTitle = (slug: string): string => `The Trawl Report · ${slug}`;

// ---- the write side ----

export interface ReportRow { slug: string; at: number; covers_from: string | null; covers_to: string; method: number; title: string; body: string; data: string }

const snapshotRows = (db: D1Database, date: string) =>
  db.prepare("SELECT cohort, metric, period, key, n, mean_score FROM trends_daily WHERE date = ?").bind(date).all<TrendRow>().then((r) => r.results ?? []);

/**
 * Write this week's bulletin, if it is owed one.
 *
 * Runs inside the nightly round every night and does nothing on six of them. The three ways it declines are all
 * cheap and all reported, because a job that silently does nothing is a job nobody notices has broken.
 */
export async function writeReport(env: Env, at = now(), opts: { force?: boolean } = {}): Promise<{ slug: string; wrote: boolean; why?: string; dispatch?: string }> {
  const db = env.DB;
  const slug = weekOf(at);
  if (!opts.force && await db.prepare("SELECT slug FROM bulletins WHERE slug = ?").bind(slug).first()) return { slug, wrote: false, why: "already written" };
  // The first bulletin does not wait for a Monday: a fresh deployment should not look abandoned for six days.
  const ever = await db.prepare("SELECT count(*) AS n FROM bulletins").first<{ n: number }>();
  if (!opts.force && !isReportDay(at) && (ever?.n ?? 0) > 0) return { slug, wrote: false, why: "not the day" };

  const latest = await db.prepare("SELECT max(date) AS d FROM trends_daily").first<{ d: string | null }>();
  if (!latest?.d) return { slug, wrote: false, why: "no snapshot to count" };
  // The nearest snapshot at or before a week ago, and only if the gap is a week rather than a gap.
  const before = await db.prepare("SELECT max(date) AS d FROM trends_daily WHERE date <= ? AND date >= ?")
    .bind(isoDate(at - REPORT_SPAN_DAYS * 86400), isoDate(at - COMPARE_SLACK_DAYS * 86400))
    .first<{ d: string | null }>();
  const since = before?.d && before.d !== latest.d ? before.d : null;

  const view = shapeReport(slug, latest.d, since, await snapshotRows(db, latest.d), since ? await snapshotRows(db, since) : [], allTools(await loadToolRows(db)).map((t) => t.key));
  const body = reportMd(view);
  await db.prepare(
    "INSERT INTO bulletins (slug, at, covers_from, covers_to, method, title, body, data) VALUES (?,?,?,?,?,?,?,?)" +
    " ON CONFLICT(slug) DO UPDATE SET at = excluded.at, covers_from = excluded.covers_from, covers_to = excluded.covers_to," +
    " method = excluded.method, title = excluded.title, body = excluded.body, data = excluded.data",
  ).bind(slug, at, view.since, view.date, view.method, reportTitle(slug), body, JSON.stringify(view)).run();
  await markDirty(db);
  // Publishing is done and durable by this line. The handoff mail is a convenience on top of it and is never
  // allowed to fail the job: a bulletin nobody mailed is still a bulletin, and the next run must not rewrite
  // a week just because an inbox was unreachable.
  // Tell the engines directly rather than waiting for the sitemap to be crawled. A bulletin is only news for
  // a few days, so "indexed by Thursday" and "indexed next week" are different features. Fails open: the URL
  // is in the sitemap either way, this only makes it sooner.
  await pingIndexNow(env, [`/report/${slug}`, "/report", "/"]).catch(() => false);
  const dispatch = await notifyReport(env, view, body).catch((e) => `send failed: ${(e as Error).message}`);
  return { slug, wrote: true, dispatch };
}

/** The newest bulletin, or a named week. */
export async function loadReport(db: D1Database, slug?: string): Promise<ReportRow | null> {
  return slug
    ? db.prepare("SELECT * FROM bulletins WHERE slug = ?").bind(slug).first<ReportRow>()
    : db.prepare("SELECT * FROM bulletins ORDER BY at DESC LIMIT 1").first<ReportRow>();
}

/** One line of the archive: the week, and the numbers it led with, read off the frozen JSON without parsing it. */
export interface ArchiveRow { slug: string; at: number; title: string; method: number; listed: number | null; added: number | null; seen: number | null; software_share: number | null }

/** Pure: an archive row with every number null-safe, so a bulletin whose JSON will not read still lists. */
export function archiveRow(r: { slug: string; at: number; title: string; method: number; listed?: unknown; added?: unknown; seen?: unknown; software_share?: unknown }): ArchiveRow {
  const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
  const seen = num(r.seen);
  return { slug: r.slug, at: r.at, title: r.title, method: r.method, listed: num(r.listed), added: num(r.added), seen, software_share: seen ? num(r.software_share) : null };
}

/**
 * The archive, newest first, without dragging every body along with it. The headline numbers come straight out
 * of the frozen JSON in SQL, so the list agrees with each bulletin by construction; json_valid guards the one
 * row that could otherwise take the whole archive down with it.
 */
export async function listReports(db: D1Database, limit = 52): Promise<ArchiveRow[]> {
  const r = await db.prepare(
    `SELECT slug, at, title, method,
            CASE WHEN json_valid(data) THEN json_extract(data, '$.totals.listed') END AS listed,
            CASE WHEN json_valid(data) THEN json_extract(data, '$.totals.added') END AS added,
            CASE WHEN json_valid(data) THEN json_extract(data, '$.judged.seen') END AS seen,
            CASE WHEN json_valid(data) THEN json_extract(data, '$.judged.software_share') END AS software_share
       FROM bulletins ORDER BY at DESC LIMIT ?`,
  ).bind(limit).all<{ slug: string; at: number; title: string; method: number; listed: unknown; added: unknown; seen: unknown; software_share: unknown }>();
  return (r.results ?? []).map(archiveRow);
}

// ---- handing it to the newsletter ----

/** Where the bulletin is mailed from, if anywhere. Null is a supported state: no link, no handoff, no fuss. */
export function newsletter(env: { NEWSLETTER_URL?: string; NEWSLETTER_NAME?: string }): { url: string; name: string } | null {
  const url = (env.NEWSLETTER_URL ?? "").trim();
  if (!/^https:\/\//i.test(url)) return null;
  const named = (env.NEWSLETTER_NAME ?? "").trim();
  try {
    return { url, name: named || new URL(url).hostname.replace(/^www\./, "") };
  } catch {
    return null;
  }
}

/**
 * Site-relative links made absolute.
 *
 * The bulletin is written for a page on this host, where `(/method)` is correct. The moment the same markdown
 * is pasted into somebody else's publication every one of those links is broken, and a newsletter full of dead
 * links is worse than no newsletter. So the copy that leaves the building is rewritten once, here, rather than
 * being left for a human to remember at the moment they are least likely to.
 */
export function absoluteLinks(md: string, site: string): string {
  const origin = site.replace(/\/+$/, "");
  return md.replace(/\]\((\/[^)\s]*)\)/g, (_m, path: string) => `](${origin}${path})`);
}

/**
 * The handoff mail: a finished draft, not a notification.
 *
 * Pure, so the thing an operator will actually paste can be asserted on in a test rather than discovered in an
 * inbox. It carries the whole bulletin with absolute links, because the job of this mail is to make publishing
 * a copy and a paste — the only manual step left in the week, and the one worth making dull.
 */
export function dispatchMail(view: ReportView, body: string, site: string, list: { url: string; name: string } | null): { subject: string; text: string; html: string } {
  const origin = site.replace(/\/+$/, "");
  const canonical = `${origin}/report/${view.slug}`;
  const preamble = [
    `${reportTitle(view.slug)} is published and live at ${canonical}.`,
    list
      // Substack does not let a publisher set a canonical URL: every post is canonical to substack.com. The
      // only lever is the "Originally published at" line at the top of the draft, so the instruction is to
      // leave it alone rather than to go looking for a setting that does not exist.
      ? `To mail it: open ${list.url}, select everything below the line, copy, paste, publish. ${canonical} is the citable address and ${list.name} is a copy of it, never the other way round — and since Substack will not let you set a canonical URL, the "Originally published at" line at the top of the draft is the only thing pointing search engines home. Leave it in.`
      : "No NEWSLETTER_URL is set, so this is for your records. The bulletin is published and on /report.xml regardless.",
    `Numbers behind it: ${canonical}.json · method v${view.method}: ${origin}/method`,
    view.first ? "This is the first one, so nothing in it moves yet." : `Compared against the snapshot of ${view.since}.`,
  ];
  // The line that makes a syndicated copy point home. It belongs in the copy that leaves the building and
  // nowhere else: on /report/{week} itself it would be a page telling the reader they are somewhere else.
  const syndicated = `*Originally published at [${canonical}](${canonical}).*

${absoluteLinks(body, origin)}`;
  return {
    subject: `[SlopScore] ${reportTitle(view.slug)} is up — ready to send`,
    text: [...preamble, "", "Links below are absolute, so they survive the paste.", "",
      "-----------------------------------------------------------------------", "", syndicated].join("\n"),
    // The HTML part is the bulletin already rendered, so select-copy-paste lands in a rich-text editor as
    // headings and links rather than as a screenful of asterisks. The plain-text part above stays the source
    // of record: a reader on a text-only client still gets the whole thing, in markdown, with live links.
    html: [
      '<div style="font:14px/1.5 system-ui,sans-serif;color:#444">',
      ...preamble.map((l) => `<p>${escapeHtml(l)}</p>`),
      "<p><strong>Select everything below the line, copy, and paste.</strong></p>",
      "</div>",
      '<hr style="margin:24px 0;border:0;border-top:2px solid #ccc">',
      '<div style="font:16px/1.6 system-ui,sans-serif">',
      renderMarkdown(syndicated),
      "</div>",
    ].join("\n"),
  };
}

/** Mail the operator their draft. Fails open in every direction: publishing already happened without it. */
export async function notifyReport(env: Env, view: ReportView, body: string): Promise<string> {
  const to = env.CONTACT_NOTIFY;
  if (!env.MAIL || !to) return "no MAIL binding or CONTACT_NOTIFY; the bulletin is on /report either way";
  const from = env.CONTACT_FROM ?? "schnitzel@slopscore.org";
  const { subject, text, html } = dispatchMail(view, body, env.SITE_URL ?? "https://slopscore.org", newsletter(env));
  // multipart/alternative: the same bulletin twice, and the client picks. The HTML part is what makes the
  // weekly job a copy and a paste rather than a copy, a paste, and then twenty minutes of putting the
  // headings back. The plain-text part is not a fallback nobody reads — it is the markdown source, and the
  // one a text-only client, a screen reader, or a future me grepping an archive actually wants.
  // The boundary is random per message so it can never collide with something inside the bulletin.
  const boundary = `--=_ss_${crypto.randomUUID().replace(/-/g, "")}`;
  const raw = [
    `From: Schnitzel <${from}>`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <report-${view.slug}-${Date.now()}@slopscore.org>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    "",
    `--${boundary}`,
    'Content-Type: text/html; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    "",
    `--${boundary}--`,
    "",
  ].join("\r\n");
  try {
    const { EmailMessage } = await import("cloudflare:email");
    await env.MAIL.send(new EmailMessage(from, to, raw));
    return "draft mailed";
  } catch (e) {
    return `send failed: ${(e as Error).message}`;
  }
}

/**
 * Just enough of the newest bulletin to advertise it, read off the frozen JSON rather than recomputed.
 *
 * The rail is on every page, so this has to be cheap: one indexed row, and the numbers are already sitting in
 * the `data` column exactly as they were published. Recounting them here would risk the sidebar and the
 * bulletin disagreeing about the same week, which is the one kind of inconsistency this whole feature exists
 * to avoid.
 */
export interface ReportTeaser { slug: string; at: number; listed: number; software_share: number | null }

export async function reportTeaser(db: D1Database): Promise<ReportTeaser | null> {
  const r = await db.prepare("SELECT slug, at, data FROM bulletins ORDER BY at DESC LIMIT 1").first<{ slug: string; at: number; data: string }>();
  if (!r) return null;
  const bare = { slug: r.slug, at: r.at, listed: 0, software_share: null };
  try {
    const d = JSON.parse(r.data) as ReportView;
    return { slug: r.slug, at: r.at, listed: d.totals?.listed ?? 0, software_share: d.judged?.seen ? d.judged.software_share : null };
  } catch {
    return bare; // a bulletin with unreadable JSON is still a bulletin worth linking
  }
}

/** The one-line pitch a card or a sidebar uses. Leads with the finding, falls back to the size of the pile. */
export function teaserLine(t: ReportTeaser): string {
  return t.software_share == null
    ? `${t.listed.toLocaleString()} repos counted, and what the net threw back.`
    : `${Math.round(t.software_share * 1000) / 10}% of what the net looked at was software somebody made. ${t.listed.toLocaleString()} repos counted.`;
}
