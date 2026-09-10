// Visitor counting for vote correlation. One sampled UPDATE per page view, bucketed per repo per UTC hour.
// VIEW_SAMPLE=1 counts every view; VIEW_SAMPLE=10 writes 1 in 10 and multiplies (for when D1's 100k writes/day gets tight).
import { now } from "./time";

export const hourBucket = (t = now()) => Math.floor(t / 3600);

export async function recordView(db: D1Database, repoId: number, sample = 1): Promise<void> {
  if (sample > 1 && Math.random() * sample >= 1) return;
  const inc = Math.max(1, Math.round(sample));
  await db.prepare(
    "INSERT INTO repo_views (repo_id, hour, views) VALUES (?, ?, ?) ON CONFLICT(repo_id, hour) DO UPDATE SET views = views + ?",
  ).bind(repoId, hourBucket(), inc, inc).run();
}

/** Views in the last `hours` hour buckets (including the current one). */
export async function viewsRecent(db: D1Database, repoId: number, hours = 1): Promise<number> {
  const r = await db.prepare("SELECT COALESCE(sum(views), 0) AS n FROM repo_views WHERE repo_id = ? AND hour >= ?").bind(repoId, hourBucket() - hours + 1).first<{ n: number }>();
  return r?.n ?? 0;
}

export async function viewsToday(db: D1Database, repoId: number): Promise<number> {
  const dayStart = Math.floor(now() / 86400) * 86400;
  return viewsRecent(db, repoId, hourBucket() - hourBucket(dayStart) + 1);
}

/** Prune buckets older than 35 days (called from the awards cron once a day). */
export async function pruneViews(db: D1Database): Promise<void> {
  await db.prepare("DELETE FROM repo_views WHERE hour < ?").bind(hourBucket() - 35 * 24).run();
}

/** Vote-burst rule: in a rolling hour, votes beyond max(floor, share × views) count for nothing. */
export function burstAllowance(viewsLastHour: number, floor = 10, share = 0.5): number {
  return Math.max(floor, Math.floor(viewsLastHour * share));
}
