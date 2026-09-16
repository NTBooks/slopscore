// Daily counters for the public /stats page. One row per UTC day.
export type StatCol = "scans" | "deferred" | "found" | "listed" | "rejected" | "quarantined" | "reports";

export async function bump(db: D1Database, col: StatCol, n = 1): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  await db.prepare(`INSERT INTO stats_daily (date, ${col}) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET ${col} = ${col} + ?`).bind(day, n, n).run();
}

export async function setBudget(db: D1Database, budget: number): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  await db.prepare("INSERT INTO stats_daily (date, neurons_budget) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET neurons_budget = ?").bind(day, budget, budget).run();
}

export async function getState(db: D1Database, key: string): Promise<string | null> {
  const r = await db.prepare("SELECT value FROM crawl_state WHERE key = ?").bind(key).first<{ value: string }>();
  return r?.value ?? null;
}
export async function setState(db: D1Database, key: string, value: string): Promise<void> {
  await db.prepare("INSERT INTO crawl_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value).run();
}

/**
 * Add to an integer counter in crawl_state, in one statement. A read-then-write counter loses one side of
 * every race; two invocations of the same job in the same minute (the hourly trawl and a chase, say)
 * both count here and neither is lost. A value that is not a number counts as zero.
 */
/**
 * A lease on a job, in one statement. The row holds the time the lease expires; the insert wins when there
 * is no row, and the update wins only when the row's lease has run out. One write, no read before it, so
 * two invocations in the same second cannot both come away holding it. A run that dies leaves a lease that
 * expires on its own, which is what makes a TTL better than a flag.
 */
export async function claimLock(db: D1Database, key: string, ttlSeconds: number): Promise<boolean> {
  const t = Math.floor(Date.now() / 1000);
  const r = await db.prepare(
    "INSERT INTO crawl_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE CAST(crawl_state.value AS INTEGER) < ?",
  ).bind(key, String(t + ttlSeconds), t).run();
  return (r.meta.changes ?? 0) > 0;
}

export async function releaseLock(db: D1Database, key: string): Promise<void> {
  await db.prepare("DELETE FROM crawl_state WHERE key = ?").bind(key).run();
}

export async function bumpState(db: D1Database, key: string, n: number): Promise<void> {
  await db.prepare(
    "INSERT INTO crawl_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = CAST(COALESCE(CAST(crawl_state.value AS INTEGER), 0) + excluded.value AS TEXT)",
  ).bind(key, String(Math.floor(n))).run();
}
