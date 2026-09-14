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
//      is always safe, which is what lets the job ride the existing nightly cron instead of asking for a fifth
//      trigger the free plan does not have.
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
import { isoDate, now } from "../lib/time";
import { METHOD_VERSION, LISTABLE_CODES } from "../lib/method";
import { COHORT_LABEL, type Cohort, type TrendRow } from "./trends";

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

/** ISO-8601 week, `YYYY-Www`. The week owns the report, not the day the job happened to run. */
export function isoWeek(at: number): string {
  const d = new Date(at * 1000);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = (new Date(day).getUTCDay() + 6) % 7;            // Monday = 0
  const thursday = day + (3 - dow) * 86400000;                // the week's Thursday names its year
  const year = new Date(thursday).getUTCFullYear();
  const jan4 = Date.UTC(year, 0, 4);
  const week1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * 86400000;
  return `${year}-W${String(Math.round((thursday - week1) / (7 * 86400000)) + 1).padStart(2, "0")}`;
}

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
}

/** Pure: two days of snapshot rows in, a report out. The SQL around it is deliberately dumb. */
export function shapeReport(slug: string, date: string, since: string | null, nowRows: TrendRow[], prevRows: TrendRow[]): ReportView {
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
  };
}

// ---- the bulletin (pure, templated, no model) ----

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
const points = (x: number) => `${x > 0 ? "+" : "−"}${(Math.abs(x) * 100).toFixed(1)} points`;

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
  return `${head}, ${points(m.points)} on ${m.was}`;
}

/** The caveat a small section gets instead of a trend. Printed, not omitted: n is the finding at this size. */
const noise = (n: number, floor = NOISE_FLOOR) => (n < floor ? ` On n=${n} a week's movement here is noise; it is printed because the count is, not because it means anything yet.` : "");

/** Which column a section was counted over, said out loud whenever it is not the near-random one. */
const counted = (s: Section) => (s.cohort === "trawl" ? "" : " Counted over the **opted-in** repos — the trawl has nothing here yet — so this is a fact about volunteers, not about makers.");

/** The report as published. Frozen into the row at write time, so this function never rewrites an old week. */
export function reportMd(r: ReportView): string {
  const out: string[] = [];
  const push = (...xs: string[]) => out.push(...xs);

  push(`# The Trawl Report · ${r.slug}`, "");
  push(
    r.first
      ? `First one. Counted from the snapshot of ${r.date}; there is no earlier snapshot to compare against, so nothing below moves yet. Method v${r.method}.`
      : `Counted from the snapshot of ${r.date} against ${r.since}. Method v${r.method}. Nothing here was written by a model: every sentence is a template with a count in it.`,
    "",
  );
  push(`> The Cap'm counts what he hauled and what he threw back. Read [how we count](/method) before you quote any of it — particularly the tool numbers, which measure how loudly a tool's users say its name and not what anybody uses.`, "");

  push("## The trough", "");
  push(
    `${r.totals.listed.toLocaleString()} repos listed${r.totals.added == null ? "" : `, ${signed(r.totals.added)} this week`} across ${r.totals.owners.toLocaleString()} owners.`,
    `- ${COHORT_LABEL.trawl}: ${r.totals.trawl.toLocaleString()}${r.totals.added_trawl == null ? "" : ` (${signed(r.totals.added_trawl)})`} — found by us, never asked to be here`,
    `- ${COHORT_LABEL.opted}: ${r.totals.opted.toLocaleString()}${r.totals.added_opted == null ? "" : ` (${signed(r.totals.added_opted)})`} — committed a slopscore.md`,
    "",
  );

  push("## How much of it is software", "");
  if (!r.judged.seen) {
    push("The judge has not seen anything yet, so there is no pass rate to report.", "");
  } else {
    push(
      `Of the ${r.judged.seen.toLocaleString()} candidates the judge has looked at${r.judged.was_seen == null ? "" : ` (${signed(r.judged.seen - r.judged.was_seen)} this week)`}, **${pct(r.judged.software_share)} were software somebody made** — an app, a game, a tool, a library, or something with hardware attached. The rest were thrown back.`,
      "",
      "This is the number worth having, and the reason the trawl stores what it rejects. Every other leaderboard keeps only what it accepted and so cannot tell you what the pile looks like. What the judge saw, best first:",
      "",
      ...r.judged.codes.slice(0, 8).map((m) => `- ${line(m, r.first)}`),
      "",
      `Both of those are a model's labels off a closed list, not a maker's — the only judged numbers in this bulletin, marked as such wherever they appear.${noise(r.judged.seen)}`,
      "",
    );
  }

  push("## Which tool gets the credit", "");
  if (!r.tools.total) {
    push("Nothing credits a tool by name yet, in either cohort.", "");
  } else {
    push(
      `${r.tools.total.toLocaleString()} credits across the ${r.tools.cohort === "trawl" ? "trawled" : "opted-in"} sample. A repo can name more than one tool, so the denominator is credits, not repos.`,
      "",
      ...r.tools.rows.slice(0, 8).map((m) => `- ${line(m, r.first)}`),
      "",
      `**Read this as: how loudly each tool's users say its name in public.** The trawl searches six grounds named after tools ([method](/method), bias 2), so a tool whose users never tag or describe their repos is undercounted here by construction. It is not market share and it is not usage.${counted(r.tools)}${noise(r.tools.total, TOOL_NOISE_FLOOR)}`,
      "",
    );
    const moved = bigMoves(r.tools.rows);
    if (moved.length) push(`Biggest swings: ${moved.map((m) => `${m.key} ${points(m.points!)}`).join(", ")}.`, "");
  }

  push("## What it is written in", "");
  if (!r.languages.total) push("No languages counted yet.", "");
  else {
    push(...r.languages.rows.slice(0, 8).map((m) => `- ${line(m, r.first)}`), "");
    const fresh = r.first ? [] : newcomers(r.languages.rows);
    if (fresh.length) push(`New in the sample this week: ${fresh.map((m) => `${m.key} (${m.n})`).join(", ")}.`, "");
    push(`Denominator: ${r.languages.total.toLocaleString()} ${r.languages.cohort === "trawl" ? "trawled" : "opted-in"} repos GitHub gave a language for.${counted(r.languages)}${noise(r.languages.total)}`, "");
  }

  push("## What the net threw back", "");
  if (!r.net.total) push("Nothing evaluated and rejected in the last 30 days.", "");
  else {
    push(
      `${r.net.total.toLocaleString()} candidates evaluated in the last 30 days and not listed, by reason. This is a rolling 30-day window, so week-over-week movement here is the mix changing, not a week's intake.`,
      "",
      ...r.net.rows.slice(0, 8).map((m) => `- ${line(m, r.first)}`),
      "",
    );
  }

  push("## The small print", "");
  push(
    `- Method v${r.method}, frozen and versioned: [/method](/method). If a rule changes, the version goes up and the change is dated.`,
    "- This site measures software whose author **says in public** that an AI tool wrote it. It does not measure AI-written software, and no number here can.",
    `- The numbers this bulletin was written from: [\`/report/${r.slug}.json\`](/report/${r.slug}.json). They are frozen with it and will still be there when the snapshot behind them has been pruned.`,
    "- Something wrong? [Say so](/contact). Corrections are published in the next bulletin, never edited in quietly.",
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

  const view = shapeReport(slug, latest.d, since, await snapshotRows(db, latest.d), since ? await snapshotRows(db, since) : []);
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

/** The archive, newest first, without dragging every body along with it. */
export async function listReports(db: D1Database, limit = 52): Promise<{ slug: string; at: number; title: string; method: number }[]> {
  const r = await db.prepare("SELECT slug, at, title, method FROM bulletins ORDER BY at DESC LIMIT ?").bind(limit).all<{ slug: string; at: number; title: string; method: number }>();
  return r.results ?? [];
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
