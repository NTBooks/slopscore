// Truffle trawling expedition: how repos nobody submitted get into the trough.
//
// Three ways in, one lane out. Hand-vetted picks (an admin, or the admin's agent reading READMEs) go to
// POST /mod/trawl/import and wait in trawl_backlog. The hourly cron (trawlDaily, via `7 * * * *`) releases a
// few of those first, then autoTrawl fills the rest of the slice from GitHub repository search: hard rules, the
// owner's own past-tense claim in the README, then a judge on OpenRouter (src/lib/judge.ts) that says what the
// repo actually is. A run that came back thin asks for a chase a few minutes later through trawl:run_at, which
// is also how a trawl is asked for by hand. Everything landed goes into a lane of its own: trawled finds are
// scanned on our OpenRouter bill (src/jobs/scan.ts), never taking a free slot or a Workers AI neuron from a
// repo that came to us, and a trawled repo that turns out to have the file moves to the free line
// (src/jobs/sweep.ts). The day's total is TRAWL_PER_DAY, the judge's is JUDGE_PER_DAY, and everything stops
// for good once TRAWL_STOP_AT opted-in repos are listed. The keyword trawl() at the bottom is the manual,
// judge-less original (/__cron?cron=trawl&n=20), kept for a mod who wants a quick net of hard-rule picks.
import { GitHub, type GhRepo } from "../lib/github";
import type { Env } from "../env";
import { loadDenyRows } from "../lib/denylist";
import { pickCandidates, trawlQueries, trawlQueriesUnwindowed, cheapReject, curatedCheck, curatedPick, cleanReason, claimSnippet, autoReason, QUERIES_PER_RUN, MIN_STARS, MAX_STARS, PUSHED_WITHIN_DAYS, type Pick } from "../lib/virtual";
import { judgeCandidate } from "../lib/judge";
import { markDirty } from "../lib/cache";
import { now } from "../lib/time";
import { bump, bumpState, claimLock, getState, releaseLock, setState } from "./stats";

const PER_PAGE = 50;
const MAX_PAGES = 3; // repository search allows 30 calls a minute; 6 queries x 3 pages stays under it
/** Deep-walk pages per search per run, on top of the freshness pass. */
export const PAGES_PER_QUERY = 4;
/** Search calls one run may spend. Repository search allows 30 a minute and a run is the best part of a minute. */
export const SEARCH_CALLS = 26;
/** Judge calls one run may spend, as a multiple of what it is allowed to keep. The budget caps repos kept, not
 *  repos read, and the judge is the one step that costs money. A run that spends this says so in its note. */
export const JUDGE_PER_KEPT = 3;
export const MIN_JUDGE_CALLS = 10;
/** Judge calls per UTC day across every run, unless JUDGE_PER_DAY says otherwise. The per-run floor above
 *  bounds a run; this bounds the day, which is the number the bill is written in. */
export const JUDGE_PER_DAY = 250;
export function judgeCap(env: { JUDGE_PER_DAY?: string }): number {
  const n = Math.floor(Number(env.JUDGE_PER_DAY));
  return Number.isFinite(n) && n >= 0 ? n : JUDGE_PER_DAY;
}
/** Repos the hourly trawl may land in one go. Small on purpose: the front page should gain a few an hour,
 *  not a day's worth at once and nothing after. The day's total is still TRAWL_PER_DAY. */
export const HOURLY_TRAWL = 3;
/** How long one trawl holds the sea. Two at once (the hourly run and a chase landing in the same minute)
 *  used to judge the same candidates twice and lose one side of every counter. */
export const TRAWL_LOCK_TTL = 10 * 60;
/** How long a search that matched nothing is left alone before being tried again. Eight of the eighteen match
 *  nothing at all today, and a rotation that gives them equal time spends most of a run on empty water — but a
 *  topic can catch on, so none of them is written off for ever. */
export const EMPTY_RETRY = 12 * 3600;

/** A search's remembered yield: how many it matched, and when we last looked. */
export function parseYield(raw: string | null): { total: number; at: number } | null {
  const [t, a] = String(raw ?? "").split("|");
  const total = Number(t), at = Number(a);
  return Number.isFinite(total) && Number.isFinite(at) ? { total, at } : null;
}

/** Whether tonight's rotation should bother with a search. Anything that matched something is worked; anything
 *  that matched nothing is left alone until EMPTY_RETRY has passed, then probed again at the cost of one call. */
export function worthWorking(raw: string | null, at: number): boolean {
  const y = parseYield(raw);
  return !y || y.total > 0 || at - y.at >= EMPTY_RETRY;
}

/**
 * The deep walk: one search, worked through fixed windows of push date, every page of each.
 *
 * GitHub's repository search sorts by stars, forks, help-wanted issues or last update -- never by push
 * date -- so a walk that keyed its cursor on the oldest pushed_at it had read was leaking: a repo on an
 * unread page with a newer push than that cursor fell above the next window and was never asked for
 * again until the walk wrapped. A window is read to its end before the next one opens, so the sort order
 * inside it stops mattering. Its size adapts: GitHub hands back at most RESULT_CAP results per search, so
 * a window holding more than that is halved from the top until it fits, and a window that came back
 * sparse lets the next one be twice as wide.
 *
 * The state is one row per search, `trawl:win:<qi>` = "start|end|page|span", written after every page,
 * so a run killed mid-walk resumes on the page it was reading. The freshness pass in front of the walk
 * asks `pushed:>=fresh` for what arrived since the last look, and `fresh` only moves once that pass has
 * been read to its end, so a busy hour is re-read rather than skipped.
 */
export interface Window { start: number; end: number; page: number; span: number }

/** The first window's width, and the bounds the width adapts within. */
export const WINDOW_SPAN = 7 * 86400;
export const WINDOW_MIN = 6 * 3600;
export const WINDOW_MAX = 30 * 86400;
/** Results GitHub will hand back for one search, however many it matched. */
export const RESULT_CAP = 1000;
/** A window matching fewer than this is thin water: the next one opens twice as wide. */
export const SPARSE = 250;
/** Pages the freshness pass may read in one run. */
export const FRESH_PAGES = 2;

export function parseWindow(raw: string | null): Window | null {
  const [s, e, p, sp] = String(raw ?? "").split("|").map(Number);
  if (![s, e, p, sp].every(Number.isFinite) || s <= 0 || e <= s || p < 1 || sp <= 0) return null;
  return { start: s, end: e, page: Math.floor(p), span: sp };
}

export const formatWindow = (w: Window): string => `${w.start}|${w.end}|${w.page}|${w.span}`;

/** The window ending at `end`, `span` wide, never reaching below the floor. Null when `end` is already at it. */
export function openWindow(end: number, span: number, since: number): Window | null {
  if (end <= since) return null;
  const width = Math.min(Math.max(span, WINDOW_MIN), WINDOW_MAX);
  return { start: Math.max(since, end - width), end, page: 1, span: width };
}

/** Halve the window from the top when it holds more than GitHub will hand back. Null once it is as narrow
 *  as it goes: read the RESULT_CAP that can be read and move on, which is the best anyone can do. */
export function narrowWindow(w: Window): Window | null {
  if (w.span <= WINDOW_MIN) return null;
  const span = Math.max(WINDOW_MIN, Math.floor(w.span / 2));
  return { start: Math.max(w.start, w.end - span), end: w.end, page: 1, span };
}

/**
 * The state after one page of a window has been read. `total` is GitHub's total_count for the window,
 * `read` the items on this page. When the window is finished the next one opens directly below it, wider
 * if this one was sparse; at the floor it is null, and the next run opens again from the top.
 */
export function afterPage(w: Window, total: number, read: number, since: number): { next: Window | null; finished: boolean } {
  const readable = Math.min(Math.max(0, total), RESULT_CAP);
  const finished = read < PER_PAGE || w.page * PER_PAGE >= readable;
  if (!finished) return { next: { ...w, page: w.page + 1 }, finished: false };
  const span = total < SPARSE ? Math.min(w.span * 2, WINDOW_MAX) : w.span;
  return { next: openWindow(w.start, span, since), finished: true };
}

export const deepQuery = (q: string, w: Window): string => `${q} pushed:${isoStamp(w.start)}..${isoStamp(w.end)}`;
export const freshQuery = (q: string, fresh: number): string => `${q} pushed:>=${isoStamp(fresh)}`;

/** GitHub's search accepts a full timestamp, which is what keeps two windows from overlapping by a whole day. */
export function isoStamp(t: number): string {
  return new Date(Math.max(0, Math.floor(t)) * 1000).toISOString().replace(/\.\d+Z$/, "Z");
}

export interface TrawlResult { picked: number; searched: number; skipped: number; repos: string[]; note?: string }

/** `verdict` is only present for auto-trawled picks: a hand-picked or backlog repo never went past a model. */
function insertPick(db: D1Database, p: Pick, verdict?: { code: string | null; domain: string | null }): D1PreparedStatement {
  const g = p.repo;
  return db.prepare(
    `INSERT OR IGNORE INTO repos (id, full_name, owner, name, owner_id, owner_type, title, tagline, stars, forks, language, license, is_fork, status, queue_reason, source, virtual_md, virtual_reason, judge_code, judge_domain)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,'discovered','awaiting-scan','trawl',?,?,?,?)`,
  ).bind(g.id, g.full_name, g.owner.login, g.name, g.owner.id, g.owner.type, g.name, g.description, g.stargazers_count, g.forks_count, g.language, g.license?.spdx_id ?? null, p.virtualMd, p.reason, verdict?.code ?? null, verdict?.domain ?? null);
}

/** Hand-pick one repo straight into the scan queue (admin: /__cron?cron=trawl&repo=owner/name&reason=...). The hard rules apply; keyword signals don't. */
export async function trawlOne(env: Env, fullName: string, reason?: string): Promise<TrawlResult> {
  const out: TrawlResult = { picked: 0, searched: 0, skipped: 0, repos: [] };
  const [o, n] = fullName.trim().split("/");
  if (!o || !n) return { ...out, note: "use repo=owner/name" };
  const r = await new GitHub(env.GITHUB_CRAWL_TOKEN).repo(o, n);
  if (r.status !== 200 || !r.data) return { ...out, note: `GitHub returned ${r.status}` };
  const g = r.data;
  const seen = await env.DB.prepare("SELECT (SELECT count(*) FROM repos WHERE lower(full_name) = lower(?)) + (SELECT count(*) FROM trawl_skipped WHERE full_name = lower(?)) AS n").bind(g.full_name, g.full_name).first<{ n: number }>();
  const why = curatedCheck(g, { known: new Set(seen?.n ? [g.full_name.toLowerCase()] : []), deny: await loadDenyRows(env.DB) });
  if (why) return { ...out, skipped: 1, note: `not picked: ${why}` };
  await insertPick(env.DB, curatedPick(g, cleanReason(reason) ?? "hand-picked by a moderator", now())).run();
  await bump(env.DB, "found", 1);
  await markDirty(env.DB);
  return { ...out, picked: 1, repos: [g.full_name] };
}

export interface CuratedInput { repo: string; reason: string }
const NAME_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9._-]{1,100}$/;

/** Add hand-vetted picks to the backlog. Bad names, bad reasons and repos already known (listed, removed, skipped, or waiting) are reported, never inserted. */
export async function addToBacklog(env: Env, picks: CuratedInput[], by: string): Promise<{ added: string[]; duplicate: string[]; invalid: { repo: string; why: string }[] }> {
  const out = { added: [] as string[], duplicate: [] as string[], invalid: [] as { repo: string; why: string }[] };
  const seen = new Set<string>();
  const valid: { name: string; reason: string }[] = [];
  for (const p of picks.slice(0, 500)) {
    const name = String(p?.repo ?? "").trim().replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "").replace(/\/$/, "");
    const reason = cleanReason(p?.reason);
    if (!NAME_RE.test(name)) { out.invalid.push({ repo: name, why: "not owner/name" }); continue; }
    if (!reason) { out.invalid.push({ repo: name, why: "reason must be 10 to 280 characters of plain text" }); continue; }
    if (seen.has(name.toLowerCase())) { out.duplicate.push(name); continue; }
    seen.add(name.toLowerCase());
    valid.push({ name, reason });
  }
  const db = env.DB;
  for (let i = 0; i < valid.length; i += 30) {
    const chunk = valid.slice(i, i + 30);
    const lower = chunk.map((v) => v.name.toLowerCase());
    const ph = lower.map(() => "?").join(",");
    const known = await db.prepare(
      `SELECT lower(full_name) AS n FROM repos WHERE lower(full_name) IN (${ph}) UNION SELECT full_name FROM trawl_skipped WHERE full_name IN (${ph}) UNION SELECT full_name FROM trawl_backlog WHERE full_name IN (${ph})`,
    ).bind(...lower, ...lower, ...lower).all<{ n: string }>();
    const knownSet = new Set((known.results ?? []).map((k) => k.n));
    const fresh = chunk.filter((v) => !knownSet.has(v.name.toLowerCase()));
    out.duplicate.push(...chunk.filter((v) => knownSet.has(v.name.toLowerCase())).map((v) => v.name));
    if (fresh.length) await db.batch(fresh.map((v) => db.prepare("INSERT OR IGNORE INTO trawl_backlog (full_name, display_name, reason, added_by) VALUES (?,?,?,?)").bind(v.name.toLowerCase(), v.name, v.reason, by)));
    out.added.push(...fresh.map((v) => v.name));
  }
  return out;
}

/** Move up to n backlog picks (max 50 per call) into the scan queue. One GitHub call each, then the hard rules. */
export async function releaseBacklog(env: Env, n: number): Promise<{ queued: string[]; skipped: { repo: string; why: string }[]; left: number; note?: string }> {
  const db = env.DB;
  const gh = new GitHub(env.GITHUB_CRAWL_TOKEN);
  const t = now();
  const take = Math.min(Math.max(0, Math.floor(Number(n) || 0)), 50);
  const rows = take ? ((await db.prepare("SELECT full_name, display_name, reason FROM trawl_backlog WHERE released_at IS NULL ORDER BY added_at, rowid LIMIT ?").bind(take).all<{ full_name: string; display_name: string; reason: string }>()).results ?? []) : [];
  const deny = rows.length ? await loadDenyRows(db) : [];
  const queued: string[] = [];
  const skipped: { repo: string; why: string }[] = [];
  let note: string | undefined;
  for (const b of rows) {
    if (gh.throttled()) { note = "github rate limit; the rest stays in the backlog"; break; }
    const [o, nm] = b.display_name.split("/");
    const r = await gh.repo(o, nm);
    let why: string | null;
    if (r.status !== 200 || !r.data) why = `GitHub returned ${r.status}`;
    else {
      const g = r.data;
      const s = await db.prepare("SELECT (SELECT count(*) FROM repos WHERE lower(full_name) = lower(?)) + (SELECT count(*) FROM trawl_skipped WHERE full_name = lower(?)) AS n").bind(g.full_name, g.full_name).first<{ n: number }>();
      why = curatedCheck(g, { known: new Set(s?.n ? [g.full_name.toLowerCase()] : []), deny });
      if (!why) { await insertPick(db, curatedPick(g, b.reason, t)).run(); queued.push(g.full_name); }
    }
    if (why) skipped.push({ repo: b.display_name, why });
    await db.prepare("UPDATE trawl_backlog SET released_at = ?, outcome = ? WHERE full_name = ?").bind(t, why ? `skipped: ${why}` : "queued", b.full_name).run();
  }
  const left = (await db.prepare("SELECT count(*) AS n FROM trawl_backlog WHERE released_at IS NULL").first<{ n: number }>())?.n ?? 0;
  if (queued.length) { await bump(db, "found", queued.length); await markDirty(db); }
  return { queued, skipped, left, note };
}

/**
 * The nightly auto-trawl: search, hard rules, the owner's own past-tense claim in the README, then a judge on OpenRouter
 * that says what the repo actually is (src/lib/judge.ts). Fails closed, so no key or a bad answer lists nothing.
 * The published reason quotes the owner, never the model.
 */
export async function autoTrawl(env: Env, n: number): Promise<{ queued: string[]; skipped: number; judged: number; searched: number; note?: string }> {
  const out = { queued: [] as string[], skipped: 0, judged: 0, searched: 0, note: undefined as string | undefined };
  if (!env.GITHUB_CRAWL_TOKEN) return { ...out, note: "no GITHUB_CRAWL_TOKEN" };
  if (!env.OPENROUTER_API_KEY) return { ...out, note: "no OPENROUTER_API_KEY: the auto-trawl needs its judge" };
  const db = env.DB;
  const t = now();
  const day = new Date(t * 1000).toISOString().slice(0, 10);
  const since = t - PUSHED_WITHIN_DAYS * 86400;
  const budget = Math.min(Math.max(0, Math.floor(n)), 50);
  if (!budget) return out;
  const gh = new GitHub(env.GITHUB_CRAWL_TOKEN);
  const deny = await loadDenyRows(db);
  const queries = trawlQueriesUnwindowed();
  const start = Number((await getState(db, "trawl:cursor")) ?? 0) % queries.length;
  const maxJudged = Math.max(MIN_JUDGE_CALLS, budget * JUDGE_PER_KEPT);
  const skips: { full_name: string; why: string; code?: string | null; domain?: string | null }[] = [];
  let calls = 0;

  // Which searches are worth the run. The rotation used to give a search matching 2,340 repos and one matching
  // none the same turn, so a run could spend every call it had on empty water and land nothing — which is
  // exactly what happened on the night this was written. Empty ones are skipped until EMPTY_RETRY has passed.
  const work: number[] = [];
  for (let k = 0; k < queries.length && work.length < QUERIES_PER_RUN; k++) {
    const qi = (start + k) % queries.length;
    if (worthWorking(await getState(db, `trawl:yield:${qi}`), t)) work.push(qi);
  }

  // The judge's daily ceiling, across every run of the day. Per-run floors bound one run and nothing
  // else: a day where every candidate is thrown back spends every run's allowance. This is the one
  // number that bounds the trawl's model spend, and it is read here and counted as it is spent.
  const judgeMax = judgeCap(env);
  let judgedToday = Number(await getState(db, `judge:${day}`)) || 0;

  /** Everything that ends a search early, in one place. Sets the note the run reports. */
  const spent = (): boolean => {
    if (out.queued.length >= budget) return true;
    if (out.judged >= maxJudged) { out.note = `judge budget spent (${maxJudged}); the rest waits for the next run`; return true; }
    if (judgedToday >= judgeMax) { out.note = `judge's daily cap reached (${judgeMax}, JUDGE_PER_DAY); the rest waits for tomorrow`; return true; }
    if (gh.throttled()) { out.note = "github rate limit"; return true; }
    return false;
  };

  /**
   * Work one page of results: the cheap sieves, then a README, then the judge. Broad to fine, cheapest
   * first -- the hard rules and the description sieve cost nothing, a README is a GitHub call, and the
   * judge is money. Returns false when it had to stop before the last item, so the caller re-reads the
   * page next run rather than counting it done; what was seen is known by then and costs one query.
   */
  const workItems = async (items: GhRepo[]): Promise<boolean> => {
    if (!items.length) return true;
    const names = items.map((i) => i.full_name.toLowerCase());
    const ph = names.map(() => "?").join(",");
    const [known, before] = await Promise.all([
      db.prepare(`SELECT lower(full_name) AS n FROM repos WHERE lower(full_name) IN (${ph})`).bind(...names).all<{ n: string }>(),
      db.prepare(`SELECT full_name AS n FROM trawl_skipped WHERE full_name IN (${ph})`).bind(...names).all<{ n: string }>(),
    ]);
    const knownSet = new Set([...(known.results ?? []), ...(before.results ?? [])].map((k) => k.n));
    for (const g of items) {
      if (spent()) return false;
      if (knownSet.has(g.full_name.toLowerCase())) continue;
      if (g.stargazers_count < MIN_STARS || g.stargazers_count > MAX_STARS) continue;
      const pushed = Math.floor(Date.parse(g.pushed_at) / 1000) || 0;
      if (pushed < since) continue;
      const hard = curatedCheck(g, { known: new Set(), deny }) ?? cheapReject(g);
      if (hard) { skips.push({ full_name: g.full_name.toLowerCase(), why: hard }); continue; }
      const readme = await gh.readmeText(g.owner.login, g.name);
      const claim = claimSnippet(`${g.description ?? ""}. ${readme}`);
      if (!claim) { skips.push({ full_name: g.full_name.toLowerCase(), why: "no past-tense claim that an AI tool wrote it" }); continue; }
      const reason = autoReason(g, claim);
      if (!reason) { skips.push({ full_name: g.full_name.toLowerCase(), why: "could not build a reason" }); continue; }
      const verdict = await judgeCandidate(env, { full_name: g.full_name, description: g.description ?? "", topics: g.topics ?? [], language: g.language, stars: g.stargazers_count, claim, readme });
      out.judged++;
      judgedToday++;
      await bumpState(db, `judge:${day}`, 1);
      // The verdict is kept either way: what the trawl threw back is the larger, more interesting half of the
      // sample, and /trends counts both. Only `code` decides anything; `domain` is recorded and nothing else.
      if (!verdict.keep) { skips.push({ full_name: g.full_name.toLowerCase(), why: `judge: ${verdict.code ?? verdict.error ?? "no"}`, code: verdict.code, domain: verdict.domain }); continue; }
      await insertPick(db, curatedPick(g, reason, t), verdict).run();
      out.queued.push(g.full_name);
    }
    return true;
  };

  for (const qi of work) {
    if (spent() || calls >= SEARCH_CALLS) break;
    const q = queries[qi];
    const fresh = Number(await getState(db, `trawl:fresh:${qi}`)) || 0;
    let win = parseWindow(await getState(db, `trawl:win:${qi}`));
    let matched = -1;   // the largest total_count any pass reported; -1 until a search has answered

    /** One call, one page, worked. Null when GitHub did not answer, so no state moves on its account. */
    const readPage = async (query: string, page: number): Promise<{ total: number; read: number; complete: boolean } | null> => {
      const r = await gh.searchRepos(query, page, PER_PAGE);
      calls++;
      out.searched++;
      if (r.status !== 200 || !r.data) { await setState(db, "trawl:last_error", `${r.status}`); return null; }
      const items = r.data.items ?? [];
      const total = r.data.total_count ?? 0;
      matched = Math.max(matched, total);
      return { total, read: items.length, complete: await workItems(items) };
    };

    // The freshness pass: repos pushed since the last look, usually one call returning nothing.
    if (fresh > since) {
      let exhausted = false;
      for (let page = 1; page <= FRESH_PAGES && !spent() && calls < SEARCH_CALLS; page++) {
        const p = await readPage(freshQuery(q, fresh), page);
        if (!p || !p.complete) break;
        if (p.read < PER_PAGE) { exhausted = true; break; }
      }
      // Only a pass read to its end moves the mark. A busy hour, a failed call or a spent budget leaves it
      // where it was, and the same water is asked for again next time.
      if (exhausted) await setState(db, `trawl:fresh:${qi}`, String(t));
    } else {
      // Nothing to look back over yet: freshness starts now, and the deep walk below opens at the top.
      await setState(db, `trawl:fresh:${qi}`, String(t));
    }

    // The deep walk: the window this search is in, page by page, then the one below it.
    if (!win) win = openWindow(t, WINDOW_SPAN, since);
    for (let pages = 0; win && pages < PAGES_PER_QUERY; pages++) {
      if (spent()) break;
      if (calls >= SEARCH_CALLS) { out.note = `search budget spent (${SEARCH_CALLS} calls)`; break; }
      const p = await readPage(deepQuery(q, win), win.page);
      if (!p) break;   // GitHub did not answer: the window stays exactly where it was
      if (win.page === 1 && p.total > RESULT_CAP) {
        // More in this window than will ever be handed back: halve it and ask again. At the narrowest,
        // read the thousand that can be read and move on.
        const narrower = narrowWindow(win);
        if (narrower) { win = narrower; await setState(db, `trawl:win:${qi}`, formatWindow(win)); continue; }
      }
      if (!p.complete) break;   // stopped mid-page on budget: this page is re-read next run
      win = afterPage(win, p.total, p.read, since).next;
      await setState(db, `trawl:win:${qi}`, win ? formatWindow(win) : "");
    }

    // What this search is worth, so the rotation can stop giving empty water equal time.
    if (matched >= 0) await setState(db, `trawl:yield:${qi}`, `${matched}|${t}`);
  }

  out.skipped = skips.length;
  // All of them, a hundred a batch. Slicing to the first hundred forgot exactly the ones that cost a README
  // or a judge call, since the free hard-rule skips come first.
  for (let i = 0; i < skips.length; i += 100) {
    await db.batch(skips.slice(i, i + 100).map((s) => db.prepare("INSERT OR IGNORE INTO trawl_skipped (full_name, reason, judge_code, judge_domain) VALUES (?, ?, ?, ?)").bind(s.full_name, s.why.slice(0, 300), s.code ?? null, s.domain ?? null)));
  }
  await setState(db, "trawl:cursor", String(start + 1));
  if (out.queued.length) { await bump(db, "found", out.queued.length); await markDirty(db); }
  return out;
}

/** How long after its due time a standing request is still honoured. A request is somebody saying "go now";
 *  one that missed its slot because the worker was down for a few minutes should still sail, but one set days
 *  ago and forgotten must never fire out of nowhere. */
export const REQUEST_WINDOW = 6 * 3600;

/** A run that comes back under its budget goes out again after this, rather than waiting for the next hour.
 *  Long enough that two ticks do not overlap, short enough that a bad patch of water costs minutes not a day. */
export const CHASE_DELAY = 8 * 60;
/** Chases one day may spend. The daily budget already stops the good case; this stops the bad one, where every
 *  search is empty and the trawl would otherwise ask again every eight minutes until midnight. */
export const CHASE_MAX = 8;

/**
 * A trawl asked for out of band, rather than by the clock.
 *
 * The alternative was an endpoint, and an endpoint is a door: it needs a guard, the guard needs a secret, and
 * the secret ends up in somebody's shell history. This is a row in crawl_state instead — writing it already
 * takes the Cloudflare token, so the permission that matters is the one that was always there.
 *
 * `trawl:run_at` is a unix time, optionally `<when>|<how many>`. The claim clears the row *before* the work
 * starts, so two overlapping ticks cannot both sail on one request, and a run that dies partway does not leave
 * a request that fires again for ever.
 *
 * Returns how many repos the run may land, or null when nothing was asked for. The decision is pure and the
 * window is exported so it can be tested without a database.
 */
export function readTrawlRequest(raw: string | null, at: number, fallback: number): { clear: boolean; budget: number | null } {
  const text = (raw ?? "").trim();
  if (!text) return { clear: false, budget: null };
  const [whenRaw, nRaw] = text.split("|");
  const when = Number(whenRaw);
  if (!Number.isFinite(when) || when <= 0) return { clear: true, budget: null };  // junk: bin it
  if (at < when) return { clear: false, budget: null };                           // asked for, but not yet
  if (at > when + REQUEST_WINDOW) return { clear: true, budget: null };           // too stale to be what anyone meant
  const n = Number(nRaw);
  return { clear: true, budget: Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 50) : fallback };
}

/** The IO half: read the row, clear it before a single repo is fetched, and hand back what the run may land. */
export async function claimTrawlRequest(env: Env, fallback: number): Promise<number | null> {
  const d = readTrawlRequest(await getState(env.DB, "trawl:run_at"), now(), fallback);
  if (d.clear) await setState(env.DB, "trawl:run_at", "");
  return d.budget;
}

/** The hourly drip: hand-vetted backlog first, then the auto-trawl fills what is left of the slice.
 *  Stops once TRAWL_STOP_AT opted-in repos are listed. Shares the trawl:YYYY-MM-DD counter, so setting it high in
 *  crawl_state pauses a day without a deploy.
 *
 *  `cap` is how much of the day's remaining budget this run may spend: the hourly cron passes HOURLY_TRAWL, a
 *  chase or a standing request passes what it was asked for, and nothing passes "the lot" any more -- a run
 *  that landed the whole day at once left the next twenty-three slices with nothing to do. Every caller goes
 *  through the same gates and the same counter, so the day's total is what TRAWL_PER_DAY always said it was.
 *
 *  One at a time. The lease below is what keeps the hourly run and a chase that lands in the same minute from
 *  judging the same candidates twice; the counters are atomic bumps for the same reason. */
export async function trawlDaily(env: Env, cap?: number): Promise<{ queued: string[]; skipped: { repo: string; why: string }[]; left: number; note?: string; auto?: unknown; chase?: string }> {
  const db = env.DB;
  const stopAt = Number(env.TRAWL_STOP_AT || 300);
  const opted = await db.prepare("SELECT count(*) AS n FROM repos WHERE status = 'listed' AND source = 'marker'").first<{ n: number }>();
  if ((opted?.n ?? 0) >= stopAt) return { queued: [], skipped: [], left: 0, note: `expedition over: ${opted?.n} opted-in listings (TRAWL_STOP_AT ${stopAt})` };
  const day = new Date(now() * 1000).toISOString().slice(0, 10);
  const done = Number((await getState(db, `trawl:${day}`)) ?? 0);
  const perDay = Number(env.TRAWL_PER_DAY || 50);
  const remaining = perDay - done;
  const budget = cap != null ? Math.min(remaining, Math.max(0, Math.floor(cap))) : remaining;
  if (budget <= 0) {
    // The rail's chart reads this: tied up because the day is landed is a different caption from tied up
    // because something is wrong.
    if (remaining <= 0) await setState(db, "trawl:done_day", day);
    return { queued: [], skipped: [], left: 0, note: `today's releases are done (or paused): trawl:${day} = ${done}` };
  }
  if (!(await claimLock(db, "trawl:lock", TRAWL_LOCK_TTL))) return { queued: [], skipped: [], left: 0, note: "another trawl is at sea; this one stays in" };
  try {
    // She has put to sea. Recorded before the work, not after, so a rate limit halfway through still says
    // she sailed — and recorded only past the returns above, which are the hours she did not. This is the
    // one timestamp the rail's chart steers by.
    await setState(db, "trawl:last_run", String(now()));
    const res = await releaseBacklog(env, budget);
    const left = budget - res.queued.length;
    const auto = left > 0 ? await autoTrawl(env, left) : undefined;
    const counted = res.queued.length + res.skipped.length + (auto?.queued.length ?? 0);
    await bumpState(db, `trawl:${day}`, counted);
    if (done + counted >= perDay) await setState(db, "trawl:done_day", day);
    // Unconditional: a run that caught nothing still moved the chart, and releaseBacklog/autoTrawl only
    // mark dirty when they queued something.
    await markDirty(db);

    // A thin catch is a reason to shoot the net again, not to wait an hour. The site should gain a healthy
    // number a day, and whether the water was good is only knowable after looking — so a run that came back
    // under its budget asks for another, through the same standing-request row anyone else would use. The
    // day's budget stops this in the good case; CHASE_MAX stops it when every search is empty. A request
    // already standing is left alone: somebody else has asked, and one net at a time is the whole point.
    const landed = res.queued.length + (auto?.queued.length ?? 0);
    const chases = Number((await getState(db, `trawl:chase:${day}`)) ?? 0);
    const chase = landed < budget && chases < CHASE_MAX && !(await getState(db, "trawl:run_at"))?.trim();
    if (chase) {
      await bumpState(db, `trawl:chase:${day}`, 1);
      await setState(db, "trawl:run_at", `${now() + CHASE_DELAY}|${budget - landed}`);
    }
    return { ...res, auto, chase: chase ? `landed ${landed} of ${budget}; going out again in ${CHASE_DELAY / 60} min for the other ${budget - landed} (chase ${chases + 1}/${CHASE_MAX})` : undefined };
  } finally {
    await releaseLock(db, "trawl:lock").catch(() => {});
  }
}

export async function trawl(env: Env, n?: number): Promise<TrawlResult> {
  const out: TrawlResult = { picked: 0, searched: 0, skipped: 0, repos: [] };
  if (!env.GITHUB_CRAWL_TOKEN) return { ...out, note: "no GITHUB_CRAWL_TOKEN; repository search needs auth" };
  const db = env.DB;
  const t = now();
  const day = new Date(t * 1000).toISOString().slice(0, 10);
  const manual = n != null && Number.isFinite(n);
  if (!manual) {
    const stopAt = Number(env.TRAWL_STOP_AT || 300);
    const opted = await db.prepare("SELECT count(*) AS n FROM repos WHERE status = 'listed' AND source = 'marker'").first<{ n: number }>();
    if ((opted?.n ?? 0) >= stopAt) return { ...out, note: `expedition over: ${opted?.n} opted-in listings (TRAWL_STOP_AT ${stopAt})` };
  }
  const doneToday = Number((await getState(db, `trawl:${day}`)) ?? 0);
  const perDay = Number(env.TRAWL_PER_DAY || 50);
  const budget = manual ? Math.min(Math.max(1, Math.floor(n!)), 200) : perDay - doneToday;
  if (budget <= 0) return { ...out, note: `today's ${perDay} already trawled` };

  const gh = new GitHub(env.GITHUB_CRAWL_TOKEN);
  const deny = await loadDenyRows(db);
  const queries = trawlQueries(t);
  const start = Number((await getState(db, "trawl:cursor")) ?? 0) % queries.length;
  for (let qi = 0; qi < queries.length && out.picked < budget; qi++) {
    const q = queries[(start + qi) % queries.length];
    for (let page = 1; page <= MAX_PAGES && out.picked < budget; page++) {
      if (gh.throttled()) { out.note = "github search rate limit; the rest waits for tomorrow"; break; }
      const r = await gh.searchRepos(q, page, PER_PAGE);
      out.searched++;
      if (r.status !== 200 || !r.data) { await setState(db, "trawl:last_error", `${r.status} ${"error" in r ? r.error : ""}`); break; }
      const items = r.data.items ?? [];
      if (!items.length) break;
      const names = items.map((i) => i.full_name.toLowerCase());
      const ph = names.map(() => "?").join(",");
      const [known, skippedBefore] = await Promise.all([
        db.prepare(`SELECT lower(full_name) AS n FROM repos WHERE lower(full_name) IN (${ph})`).bind(...names).all<{ n: string }>(),
        db.prepare(`SELECT full_name AS n FROM trawl_skipped WHERE full_name IN (${ph})`).bind(...names).all<{ n: string }>(),
      ]);
      const knownSet = new Set([...(known.results ?? []), ...(skippedBefore.results ?? [])].map((k) => k.n));
      const res = pickCandidates(items, { known: knownSet, deny, at: t });
      out.skipped += res.skipped.length;
      const take = res.picks.slice(0, budget - out.picked);
      const stmts = [
        ...take.map((p) => insertPick(db, p)),
        ...res.skipped.filter((s) => s.record).map((s) => db.prepare("INSERT OR IGNORE INTO trawl_skipped (full_name, reason) VALUES (?, ?)").bind(s.full_name, s.why.slice(0, 300))),
      ];
      if (stmts.length) await db.batch(stmts);
      out.picked += take.length;
      out.repos.push(...take.map((p) => p.repo.full_name));
      if (items.length < PER_PAGE) break;
    }
  }
  await setState(db, "trawl:cursor", String(start + 1)); // tomorrow starts on the next query
  await bumpState(db, `trawl:${day}`, out.picked);
  await setState(db, "trawl:last_run", String(t));
  if (out.picked) { await bump(db, "found", out.picked); await markDirty(db); }
  return out;
}
