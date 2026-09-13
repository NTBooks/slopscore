// Truffle trawling expedition. Picks are vetted by hand (an admin, or the admin's agent reading READMEs) and posted to
// POST /mod/trawl/import, which puts them in trawl_backlog. The daily 00:05 UTC tick releases TRAWL_PER_DAY of them into
// a lane of their own: trawled finds are scanned on our OpenRouter bill (src/jobs/scan.ts), never taking a free slot or a
// Workers AI neuron from a repo that came to us, and a trawled repo that turns out to have the file moves to the free
// line (src/jobs/sweep.ts). Releases stop for good once TRAWL_STOP_AT opted-in repos are listed. The keyword search trawl below is manual only (/__cron?cron=trawl&n=20): keywords can't tell a vibe-coded app
// from a tool for vibe coders, so it only trusts past-tense claims.
import { GitHub } from "../lib/github";
import type { Env } from "../env";
import { loadDenyRows } from "../lib/denylist";
import { pickCandidates, trawlQueries, trawlQueriesUnwindowed, cheapReject, curatedCheck, curatedPick, cleanReason, claimSnippet, autoReason, QUERIES_PER_RUN, MIN_STARS, MAX_STARS, PUSHED_WITHIN_DAYS, type Pick } from "../lib/virtual";
import { judgeCandidate } from "../lib/judge";
import { markDirty } from "../lib/cache";
import { now } from "../lib/time";
import { bump, getState, setState } from "./stats";

const PER_PAGE = 50;
const MAX_PAGES = 3; // repository search allows 30 calls a minute; 6 queries x 3 pages stays under it
/** GitHub hands back at most 1,000 results for one search, which at 50 a page is where the water ends.
 *  The date window below is how the trawl gets past that: each run asks for a slice it has never asked for. */
export const MAX_PAGE = 20;
/** Pages per search per run: one for what is new, the rest walking backwards through water never worked. */
export const PAGES_PER_QUERY = 4;
/** Search calls one run may spend. Repository search allows 30 a minute and a run is the best part of a minute. */
export const SEARCH_CALLS = 26;
/** Judge calls one run may spend, as a multiple of what it is allowed to keep. The budget caps repos kept, not
 *  repos read, and the judge is the one step that costs money. A run that spends this says so in its note. */
export const JUDGE_PER_KEPT = 3;
export const MIN_JUDGE_CALLS = 10;
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
 * The two date windows a search is worked through, and why there are two.
 *
 * Results come back newest-pushed first, so the top of a search is where a repo pushed an hour ago appears and
 * the bottom is the oldest thing still inside the 90-day floor. Paging deeper each night reached further down
 * but re-read everything above it every time; asking by date does not. `fresh` asks only for repos pushed since
 * the last look — usually a handful, often none — and `deep` asks only for repos older than anything already
 * walked. Between them they cover the whole search exactly once, and neither ever re-reads the other's water.
 *
 * `before` of 0 means the deep walk has not started (or has finished and wrapped), so it begins at the newest.
 */
export function searchWindows(q: string, o: { since: number; fresh: number; before: number; at: number }): { fresh: string | null; deep: string } {
  const floor = isoStamp(o.since);
  const deep = o.before > o.since ? `${q} pushed:${floor}..${isoStamp(o.before)}` : `${q} pushed:>=${floor}`;
  // Nothing has been looked at yet: the deep walk starts at the top and the freshness pass would duplicate it.
  const fresh = o.fresh > o.since && o.fresh < o.at ? `${q} pushed:>=${isoStamp(o.fresh)}` : null;
  return { fresh, deep };
}

/** Where the deep walk resumes: just past the oldest repo it read. Zero when the water ran out or the run
 *  reached the 90-day floor, which sends the next run back to the top — by then there is new water there. */
export function nextBefore(oldest: number, since: number): number {
  return oldest > since ? oldest : 0;
}

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

  for (const qi of work) {
    if (out.queued.length >= budget || out.judged >= maxJudged || calls >= SEARCH_CALLS) break;
    const fresh = Number(await getState(db, `trawl:fresh:${qi}`)) || 0;
    const before = Number(await getState(db, `trawl:before:${qi}`)) || 0;
    const win = searchWindows(queries[qi], { since, fresh, before, at: t });
    let oldest = 0;
    let matched = 0;

    // The freshness pass: only repos pushed since the last look, so it is usually one call returning nothing.
    // Kept separate from the deep walk because it is the only part that is meant to cover the same ground twice.
    const passes: { q: string; deep: boolean }[] = [];
    if (win.fresh) passes.push({ q: win.fresh, deep: false });
    passes.push({ q: win.deep, deep: true });

    for (const pass of passes) {
      const maxPages = pass.deep ? PAGES_PER_QUERY - (win.fresh ? 1 : 0) : 1;
      for (let page = 1; page <= maxPages; page++) {
        if (out.queued.length >= budget || out.judged >= maxJudged) break;
        if (gh.throttled()) { out.note = "github rate limit"; break; }
        if (calls >= SEARCH_CALLS) { out.note = `search budget spent (${SEARCH_CALLS} calls)`; break; }
        const r = await gh.searchRepos(pass.q, page, 50);
        calls++;
        out.searched++;
        if (r.status !== 200 || !r.data) { await setState(db, "trawl:last_error", `${r.status}`); break; }
        const items = r.data.items ?? [];
        matched += r.data.total_count ?? 0;
        if (!items.length) break;
        const names = items.map((i) => i.full_name.toLowerCase());
        const ph = names.map(() => "?").join(",");
        const [known, before2] = await Promise.all([
          db.prepare(`SELECT lower(full_name) AS n FROM repos WHERE lower(full_name) IN (${ph})`).bind(...names).all<{ n: string }>(),
          db.prepare(`SELECT full_name AS n FROM trawl_skipped WHERE full_name IN (${ph})`).bind(...names).all<{ n: string }>(),
        ]);
        const knownSet = new Set([...(known.results ?? []), ...(before2.results ?? [])].map((k) => k.n));
        for (const g of items) {
          const pushed = Math.floor(Date.parse(g.pushed_at) / 1000) || 0;
          // The deep walk resumes below the oldest thing it read, whatever happened to that repo afterwards.
          if (pass.deep && pushed > 0 && (oldest === 0 || pushed < oldest)) oldest = pushed;
          if (out.queued.length >= budget || gh.throttled()) break;
          if (out.judged >= maxJudged) { out.note = `judge budget spent (${maxJudged}); the rest waits for the next run`; break; }
          if (knownSet.has(g.full_name.toLowerCase())) continue;
          if (g.stargazers_count < MIN_STARS || g.stargazers_count > MAX_STARS) continue;
          if (pushed < since) continue;
          // Broad to fine, cheapest first: the hard rules and the description sieve cost nothing, a README is
          // a GitHub call, and the judge is money. Nothing reaches the judge that could have been settled here.
          const hard = curatedCheck(g, { known: new Set(), deny }) ?? cheapReject(g);
          if (hard) { skips.push({ full_name: g.full_name.toLowerCase(), why: hard }); continue; }
          const readme = await gh.readmeText(g.owner.login, g.name);
          const claim = claimSnippet(`${g.description ?? ""}. ${readme}`);
          if (!claim) { skips.push({ full_name: g.full_name.toLowerCase(), why: "no past-tense claim that an AI tool wrote it" }); continue; }
          const reason = autoReason(g, claim);
          if (!reason) { skips.push({ full_name: g.full_name.toLowerCase(), why: "could not build a reason" }); continue; }
          const verdict = await judgeCandidate(env, { full_name: g.full_name, description: g.description ?? "", topics: g.topics ?? [], language: g.language, stars: g.stargazers_count, claim, readme });
          out.judged++;
          // The verdict is kept either way: what the trawl threw back is the larger, more interesting half of the
          // sample, and /trends counts both. Only `code` decides anything; `domain` is recorded and nothing else.
          if (!verdict.keep) { skips.push({ full_name: g.full_name.toLowerCase(), why: `judge: ${verdict.code ?? verdict.error ?? "no"}`, code: verdict.code, domain: verdict.domain }); continue; }
          await insertPick(db, curatedPick(g, reason, t), verdict).run();
          out.queued.push(g.full_name);
        }
      }
    }
    // What this search is worth, so the rotation can stop giving empty water equal time, and where to resume.
    await setState(db, `trawl:yield:${qi}`, `${matched}|${t}`);
    await setState(db, `trawl:fresh:${qi}`, String(t));
    await setState(db, `trawl:before:${qi}`, String(nextBefore(oldest, since)));
  }

  out.skipped = skips.length;
  if (skips.length) await db.batch(skips.slice(0, 100).map((s) => db.prepare("INSERT OR IGNORE INTO trawl_skipped (full_name, reason, judge_code, judge_domain) VALUES (?, ?, ?, ?)").bind(s.full_name, s.why.slice(0, 300), s.code ?? null, s.domain ?? null)));
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

/** The daily drip: hand-vetted backlog first, then the auto-trawl fills what is left of TRAWL_PER_DAY.
 *  Stops once TRAWL_STOP_AT opted-in repos are listed. Shares the trawl:YYYY-MM-DD counter, so setting it high in
 *  crawl_state pauses a day without a deploy.
 *
 *  `cap` is how much of the day's remaining budget this run may spend. The 00:05 round passes nothing and takes
 *  what is left; the hourly slice passes a handful, so the front page gains a few repos an hour instead of all
 *  of them at midnight and none for the next twenty-three hours. Both go through the same gates and the same
 *  counter, so the day's total is what TRAWL_PER_DAY always said it was. */
export async function trawlDaily(env: Env, cap?: number): Promise<{ queued: string[]; skipped: { repo: string; why: string }[]; left: number; note?: string; auto?: unknown; chase?: string }> {
  const db = env.DB;
  const stopAt = Number(env.TRAWL_STOP_AT || 300);
  const opted = await db.prepare("SELECT count(*) AS n FROM repos WHERE status = 'listed' AND source = 'marker'").first<{ n: number }>();
  if ((opted?.n ?? 0) >= stopAt) return { queued: [], skipped: [], left: 0, note: `expedition over: ${opted?.n} opted-in listings (TRAWL_STOP_AT ${stopAt})` };
  const day = new Date(now() * 1000).toISOString().slice(0, 10);
  const done = Number((await getState(db, `trawl:${day}`)) ?? 0);
  const remaining = Number(env.TRAWL_PER_DAY || 50) - done;
  const budget = cap != null ? Math.min(remaining, Math.max(0, Math.floor(cap))) : remaining;
  if (budget <= 0) return { queued: [], skipped: [], left: 0, note: `today's releases are done (or paused): trawl:${day} = ${done}` };
  // She has put to sea. Recorded before the work, not after, so a rate limit halfway through still says
  // she sailed — and recorded only past the two returns above, which are the days she did not. This is
  // the one timestamp the rail's chart steers by; until now only the manual trawl() ever wrote it.
  await setState(db, "trawl:last_run", String(now()));
  const res = await releaseBacklog(env, budget);
  const left = budget - res.queued.length;
  const auto = left > 0 ? await autoTrawl(env, left) : undefined;
  await setState(db, `trawl:${day}`, String(done + res.queued.length + res.skipped.length + (auto?.queued.length ?? 0)));
  // Unconditional: a night that caught nothing still moved the chart, and releaseBacklog/autoTrawl only
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
    await setState(db, `trawl:chase:${day}`, String(chases + 1));
    await setState(db, "trawl:run_at", String(now() + CHASE_DELAY));
  }
  return { ...res, auto, chase: chase ? `landed ${landed} of ${budget}; going out again in ${CHASE_DELAY / 60} min (chase ${chases + 1}/${CHASE_MAX})` : undefined };
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
  await setState(db, `trawl:${day}`, String(doneToday + out.picked));
  await setState(db, "trawl:last_run", String(t));
  if (out.picked) { await bump(db, "found", out.picked); await markDirty(db); }
  return out;
}
