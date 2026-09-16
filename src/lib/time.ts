export const now = () => Math.floor(Date.now() / 1000);

export function ago(ts: number | null | undefined, from = now()): string {
  if (!ts) return "sometime";
  const d = Math.max(0, from - ts);
  if (d < 60) return "just now";
  const units: [number, string][] = [[31536000, "year"], [2592000, "month"], [604800, "week"], [86400, "day"], [3600, "hour"], [60, "minute"]];
  for (const [secs, name] of units) {
    if (d >= secs) { const n = Math.floor(d / secs); return `${n} ${name}${n === 1 ? "" : "s"} ago`; }
  }
  return "just now";
}

export function isoDate(ts: number | null | undefined): string {
  return ts ? new Date(ts * 1000).toISOString().slice(0, 10) : "";
}

export function isoDateTime(ts: number | null | undefined): string {
  return ts ? new Date(ts * 1000).toISOString().replace(".000Z", "Z") : "";
}

export const SORT_WINDOWS: Record<string, number> = {
  hour: 3600, day: 86400, week: 604800, month: 2592000, year: 31536000, all: 0,
};

/** ISO-8601 week, `YYYY-Www`. A week owns the bulletin and the weekly series; the day a job ran does not. */
export function isoWeek(at: number): string {
  const d = new Date(at * 1000);
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const dow = (new Date(day).getUTCDay() + 6) % 7;            // Monday = 0
  const thursday = day + (3 - dow) * 86400000;                // the week's Thursday names its year
  const year = new Date(thursday).getUTCFullYear();
  const jan4 = Date.UTC(year, 0, 4);
  const week1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * 86400000;
  return `${year}-W${String(Math.round((thursday - week1) / (7 * 86400000)) + 1).padStart(2, "0")}`;
}

/** The Monday an ISO week starts on, as a unix timestamp at 00:00 UTC. Null for anything that is not `YYYY-Www`. */
export function weekStart(slug: string): number | null {
  const m = /^(\d{4})-W(\d{2})$/.exec(slug);
  if (!m) return null;
  const year = Number(m[1]);
  const jan4 = Date.UTC(year, 0, 4);
  const week1 = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * 86400000;
  return Math.floor((week1 + (Number(m[2]) - 1) * 7 * 86400000) / 1000);
}
