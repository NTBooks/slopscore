// Truffle trawling expedition. Picks are vetted by hand (an admin, or the admin's agent reading READMEs) and posted to
// POST /mod/trawl/import, which puts them in trawl_backlog. The daily 00:05 UTC tick releases TRAWL_PER_DAY of them into
// a lane of their own: trawled finds are scanned on our OpenRouter bill (src/jobs/scan.ts), never taking a free slot or a
// Workers AI neuron from a repo that came to us, and a trawled repo that turns out to have the file moves to the free
// line (src/jobs/sweep.ts). Releases stop for good once TRAWL_STOP_AT opted-in repos are listed. The keyword search trawl below is manual only (/__cron?cron=trawl&n=20): keywords can't tell a vibe-coded app
// from a tool for vibe coders, so it only trusts past-tense claims.
import { GitHub } from "../lib/github";
import type { Env } from "../env";
import { loadDenyRows } from "../lib/denylist";
import { pickCandidates, trawlQueries, curatedCheck, curatedPick, cleanReason, claimSnippet, autoReason, MIN_STARS, MAX_STARS, PUSHED_WITHIN_DAYS, type Pick } from "../lib/virtual";
import { judgeCandidate } from "../lib/judge";
import { markDirty } from "../lib/cache";
import { now } from "../lib/time";
import { bump, getState, setState } from "./stats";

const PER_PAGE = 50;
const MAX_PAGES = 3; // repository search allows 30 calls a minute; 6 queries x 3 pages stays under it

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
  const budget = Math.min(Math.max(0, Math.floor(n)), 50);
  if (!budget) return out;
  const gh = new GitHub(env.GITHUB_CRAWL_TOKEN);
  const deny = await loadDenyRows(db);
  const queries = trawlQueries(t);
  const start = Number((await getState(db, "trawl:cursor")) ?? 0) % queries.length;
  const skips: { full_name: string; why: string; code?: string | null; domain?: string | null }[] = [];
  for (let qi = 0; qi < queries.length && out.queued.length < budget; qi++) {
    const q = queries[(start + qi) % queries.length];
    for (let page = 1; page <= 2 && out.queued.length < budget; page++) {
      if (gh.throttled()) { out.note = "github rate limit"; break; }
      const r = await gh.searchRepos(q, page, 50);
      out.searched++;
      if (r.status !== 200 || !r.data) { await setState(db, "trawl:last_error", `${r.status}`); break; }
      const items = r.data.items ?? [];
      if (!items.length) break;
      const names = items.map((i) => i.full_name.toLowerCase());
      const ph = names.map(() => "?").join(",");
      const [known, before] = await Promise.all([
        db.prepare(`SELECT lower(full_name) AS n FROM repos WHERE lower(full_name) IN (${ph})`).bind(...names).all<{ n: string }>(),
        db.prepare(`SELECT full_name AS n FROM trawl_skipped WHERE full_name IN (${ph})`).bind(...names).all<{ n: string }>(),
      ]);
      const knownSet = new Set([...(known.results ?? []), ...(before.results ?? [])].map((k) => k.n));
      for (const g of items) {
        if (out.queued.length >= budget || gh.throttled()) break;
        if (knownSet.has(g.full_name.toLowerCase())) continue;
        if (g.stargazers_count < MIN_STARS || g.stargazers_count > MAX_STARS) continue;
        if ((Date.parse(g.pushed_at) / 1000 || 0) < t - PUSHED_WITHIN_DAYS * 86400) continue;
        const hard = curatedCheck(g, { known: new Set(), deny });
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
  out.skipped = skips.length;
  if (skips.length) await db.batch(skips.slice(0, 100).map((s) => db.prepare("INSERT OR IGNORE INTO trawl_skipped (full_name, reason, judge_code, judge_domain) VALUES (?, ?, ?, ?)").bind(s.full_name, s.why.slice(0, 300), s.code ?? null, s.domain ?? null)));
  await setState(db, "trawl:cursor", String(start + 1));
  if (out.queued.length) { await bump(db, "found", out.queued.length); await markDirty(db); }
  return out;
}

/** The daily drip (00:05 UTC): hand-vetted backlog first, then the auto-trawl fills what is left of TRAWL_PER_DAY.
 *  Stops once TRAWL_STOP_AT opted-in repos are listed. Shares the trawl:YYYY-MM-DD counter, so setting it high in
 *  crawl_state pauses a day without a deploy. */
export async function trawlDaily(env: Env): Promise<{ queued: string[]; skipped: { repo: string; why: string }[]; left: number; note?: string; auto?: unknown }> {
  const db = env.DB;
  const stopAt = Number(env.TRAWL_STOP_AT || 300);
  const opted = await db.prepare("SELECT count(*) AS n FROM repos WHERE status = 'listed' AND source = 'marker'").first<{ n: number }>();
  if ((opted?.n ?? 0) >= stopAt) return { queued: [], skipped: [], left: 0, note: `expedition over: ${opted?.n} opted-in listings (TRAWL_STOP_AT ${stopAt})` };
  const day = new Date(now() * 1000).toISOString().slice(0, 10);
  const done = Number((await getState(db, `trawl:${day}`)) ?? 0);
  const budget = Number(env.TRAWL_PER_DAY || 50) - done;
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
  return { ...res, auto };
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
