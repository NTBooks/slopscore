// The words on the README badge (routes/pages.tsx draws it).
const AWARD_NAME: Record<string, string> = { day: "slop of the day", week: "slop of the week", "upcoming-week": "most promising" };

/** What the badge says. Never a zero or a negative: "certified slop · 0" on somebody's README reads as a bad
 *  review, and it is what an owner saw for three days before taking their winning listing down. */
export function badgeValue(r: { status: string; score: number } | null, award: { kind: string; period: string; rank: number } | null): string {
  if (!r) return "not listed";
  if (r.status !== "listed") return r.status;
  if (award) return `#${award.rank} ${AWARD_NAME[award.kind] ?? award.kind} · ${award.period}`;
  return r.score > 0 ? `certified slop · ${r.score}` : "certified slop";
}
