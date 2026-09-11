// When the crawler last ran and when it runs next: the timer on /queue and the mod console.
// A Worker can't read its own cron triggers, so runCron records the expression that drove each job;
// the next fire time then comes from the schedule that is actually deployed (production runs sweep
// every 15 minutes, test runs one combined 30-minute tick, local dev runs none).

export const JOBS = ["sweep", "scan", "recrawl"] as const;
export type Job = (typeof JOBS)[number];

export const JOB_INFO: Record<Job, { label: string; does: string }> = {
  sweep: { label: "next sweep", does: "searches GitHub for new slopscore.md files" },
  scan: { label: "next scan tick", does: "inspects the front of the line" },
  recrawl: { label: "next recrawl", does: "re-checks listed repos for pushes" },
};

/** Which jobs each cron drives. Mirrors the switch in runCron (src/index.ts). */
export const CRON_JOBS: Record<string, Job[]> = {
  "*/15 * * * *": ["sweep"],
  "*/5 * * * *": ["scan"],
  "*/10 * * * *": ["recrawl"],
  "*/30 * * * *": ["sweep", "scan", "recrawl"],
};

/** Seconds a mod must wait between manual runs of the same job (GitHub code search allows ~30 calls a minute). */
export const MANUAL_COOLDOWN = 60;

/** Record the schedule behind this tick. The WHERE makes an unchanged value a zero-row write. */
export async function recordCron(db: D1Database, cron: string): Promise<void> {
  const jobs = CRON_JOBS[cron];
  if (!jobs) return;
  await db.batch(jobs.map((j) =>
    db.prepare("INSERT INTO crawl_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE value != excluded.value").bind(`${j}:cron`, cron),
  ));
}

/**
 * Next UTC minute at or after `from` + 1 minute that matches the cron's minute and hour fields.
 * Handles `*`, `*\/N`, `N` and comma lists; day, month and weekday must be `*` (all of ours are).
 */
export function nextFire(cron: string, from: number): number | null {
  const [min, hour, ...rest] = cron.trim().split(/\s+/);
  if (!min || !hour || rest.some((f) => f !== "*")) return null;
  const match = (field: string, v: number) => field.split(",").some((p) => {
    if (p === "*") return true;
    if (p.startsWith("*/")) { const n = Number(p.slice(2)); return n > 0 && v % n === 0; }
    return Number(p) === v;
  });
  let t = Math.floor(from / 60) * 60 + 60;
  for (let i = 0; i < 2 * 1440; i++, t += 60) {
    const d = new Date(t * 1000);
    if (match(min, d.getUTCMinutes()) && match(hour, d.getUTCHours())) return t;
  }
  return null;
}

/** Seconds between fires for a plain `*\/N * * * *` cron, else null (the countdown can't roll over on its own). */
export function everySeconds(cron: string): number | null {
  const m = /^\*\/(\d+) \* \* \* \*$/.exec(cron.trim());
  return m && Number(m[1]) > 0 ? Number(m[1]) * 60 : null;
}

export interface JobClock {
  job: Job;
  label: string;
  does: string;
  cron: string | null;
  every: number | null;
  last_run: number | null;
  next_run: number | null;
  manual: { at: number; by: string } | null;
}

export interface CrawlClock { now: number; jobs: JobClock[]; sweep_found: number | null }

/** One read of ~10 crawl_state rows. */
export async function crawlClock(db: D1Database, at = Math.floor(Date.now() / 1000)): Promise<CrawlClock> {
  const keys = [...JOBS.flatMap((j) => [`${j}:cron`, `${j}:last_run`, `${j}:manual`]), "sweep:last_found"];
  const rows = await db.prepare(`SELECT key, value FROM crawl_state WHERE key IN (${keys.map(() => "?").join(",")})`).bind(...keys).all<{ key: string; value: string }>();
  const st = new Map((rows.results ?? []).map((r) => [r.key, r.value]));
  const jobs = JOBS.map((job): JobClock => {
    const cron = st.get(`${job}:cron`) ?? null;
    const last = st.get(`${job}:last_run`);
    return {
      job, ...JOB_INFO[job], cron,
      every: cron ? everySeconds(cron) : null,
      last_run: last ? Number(last) : null,
      next_run: cron ? nextFire(cron, at) : null,
      manual: parseManual(st.get(`${job}:manual`)),
    };
  });
  const found = st.get("sweep:last_found");
  return { now: at, jobs, sweep_found: found == null ? null : Number(found) };
}

export function parseManual(v: string | undefined | null): { at: number; by: string } | null {
  if (!v) return null;
  const [at, by] = v.split("|");
  return Number(at) ? { at: Number(at), by: by ?? "" } : null;
}

/** "in 7 min" / "in 40s" / "due now", server-side; the page script ticks it down per second. */
export function untilText(secs: number): string {
  if (secs <= 0) return "due now";
  if (secs < 60) return `in ${secs}s`;
  const m = Math.ceil(secs / 60);
  return m < 120 ? `in ${m} min` : `in ${Math.round(m / 60)} h`;
}

export function everyText(cron: string): string {
  const every = everySeconds(cron);
  return every ? `every ${every / 60} min` : `cron ${cron}`;
}
