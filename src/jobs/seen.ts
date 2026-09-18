// Sounding the sea: the walk that fills trawl_seen (lib/seen.ts), riding the ten-minute tick.
//
// The same searches the trough works, with no star clause, walked through the same fixed windows of push
// date the trough uses (parseWindow, openWindow, afterPage in jobs/trawl.ts, reused here under keys of its
// own). Every result on every page becomes one row: the facts the search response carried, the shape of
// the claim it showed, and what the trough's rules would have said about it. Nothing is read beyond the
// search response, nothing is judged, and nothing is listed. That is what makes it cheap enough to run at
// zero stars: a page of fifty is one call and fifty upserts, and the judge never hears about any of it.
//
// It has no cron of its own. It rides `*/10` after the recrawl, which is the one tick that never shares a
// minute with the hourly trawl (:07) or a chase (:15, :25, :35...), so the two never contend for the thirty
// search calls GitHub allows in a minute. If the trawl is at sea anyway (its lease is held), this run stays
// in: the trawl lands listings and this only counts, and the count can wait ten minutes.
//
// Budgets: SEEN_CALLS a run, SEEN_PER_DAY a day (env, so a bad day can be paused without a deploy). At
// twelve a run and 144 ticks a day the initial pass over ninety days of the two big phrase searches takes a
// couple of days; after that the freshness pass reads what arrived since the last look and the deep walk
// re-reads the window from the top, refreshing stars and pushes as it goes.
import { GitHub } from "../lib/github";
import type { Env } from "../env";
import { loadDenyRows } from "../lib/denylist";
import { PUSHED_WITHIN_DAYS, TRAWL_QUERIES, registry, trawlQueryList, type Registry } from "../lib/virtual";
import { allTools, loadToolRows } from "../lib/tools";
import { seenQueryList, seenRow, type SeenRow } from "../lib/seen";
import { now } from "../lib/time";
import { bumpState, claimLock, getState, releaseLock, setState } from "./stats";
import {
  afterPage, deepQuery, freshQuery, narrowWindow, openWindow, parseWindow, formatWindow, worthWorking,
  FRESH_PAGES, PAGES_PER_QUERY, RESULT_CAP, WINDOW_SPAN,
} from "./trawl";

const PER_PAGE = 50;
/** Search calls one run may spend. Twelve of the thirty a minute allows, leaving room for whatever else shares the bucket. */
export const SEEN_CALLS = 12;
/** Searches one run works, in rotation. Three, so a big phrase search and two small topic ones share a run. */
export const SEEN_QUERIES_PER_RUN = 3;
/** Search calls per UTC day across every run, unless SEEN_PER_DAY says otherwise. Bounds the D1 writes as much as the calls. */
export const SEEN_PER_DAY = 240;
export function seenCap(env: { SEEN_PER_DAY?: string }): number {
  const n = Math.floor(Number(env.SEEN_PER_DAY));
  return Number.isFinite(n) && n >= 0 ? n : SEEN_PER_DAY;
}
/** How long one sounding holds the lease. A run is a minute; the lease outlives a hung one. */
export const SEEN_LOCK_TTL = 10 * 60;

/** Whether the trawl's lease is held right now: its value is the second the lease expires (jobs/stats claimLock). */
export function trawlAtSea(lock: string | null, at: number): boolean {
  const until = Number(lock);
  return Number.isFinite(until) && until > at;
}

export interface SoundingResult { searched: number; seen: number; note?: string }

/** The upsert: facts refresh on every sighting; provenance keeps its first. Exported for the database test. */
export function upsert(db: D1Database, r: SeenRow): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO trawl_seen (full_name, repo_id, ground, query, first_seen, last_seen, stars, forks, size_kb, open_issues, language, license, owner_type, created_at, pushed_at, described, topics_n, homepage, tool, signal, sieve)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(full_name) DO UPDATE SET last_seen = excluded.last_seen, stars = excluded.stars, forks = excluded.forks, size_kb = excluded.size_kb,
       open_issues = excluded.open_issues, language = excluded.language, license = excluded.license, pushed_at = excluded.pushed_at,
       described = excluded.described, topics_n = excluded.topics_n, homepage = excluded.homepage, tool = excluded.tool, signal = excluded.signal, sieve = excluded.sieve`,
  ).bind(
    r.full_name, r.repo_id, r.ground, r.query, r.at, r.at, r.stars, r.forks, r.size_kb, r.open_issues, r.language, r.license, r.owner_type,
    r.created_at, r.pushed_at, r.described, r.topics_n, r.homepage, r.tool, r.signal, r.sieve,
  );
}

/**
 * One sounding. Returns how many searches it made and how many sightings it wrote (new or refreshed).
 * `calls` overrides the per-run budget for a manual run (/__cron?cron=seen&n=30).
 */
export async function soundSea(env: Env, opts: { calls?: number } = {}): Promise<SoundingResult> {
  const out: SoundingResult = { searched: 0, seen: 0 };
  if (!env.GITHUB_CRAWL_TOKEN) return { ...out, note: "no GITHUB_CRAWL_TOKEN" };
  const db = env.DB;
  const t = now();
  const day = new Date(t * 1000).toISOString().slice(0, 10);
  if (trawlAtSea(await getState(db, "trawl:lock"), t)) return { ...out, note: "the trawl is at sea; the sounding waits for the next tick" };
  const cap = seenCap(env);
  const spentToday = Number(await getState(db, `seen:calls:${day}`)) || 0;
  if (spentToday >= cap) return { ...out, note: `today's search calls are spent (${spentToday} of ${cap}, SEEN_PER_DAY)` };
  const budget = Math.min(Math.max(1, Math.floor(opts.calls ?? SEEN_CALLS)), cap - spentToday);
  if (!(await claimLock(db, "seen:lock", SEEN_LOCK_TTL))) return { ...out, note: "another sounding is out" };
  try {
    await setState(db, "seen:last_run", String(t));
    const gh = new GitHub(env.GITHUB_CRAWL_TOKEN);
    const [deny, toolRows] = await Promise.all([loadDenyRows(db), loadToolRows(db)]);
    const reg: Registry = registry(allTools(toolRows));
    const queries = seenQueryList(toolRows);
    const bare = trawlQueryList(toolRows);
    const nq = queries.length;
    // Static searches are keyed by index, registry searches by their text, exactly as the trawl keys its own.
    const key = (kind: "fresh" | "win" | "yield", qi: number) => (qi < TRAWL_QUERIES.length ? `seen:${kind}:${qi}` : `seen:${kind}:q:${bare[qi]}`);
    const since = t - PUSHED_WITHIN_DAYS * 86400;
    const start = Number((await getState(db, "seen:cursor")) ?? 0) % nq;
    let calls = 0;

    const work: number[] = [];
    for (let k = 0; k < nq && work.length < SEEN_QUERIES_PER_RUN; k++) {
      const qi = (start + k) % nq;
      if (worthWorking(await getState(db, key("yield", qi)), t)) work.push(qi);
    }

    for (const qi of work) {
      if (calls >= budget || gh.throttled()) break;
      const q = queries[qi];
      const fresh = Number(await getState(db, key("fresh", qi))) || 0;
      let win = parseWindow(await getState(db, key("win", qi)));
      let matched = -1;

      /** One call, one page, every item written. Null when GitHub did not answer, so no state moves. */
      const readPage = async (query: string, page: number): Promise<{ total: number; read: number } | null> => {
        const r = await gh.searchRepos(query, page, PER_PAGE);
        calls++;
        out.searched++;
        if (r.status !== 200 || !r.data) { await setState(db, "seen:last_error", `${r.status}`); return null; }
        const items = r.data.items ?? [];
        const total = r.data.total_count ?? 0;
        matched = Math.max(matched, total);
        const rows = items.map((g) => seenRow(g, { at: t, qi, nq, query: bare[qi], deny, reg }));
        for (let i = 0; i < rows.length; i += 50) await db.batch(rows.slice(i, i + 50).map((r) => upsert(db, r)));
        out.seen += rows.length;
        return { total, read: items.length };
      };

      // The freshness pass: what was pushed since the last look. Only a pass read to its end moves the mark.
      if (fresh > since) {
        let exhausted = false;
        for (let page = 1; page <= FRESH_PAGES && calls < budget && !gh.throttled(); page++) {
          const p = await readPage(freshQuery(q, fresh), page);
          if (!p) break;
          if (p.read < PER_PAGE) { exhausted = true; break; }
        }
        if (exhausted) await setState(db, key("fresh", qi), String(t));
      } else {
        await setState(db, key("fresh", qi), String(t));
      }

      // The deep walk: this search's window, page by page, then the one below it; at the floor, back to the top.
      if (!win) win = openWindow(t, WINDOW_SPAN, since);
      for (let pages = 0; win && pages < PAGES_PER_QUERY; pages++) {
        if (calls >= budget || gh.throttled()) break;
        const p = await readPage(deepQuery(q, win), win.page);
        if (!p) break;
        if (win.page === 1 && p.total > RESULT_CAP) {
          const narrower = narrowWindow(win);
          if (narrower) { win = narrower; await setState(db, key("win", qi), formatWindow(win)); continue; }
        }
        win = afterPage(win, p.total, p.read, since).next;
        await setState(db, key("win", qi), win ? formatWindow(win) : "");
      }

      if (matched >= 0) await setState(db, key("yield", qi), `${matched}|${t}`);
    }

    await setState(db, "seen:cursor", String(start + work.length));
    if (calls) await bumpState(db, `seen:calls:${day}`, calls);
    if (gh.throttled()) out.note = "github search rate limit; the rest waits for the next tick";
    else if (calls >= budget) out.note = `search budget spent (${budget} calls)`;
    return out;
  } finally {
    await releaseLock(db, "seen:lock").catch(() => {});
  }
}
