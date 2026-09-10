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
