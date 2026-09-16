// When each job last ran, when it runs next, and whether it is working.
//
// A Worker can't read its own cron triggers, so runCron records the expression that drove each tick; the
// next fire time then comes from the schedule that is actually deployed (production runs sweep every 15
// minutes, test runs one combined 30-minute tick, local dev runs none).
//
// The health half exists because "did that job run, and did it work?" used to be unanswerable from aboard.
// A job that had never run, one that ran clean, and one that died mid-invocation all looked identical: the
// only trace was a console.log nobody reads. Three keys per job fix that, and the important one is
// `last_ok` rather than `last_fail` -- an invocation the runtime kills throws nothing, so a job that stops
// reporting success is the signal that catches what a try/catch cannot.

import { flagOn } from "./flags";

/** The crawler jobs. Manually runnable from the mod console, so this list also drives the "run now" buttons. */
export const JOBS = ["sweep", "scan", "recrawl"] as const;
/** The 00:05 UTC tick. Watched the same way, but with no button: they are cheap to wait for and dear to spam. */
export const DAILY_JOBS = ["awards", "trawl", "critics", "trends", "tripwire", "report"] as const;

export type Job = (typeof JOBS)[number];
export type DailyJob = (typeof DAILY_JOBS)[number];
export type AnyJob = Job | DailyJob;

export const ALL_JOBS: readonly AnyJob[] = [...JOBS, ...DAILY_JOBS];

export const JOB_INFO: Record<AnyJob, { label: string; does: string }> = {
  sweep: { label: "next sweep", does: "searches GitHub for new slopscore.md files" },
  scan: { label: "next scan tick", does: "inspects the front of the line" },
  recrawl: { label: "next recrawl", does: "re-checks listed repos for pushes" },
  awards: { label: "next awards", does: "picks the day's truffles" },
  trawl: { label: "next trawl release", does: "moves backlog picks into the queue" },
  critics: { label: "next critics turn", does: "one of the cast reads a listing or two and votes" },
  trends: { label: "next trends count", does: "counts the corpus for /trends" },
  tripwire: { label: "next tripwire sweep", does: "expires blocks and prunes the probe counters" },
  // Checked nightly, writes weekly: on six nights in seven it reads one row and declines. A job that runs
  // and does nothing is still a job that ran, so it is watched like the rest rather than left unaccounted for.
  report: { label: "next report check", does: "writes the weekly Trawl Report when a week is owed one" },
};

/** Which jobs each cron drives. Mirrors the switch in runCron (src/index.ts). */
export const CRON_JOBS: Record<string, AnyJob[]> = {
  "*/15 * * * *": ["sweep"],
  "*/5 * * * *": ["scan"],
  "*/10 * * * *": ["recrawl"],
  "5 0 * * *": [...DAILY_JOBS],
  // The test environment's combined tick. It only runs the daily jobs in the 00:00 half-hour, so claiming
  // a 30-minute schedule for them here would draw a countdown that is wrong 47 times a day.
  "*/30 * * * *": ["sweep", "scan", "recrawl"],
};

/**
 * The jobs this tick actually drives.
 *
 * Almost always just CRON_JOBS, but the critics are the exception: with `frenzy` on they take a turn
 * every sweep tick instead of once in the daily round, so which cron owns them is a runtime question.
 * It has to be answered here rather than left as a constant, because this is what writes `critics:cron`
 * — and that is what the countdown on /queue prints and what healthOf calls the job late against. Get it
 * wrong and the page says "once a day" about something running every quarter of an hour.
 */
export function cronJobs(cron: string): AnyJob[] {
  const base = CRON_JOBS[cron];
  if (!base) return [];
  // Switched off, the critics belong to no cron at all: claiming one would have the clock call them late.
  if (!flagOn("critics")) return base.filter((j) => j !== "critics");
  if (!flagOn("frenzy")) return base;
  if (cron === "*/15 * * * *" || cron === "*/30 * * * *") return [...base, "critics"];
  return base.filter((j) => j !== "critics");
}

/** Seconds a mod must wait between manual runs of the same job (GitHub code search allows ~30 calls a minute). */
export const MANUAL_COOLDOWN = 60;

/** Grace on top of one interval before a job is called late: a tick can be a minute or two behind itself. */
const LATE_GRACE = 300;

/** Record the schedule behind this tick. The WHERE makes an unchanged value a zero-row write. */
export async function recordCron(db: D1Database, cron: string): Promise<void> {
  const jobs = cronJobs(cron);
  if (!jobs.length) return;
  await db.batch(jobs.map((j) =>
    db.prepare("INSERT INTO crawl_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value WHERE value != excluded.value").bind(`${j}:cron`, cron),
  ));
}

const set = (db: D1Database, key: string, value: string): D1PreparedStatement =>
  db.prepare("INSERT INTO crawl_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value);
const del = (db: D1Database, key: string): D1PreparedStatement =>
  db.prepare("DELETE FROM crawl_state WHERE key = ?").bind(key);

/**
 * The heartbeat, written by runCron around every job.
 *
 * Success moves `last_ok` and forgets the previous failure, so a job that recovers stops shouting. A failure
 * is kept as `ts|message` and leaves `last_ok` where it was, which is what makes "failing since" readable.
 */
export async function noteRun(db: D1Database, job: AnyJob, at: number, ms: number, error?: string): Promise<void> {
  await db.batch(
    error
      ? [set(db, `${job}:last_fail`, `${at}|${String(error).replace(/\s+/g, " ").slice(0, 300)}`), set(db, `${job}:ms`, String(ms))]
      : [set(db, `${job}:last_ok`, String(at)), set(db, `${job}:ms`, String(ms)), del(db, `${job}:last_fail`)],
  );
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

/**
 * How long a job should go between runs, for the late check alone.
 *
 * `everySeconds` answers only for the `*\/N` shape, because a countdown that rolls over needs that shape.
 * Staleness is a looser question: a fixed daily time is a day, whatever its minute and hour happen to be.
 */
export function intervalOf(cron: string): number | null {
  const every = everySeconds(cron);
  if (every) return every;
  const [min, hour, ...rest] = cron.trim().split(/\s+/);
  const fixed = (f: string | undefined) => /^\d+$/.test(f ?? "");
  return fixed(min) && fixed(hour) && rest.every((f) => f === "*") ? 86400 : null;
}

export type Health = "ok" | "failing" | "late" | "never" | "unreported" | "unknown";

export const HEALTH_LABEL: Record<Health, string> = {
  ok: "running",
  failing: "failing",
  late: "overdue",
  never: "not run yet",
  unreported: "ran before this deploy",
  unknown: "no schedule on this deploy",
};

/**
 * One job's state, from its own three keys. Pure, so the rules are unit-testable.
 *
 * "never" is deliberately not a fault. A job whose feature shipped after the last tick has simply not had
 * its turn yet, and reading that as a failure is how a healthy site gets mistaken for a broken one.
 * Neither is "unreported", which is the same story one deploy earlier.
 */
export function healthOf(j: Pick<JobClock, "cron" | "last_ok" | "last_fail" | "last_run">, at: number): Health {
  if (!j.cron) return "unknown";
  if (j.last_fail && (!j.last_ok || j.last_fail.at > j.last_ok)) return "failing";
  // A job with a run behind it but no verdict ran under code that kept no heartbeat. Saying "not run yet"
  // next to "last ran an hour ago" is a straight contradiction, and it clears itself on the next tick.
  if (!j.last_ok) return j.last_run ? "unreported" : "never";
  const interval = intervalOf(j.cron);
  if (interval && at - j.last_ok > interval + LATE_GRACE) return "late";
  return "ok";
}

export interface JobClock {
  job: AnyJob;
  label: string;
  does: string;
  cron: string | null;
  every: number | null;
  last_run: number | null;
  next_run: number | null;
  manual: { at: number; by: string } | null;
  last_ok: number | null;
  last_fail: { at: number; why: string } | null;
  ms: number | null;
  health: Health;
}

export interface CrawlClock {
  now: number;
  /** The crawler jobs, for the timer box on /queue. Unchanged shape: that box renders these and only these. */
  jobs: JobClock[];
  /** The 00:05 tick's jobs: watched, but without buttons. */
  daily: JobClock[];
  sweep_found: number | null;
  /** Jobs that want a human. Empty is the normal answer, and the page says so rather than showing nothing. */
  ailing: JobClock[];
}

/** One read of the crawl_state rows behind every job. */
export async function crawlClock(db: D1Database, at = Math.floor(Date.now() / 1000)): Promise<CrawlClock> {
  const keys = [
    ...ALL_JOBS.flatMap((j) => [`${j}:cron`, `${j}:last_run`, `${j}:manual`, `${j}:last_ok`, `${j}:last_fail`, `${j}:ms`]),
    "sweep:last_found",
  ];
  const rows = await db.prepare(`SELECT key, value FROM crawl_state WHERE key IN (${keys.map(() => "?").join(",")})`).bind(...keys).all<{ key: string; value: string }>();
  const st = new Map((rows.results ?? []).map((r) => [r.key, r.value]));
  const build = (job: AnyJob): JobClock => {
    const cron = st.get(`${job}:cron`) ?? null;
    const last = st.get(`${job}:last_run`);
    const ok = st.get(`${job}:last_ok`);
    const ms = st.get(`${job}:ms`);
    const base = {
      job, ...JOB_INFO[job], cron,
      every: cron ? everySeconds(cron) : null,
      last_run: last ? Number(last) : null,
      next_run: cron ? nextFire(cron, at) : null,
      manual: parseManual(st.get(`${job}:manual`)),
      last_ok: ok ? Number(ok) : null,
      last_fail: parseFail(st.get(`${job}:last_fail`)),
      ms: ms ? Number(ms) : null,
    };
    return { ...base, health: healthOf(base, at) };
  };
  const jobs = JOBS.map(build);
  const daily = DAILY_JOBS.map(build);
  const found = st.get("sweep:last_found");
  return {
    now: at,
    jobs,
    daily,
    sweep_found: found == null ? null : Number(found),
    ailing: [...jobs, ...daily].filter((j) => j.health === "failing" || j.health === "late"),
  };
}

export function parseManual(v: string | undefined | null): { at: number; by: string } | null {
  if (!v) return null;
  const [at, by] = v.split("|");
  return Number(at) ? { at: Number(at), by: by ?? "" } : null;
}

/** `ts|message`. Anything that is not that describes no failure we can name, so it is none. */
export function parseFail(v: string | undefined | null): { at: number; why: string } | null {
  if (!v) return null;
  const i = v.indexOf("|");
  const at = Number(i < 0 ? v : v.slice(0, i));
  return at ? { at, why: i < 0 ? "" : v.slice(i + 1) } : null;
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
  if (every) return `every ${every / 60} min`;
  return intervalOf(cron) === 86400 ? "once a day" : `cron ${cron}`;
}
