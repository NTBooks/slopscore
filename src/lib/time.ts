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
