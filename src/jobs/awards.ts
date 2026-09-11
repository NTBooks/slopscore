// Cron 5 0 * * *: Slop of the Day (yesterday), Slop of the Week + Most Promising (Mondays, previous ISO week).
// Only submitted repos compete; the period is the launch (submitted_at) day/week. Critic votes are subtracted: critics shape the feed, never the winners.
import { markDirty } from "../lib/cache";
import type { Env } from "../env";
import { WIP_STATUSES } from "../lib/vocab";
import { pruneViews } from "../lib/views";

export async function awards(env: Env, today = new Date()): Promise<{ day: number; week: number; upcoming: number; period: string }> {
  const db = env.DB;
  const y = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 1));
  const dayStart = Math.floor(y.getTime() / 1000);
  const dayEnd = dayStart + 86400;
  const period = y.toISOString().slice(0, 10);

  const dayRows = await db.prepare(
    "SELECT id, score, up FROM repos WHERE status = 'listed' AND tier = 'submitted' AND submitted_at >= ? AND submitted_at < ? ORDER BY score - 0.5 * critic_up DESC, up DESC, id ASC LIMIT 5",
  ).bind(dayStart, dayEnd).all<{ id: number; score: number }>().then((r) => r.results ?? []);
  if (dayRows.length) {
    await db.batch(dayRows.map((r, i) => db.prepare("INSERT OR IGNORE INTO awards (repo_id, kind, period, rank, score) VALUES (?, 'day', ?, ?, ?)").bind(r.id, period, i + 1, r.score)));
  }

  let week = 0, upcoming = 0;
  if (today.getUTCDay() === 1) { // Monday: previous ISO week Mon..Sun
    const weekStart = dayStart - 6 * 86400;
    const weekEnd = dayEnd;
    const wk = isoWeek(new Date(weekStart * 1000));
    const rows = await db.prepare(
      "SELECT id, score, up FROM repos WHERE status = 'listed' AND tier = 'submitted' AND submitted_at >= ? AND submitted_at < ? ORDER BY score - 0.5 * critic_up DESC, up DESC, id ASC LIMIT 5",
    ).bind(weekStart, weekEnd).all<{ id: number; score: number }>().then((r) => r.results ?? []);
    if (rows.length) await db.batch(rows.map((r, i) => db.prepare("INSERT OR IGNORE INTO awards (repo_id, kind, period, rank, score) VALUES (?, 'week', ?, ?, ?)").bind(r.id, wk, i + 1, r.score)));
    week = rows.length;
    const wip = await db.prepare(
      `SELECT r.id, r.score FROM repos r WHERE r.status = 'listed' AND r.tier = 'submitted' AND r.submitted_at >= ? AND r.submitted_at < ?
         AND EXISTS (SELECT 1 FROM repo_tags t WHERE t.repo_id = r.id AND t.facet = 'status' AND t.value IN (${[...WIP_STATUSES].map(() => "?").join(",")}))
       ORDER BY r.score - 0.5 * r.critic_up DESC, r.up DESC, r.id ASC LIMIT 3`,
    ).bind(weekStart, weekEnd, ...WIP_STATUSES).all<{ id: number; score: number }>().then((r) => r.results ?? []);
    if (wip.length) await db.batch(wip.map((r, i) => db.prepare("INSERT OR IGNORE INTO awards (repo_id, kind, period, rank, score) VALUES (?, 'upcoming-week', ?, ?, ?)").bind(r.id, wk, i + 1, r.score)));
    upcoming = wip.length;
  }
  await pruneViews(db);
  await markDirty(db);
  return { day: dayRows.length, week, upcoming, period };
}

export function isoWeek(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}
