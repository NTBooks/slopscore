// Thin typed helpers over D1 prepared statements. Keep CPU low: raw SQL, no ORM.
import { hot as hotRank, controversy as contRank } from "./rank";
import { now, SORT_WINDOWS } from "./time";
import { filterSql, type Filter } from "./searchquery";
import type { TagRow } from "./slopmd";
import { WIP_STATUSES } from "./vocab";
import { trustFor, ringCheck } from "./trust";

export interface RepoRow {
  id: number; full_name: string; owner: string; name: string; owner_id: number | null; owner_type: string | null;
  default_branch: string; title: string | null; tagline: string | null; demo_url: string | null;
  stars: number; forks: number; language: string | null; license: string | null; pushed_at: number | null;
  gh_created_at: number | null; is_fork: number; archived: number; gh: string | null;
  readme_html: string | null; readme_sha: string | null; images: string | null; images_hidden: number;
  etag_repo: string | null; etag_readme: string | null; etag_contents: string | null;
  md_sha: string | null; md_updated_at: number | null; meta: string | null; body_md: string | null; body_html: string | null;
  tags_flat: string | null;
  status: "discovered" | "quarantined" | "rejected" | "listed" | "hidden" | "delisted";
  tier: "found" | "submitted"; submitted_by: number | null; submitted_at: number | null;
  removed_at: number | null; removed_reason: string | null; queue_reason: string | null; risk: number;
  reject_reason: string | null; scan: string | null;
  up: number; down: number; score: number; hot: number; controversy: number; comment_count: number; report_count: number;
  first_seen: number; listed_at: number | null; last_crawled: number | null; next_crawl: number | null; priority_at: number | null;
}

export interface UserRow {
  id: number; login: string; avatar_url: string | null; gh_created_at: number | null; public_repos: number;
  followers: number; banned_at: number | null; created_at: number; last_seen: number | null; trust: number;
}

export interface CommentRow {
  id: number; repo_id: number; user_id: number; parent_id: number | null; body_md: string; body_html: string;
  up: number; down: number; deleted_at: number | null; hidden_at: number | null; created_at: number;
  login: string; avatar_url: string | null;
}

export const SORTS = ["hot", "new", "top", "rising", "controversial", "updated", "upcoming"] as const;
export type Sort = (typeof SORTS)[number];
export const PAGE_SIZE = 25;

export interface FeedOpts {
  sort: Sort;
  t?: string;
  page?: number;
  filters?: Filter[];
  match?: string | null;
  status?: RepoRow["status"] | RepoRow["status"][];
  owner?: string;
  tier?: "found" | "submitted";
  /** subreddit-style tag: matches category, tags, domain, or topic */
  tag?: string;
  /** queue view: FIFO ordering; true = paid jumpers only, false = free line only */
  queue?: boolean;
  priority?: boolean;
}

export function feedOrder(sort: Sort): string {
  switch (sort) {
    case "new": return "r.listed_at DESC, r.id DESC";
    case "top": return "r.score DESC, r.up DESC, r.id DESC";
    case "rising": return "r.score DESC, r.listed_at DESC";
    case "controversial": return "r.controversy DESC, r.id DESC";
    case "updated": return "r.md_updated_at DESC, r.id DESC";
    case "upcoming": return "r.score DESC, r.listed_at DESC";
    default: return "r.hot DESC, r.id DESC";
  }
}

export async function feed(db: D1Database, o: FeedOpts): Promise<{ rows: RepoRow[]; hasMore: boolean; page: number }> {
  const page = Math.max(1, o.page ?? 1);
  const where: string[] = [];
  const params: unknown[] = [];
  const statuses = Array.isArray(o.status) ? o.status : [o.status ?? "listed"];
  where.push(`r.status IN (${statuses.map(() => "?").join(",")})`);
  params.push(...statuses);
  if (o.owner) { where.push("lower(r.owner) = ?"); params.push(o.owner.toLowerCase()); }
  if (o.tier) { where.push("r.tier = ?"); params.push(o.tier); }
  if (o.priority === true) where.push("r.priority_at IS NOT NULL");
  if (o.priority === false) where.push("r.priority_at IS NULL");
  if (o.tag) { where.push("EXISTS (SELECT 1 FROM repo_tags tt WHERE tt.repo_id = r.id AND tt.facet IN ('slopbucket','category','tags','domain','topic') AND tt.value = ?)"); params.push(o.tag.toLowerCase()); }
  const win = SORT_WINDOWS[o.t ?? "all"] ?? 0;
  if (win && (o.sort === "top" || o.sort === "controversial" || o.sort === "new")) {
    where.push("r.listed_at >= ?"); params.push(now() - win);
  }
  if (o.sort === "rising") { where.push("r.listed_at >= ?"); params.push(now() - 3 * 86400); }
  if (o.sort === "upcoming") {
    where.push(`EXISTS (SELECT 1 FROM repo_tags wt WHERE wt.repo_id = r.id AND wt.facet = 'status' AND wt.value IN (${[...WIP_STATUSES].map(() => "?").join(",")}))`);
    params.push(...WIP_STATUSES);
  }
  if (o.filters?.length) { const f = filterSql(o.filters); where.push(...f.where); params.push(...f.params); }
  let from = "repos r";
  if (o.match) {
    from = "repos_fts f JOIN repos r ON r.id = f.rowid";
    where.push("repos_fts MATCH ?"); params.push(o.match);
  }
  const order = o.queue ? "r.priority_at IS NULL, r.priority_at ASC, r.first_seen ASC" : feedOrder(o.sort);
  const sql = `SELECT r.* FROM ${from} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT ? OFFSET ?`;
  params.push(PAGE_SIZE + 1, (page - 1) * PAGE_SIZE);
  const res = await db.prepare(sql).bind(...params).all<RepoRow>();
  const rows = res.results ?? [];
  return { rows: rows.slice(0, PAGE_SIZE), hasMore: rows.length > PAGE_SIZE, page };
}

export async function getRepo(db: D1Database, owner: string, name: string): Promise<RepoRow | null> {
  return db.prepare("SELECT * FROM repos WHERE lower(full_name) = lower(?)").bind(`${owner}/${name}`).first<RepoRow>();
}

export async function getRepoById(db: D1Database, id: number): Promise<RepoRow | null> {
  return db.prepare("SELECT * FROM repos WHERE id = ?").bind(id).first<RepoRow>();
}

export async function repoTags(db: D1Database, repoId: number): Promise<TagRow[]> {
  const r = await db.prepare("SELECT facet, value, source, recognized FROM repo_tags WHERE repo_id = ? ORDER BY facet, value").bind(repoId).all<{ facet: string; value: string; source: TagRow["source"]; recognized: number }>();
  return (r.results ?? []).map((x) => ({ ...x, recognized: Boolean(x.recognized) }));
}

/** Replace a repo's tag rows and its tags_flat FTS column. */
export async function replaceTags(db: D1Database, repoId: number, tags: TagRow[]): Promise<void> {
  const stmts = [db.prepare("DELETE FROM repo_tags WHERE repo_id = ?").bind(repoId)];
  for (const t of tags) {
    stmts.push(db.prepare("INSERT OR IGNORE INTO repo_tags (repo_id, facet, value, source, recognized) VALUES (?,?,?,?,?)").bind(repoId, t.facet, t.value, t.source, t.recognized ? 1 : 0));
  }
  const flat = tags.map((t) => `${t.facet}:${t.value} ${t.value}`).join(" ");
  stmts.push(db.prepare("UPDATE repos SET tags_flat = ? WHERE id = ?").bind(flat, repoId));
  await db.batch(stmts);
}

export async function facetCounts(db: D1Database, facet: string, limit = 50): Promise<{ value: string; n: number }[]> {
  const r = await db.prepare(
    "SELECT rt.value, count(*) AS n FROM repo_tags rt JOIN repos r ON r.id = rt.repo_id WHERE rt.facet = ? AND r.status = 'listed' GROUP BY rt.value ORDER BY n DESC, rt.value LIMIT ?",
  ).bind(facet, limit).all<{ value: string; n: number }>();
  return r.results ?? [];
}

export async function siteStats(db: D1Database): Promise<{ listed: number; queued: number; users: number; votes: number; comments: number }> {
  const r = await db.prepare(
    `SELECT
      (SELECT count(*) FROM repos WHERE status = 'listed') AS listed,
      (SELECT count(*) FROM repos WHERE status IN ('discovered','quarantined')) AS queued,
      (SELECT count(*) FROM users) AS users,
      (SELECT count(*) FROM votes) AS votes,
      (SELECT count(*) FROM comments WHERE deleted_at IS NULL) AS comments`,
  ).first<{ listed: number; queued: number; users: number; votes: number; comments: number }>();
  return r ?? { listed: 0, queued: 0, users: 0, votes: 0, comments: 0 };
}

// ---- users ----
export async function getUser(db: D1Database, id: number): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
}
export async function getUserByLogin(db: D1Database, login: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE lower(login) = lower(?)").bind(login).first<UserRow>();
}
export async function upsertUser(db: D1Database, u: { id: number; login: string; avatar_url: string; gh_created_at: number | null; public_repos: number; followers: number }): Promise<void> {
  const trust = trustFor({ ...u, banned_at: null });
  await db.prepare(
    `INSERT INTO users (id, login, avatar_url, gh_created_at, public_repos, followers, trust, last_seen) VALUES (?,?,?,?,?,?,?,unixepoch())
     ON CONFLICT(id) DO UPDATE SET login = excluded.login, avatar_url = excluded.avatar_url, gh_created_at = excluded.gh_created_at,
       public_repos = excluded.public_repos, followers = excluded.followers, trust = excluded.trust, last_seen = unixepoch()`,
  ).bind(u.id, u.login, u.avatar_url, u.gh_created_at, u.public_repos, u.followers, trust).run();
}

// ---- votes ----
export async function userVote(db: D1Database, userId: number, repoId: number): Promise<number> {
  const r = await db.prepare("SELECT value FROM votes WHERE user_id = ? AND repo_id = ?").bind(userId, repoId).first<{ value: number }>();
  return r?.value ?? 0;
}

export async function userVotesFor(db: D1Database, userId: number, repoIds: number[]): Promise<Map<number, number>> {
  const m = new Map<number, number>();
  if (!repoIds.length) return m;
  const r = await db.prepare(`SELECT repo_id, value FROM votes WHERE user_id = ? AND repo_id IN (${repoIds.map(() => "?").join(",")})`).bind(userId, ...repoIds).all<{ repo_id: number; value: number }>();
  for (const v of r.results ?? []) m.set(v.repo_id, v.value);
  return m;
}

/** Upsert/remove a vote and recompute the repo's counters. value 0 removes the vote.
 *  Weighted: score = round(sum(weight * value)); up/down stay raw counts. Suspected vote rings get weight 0. */
export async function castVote(db: D1Database, user: UserRow, repo: RepoRow, value: -1 | 0 | 1, ipHashValue: string | null = null): Promise<RepoRow & { ring?: string }> {
  let weight = user.trust ?? trustFor(user);
  let ring: string | undefined;
  if (value !== 0) {
    const rc = await ringCheck(db, repo.id, ipHashValue);
    if (rc.suspicious) { weight = 0; ring = rc.reason; }
  }
  const write = value === 0
    ? db.prepare("DELETE FROM votes WHERE user_id = ? AND repo_id = ?").bind(user.id, repo.id)
    : db.prepare("INSERT INTO votes (user_id, repo_id, value, weight, ip_hash) VALUES (?,?,?,?,?) ON CONFLICT(user_id, repo_id) DO UPDATE SET value = excluded.value, weight = excluded.weight, ip_hash = excluded.ip_hash, created_at = unixepoch()").bind(user.id, repo.id, value, weight, ipHashValue);
  const count = db.prepare(
    `SELECT
      sum(CASE WHEN v.value = 1 THEN 1 ELSE 0 END) AS up,
      sum(CASE WHEN v.value = -1 THEN 1 ELSE 0 END) AS down,
      sum(v.value * v.weight) AS weighted
     FROM votes v JOIN users u ON u.id = v.user_id WHERE v.repo_id = ? AND u.banned_at IS NULL`,
  ).bind(repo.id);
  const [, counts] = await db.batch<{ up: number | null; down: number | null; weighted: number | null }>([write, count]);
  const up = counts.results?.[0]?.up ?? 0;
  const down = counts.results?.[0]?.down ?? 0;
  const score = Math.round(counts.results?.[0]?.weighted ?? 0);
  const created = repo.submitted_at ?? repo.listed_at ?? repo.first_seen;
  const h = hotRank(Math.max(score, 0), Math.max(-score, 0), created);
  const c = contRank(up, down);
  await db.prepare("UPDATE repos SET up = ?, down = ?, score = ?, hot = ?, controversy = ? WHERE id = ?").bind(up, down, score, h, c, repo.id).run();
  return { ...repo, up, down, score, hot: h, controversy: c, ring };
}

export interface Bucket { slug: string; title: string; blurb: string | null; curated: number; banned: number; banned_reason: string | null; created_by: string | null; n: number }

const BUCKET_COUNT = "(SELECT count(DISTINCT rt.repo_id) FROM repo_tags rt JOIN repos r ON r.id = rt.repo_id WHERE r.status = 'listed' AND rt.facet IN ('slopbucket','category','tags','domain','topic') AND rt.value = t.slug)";

/** Curated, unbanned buckets for the bucket bar and the rail. */
export async function curatedTags(db: D1Database): Promise<Bucket[]> {
  const r = await db.prepare(`SELECT t.*, ${BUCKET_COUNT} AS n FROM tags t WHERE t.curated = 1 AND t.banned = 0 ORDER BY t.sort, t.slug`).all<Bucket>();
  return r.results ?? [];
}

/** Every bucket (for /b and /mod): curated first, then community buckets by size, banned last. */
export async function allBuckets(db: D1Database): Promise<Bucket[]> {
  const r = await db.prepare(`SELECT t.*, ${BUCKET_COUNT} AS n FROM tags t ORDER BY t.banned ASC, t.curated DESC, n DESC, t.sort, t.slug`).all<Bucket>();
  return r.results ?? [];
}

export async function getTag(db: D1Database, slug: string): Promise<Bucket | null> {
  return db.prepare(`SELECT t.*, ${BUCKET_COUNT} AS n FROM tags t WHERE t.slug = ?`).bind(slug.toLowerCase()).first<Bucket>();
}

/** Registers buckets a repo declared (community buckets are uncurated); returns the banned ones so the caller can strip them. */
export async function registerBuckets(db: D1Database, slugs: string[], createdBy: string): Promise<string[]> {
  if (!slugs.length) return [];
  await db.batch(slugs.map((s) => db.prepare("INSERT OR IGNORE INTO tags (slug, title, blurb, curated, sort, created_by) VALUES (?, ?, NULL, 0, 500, ?)").bind(s, s.replace(/-/g, " "), createdBy)));
  const banned = await db.prepare(`SELECT slug FROM tags WHERE banned = 1 AND slug IN (${slugs.map(() => "?").join(",")})`).bind(...slugs).all<{ slug: string }>();
  return (banned.results ?? []).map((b) => b.slug);
}

// ---- comments ----
export async function comments(db: D1Database, repoId: number): Promise<CommentRow[]> {
  const r = await db.prepare(
    `SELECT c.*, u.login, u.avatar_url FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.repo_id = ? AND c.hidden_at IS NULL ORDER BY c.created_at ASC`,
  ).bind(repoId).all<CommentRow>();
  return r.results ?? [];
}

export async function addComment(db: D1Database, repoId: number, userId: number, parentId: number | null, bodyMd: string, bodyHtml: string): Promise<number> {
  const [ins] = await db.batch([
    db.prepare("INSERT INTO comments (repo_id, user_id, parent_id, body_md, body_html) VALUES (?,?,?,?,?)").bind(repoId, userId, parentId, bodyMd, bodyHtml),
    db.prepare("UPDATE repos SET comment_count = comment_count + 1 WHERE id = ?").bind(repoId),
  ]);
  return Number(ins.meta.last_row_id);
}

export async function castCommentVote(db: D1Database, userId: number, commentId: number, value: -1 | 0 | 1): Promise<{ up: number; down: number }> {
  const write = value === 0
    ? db.prepare("DELETE FROM comment_votes WHERE user_id = ? AND comment_id = ?").bind(userId, commentId)
    : db.prepare("INSERT INTO comment_votes (user_id, comment_id, value) VALUES (?,?,?) ON CONFLICT(user_id, comment_id) DO UPDATE SET value = excluded.value").bind(userId, commentId, value);
  const count = db.prepare("SELECT sum(CASE WHEN value = 1 THEN 1 ELSE 0 END) AS up, sum(CASE WHEN value = -1 THEN 1 ELSE 0 END) AS down FROM comment_votes WHERE comment_id = ?").bind(commentId);
  const [, counts] = await db.batch<{ up: number | null; down: number | null }>([write, count]);
  const up = counts.results?.[0]?.up ?? 0;
  const down = counts.results?.[0]?.down ?? 0;
  await db.prepare("UPDATE comments SET up = ?, down = ? WHERE id = ?").bind(up, down, commentId).run();
  return { up, down };
}

// ---- rate limits (D1-backed fixed window) ----
export async function rateLimit(db: D1Database, key: string, max: number, windowSecs: number): Promise<boolean> {
  const t = now();
  const row = await db.prepare("SELECT count, window_start FROM rate_limits WHERE key = ?").bind(key).first<{ count: number; window_start: number }>();
  if (!row || t - row.window_start >= windowSecs) {
    await db.prepare("INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start").bind(key, t).run();
    return true;
  }
  if (row.count >= max) return false;
  await db.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").bind(key).run();
  return true;
}

// ---- mod log ----
export async function logAction(db: D1Database, a: { actor: string; role: "admin" | "owner" | "system"; action: string; targetType: string; targetId: number; label?: string; note?: string }): Promise<void> {
  await db.prepare("INSERT INTO mod_log (actor_login, actor_role, action, target_type, target_id, target_label, note) VALUES (?,?,?,?,?,?,?)")
    .bind(a.actor, a.role, a.action, a.targetType, a.targetId, a.label ?? null, a.note ?? null).run();
}

export async function awardsFor(db: D1Database, repoId: number): Promise<{ kind: string; period: string; rank: number }[]> {
  const r = await db.prepare("SELECT kind, period, rank FROM awards WHERE repo_id = ? ORDER BY created_at DESC").bind(repoId).all<{ kind: string; period: string; rank: number }>();
  return r.results ?? [];
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

/** Scan capacity for the public queue + stats pages. Free mode: Workers AI's 10k neurons/day is the ceiling. */
export async function capacity(db: D1Database, env: { PLAN_MODE?: string; AI_NEURON_BUDGET: string; OPENROUTER_API_KEY?: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [used, depth] = await Promise.all([
    db.prepare("SELECT value FROM crawl_state WHERE key = ?").bind(`ai_neurons:${today}`).first<{ value: string }>(),
    db.prepare("SELECT sum(CASE WHEN priority_at IS NOT NULL THEN 1 ELSE 0 END) AS paid, sum(CASE WHEN priority_at IS NULL THEN 1 ELSE 0 END) AS free, sum(CASE WHEN queue_reason = 'ai-budget' THEN 1 ELSE 0 END) AS deferred FROM repos WHERE status = 'discovered'").first<{ paid: number | null; free: number | null; deferred: number | null }>(),
  ]);
  const mode = env.PLAN_MODE === "paid" ? "paid" : "free";
  const budget = Number(env.AI_NEURON_BUDGET || 9000);
  const perScan = 240; // ~230 Llama Guard + ~10 vision
  const neuronsUsed = Number(used?.value ?? 0);
  return {
    mode, date: today, budget, neurons_used: neuronsUsed, neurons_left: Math.max(0, budget - neuronsUsed),
    scans_per_day: Math.floor(budget / perScan), scans_left_today: Math.floor(Math.max(0, budget - neuronsUsed) / perScan),
    paid_scans_unlimited: mode === "paid" || Boolean(env.OPENROUTER_API_KEY),
    paid_scan_provider: env.OPENROUTER_API_KEY ? "openrouter" : mode === "paid" ? "workers-ai (metered)" : "workers-ai (same free ceiling)",
    queue: { paid: depth?.paid ?? 0, free: depth?.free ?? 0, deferred: depth?.deferred ?? 0 },
    limits: mode === "free"
      ? { workers_requests_per_day: 100_000, d1_reads_per_day: 5_000_000, d1_writes_per_day: 100_000, ai_neurons_per_day: 10_000, crons: 5 }
      : { workers_requests_per_day: null, d1_reads_per_day: 25_000_000_000, d1_writes_per_day: 50_000_000, ai_neurons_per_day: null, crons: 250 },
  };
}
