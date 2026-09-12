// Feature flags: moderation gates and which feed sorts are on offer. One var, MOD_FLAGS, a comma list of
// what's ON. Default: everything.
// Flip one off without a redeploy of code: change the var in wrangler.jsonc (or the dashboard) and deploy.
//   weight  votes carry a trust weight from GitHub signals (off = every vote weighs 1)
//   ring    vote-ring heuristic zeroes bursts from same-week accounts / one network
//   burst   votes per hour capped by visitors (weight 0 beyond the allowance)
//   crowd   anonymous "crowd" votes accepted and shown (off = 401, log in)
//   fuzz    displayed scores above 20 fuzzed ±2 %
//   guard   comments pass through Llama Guard and can be held
//   risk    risk score can quarantine (off = risk is recorded but never quarantines)
// The last four name a feed sort each: rising, controversial, updated, upcoming. Off = that sort is gone —
// no tab, no chip, no /upcoming page, and ?sort=/the API fall back to hot. The rows and the ranking maths
// stay put; only the view is withdrawn.
export const ALL_FLAGS = ["weight", "ring", "burst", "crowd", "fuzz", "guard", "risk", "rising", "controversial", "updated", "upcoming"] as const;
export type Flag = (typeof ALL_FLAGS)[number];

let current: Set<Flag> = new Set(ALL_FLAGS);

/** Parse "weight,ring,-burst" style lists: names turn on, a leading - turns off, "all"/"none" reset. */
export function parseFlags(spec: string | undefined): Set<Flag> {
  if (spec == null || !spec.trim()) return new Set(ALL_FLAGS);
  const on = new Set<Flag>();
  const parts = spec.split(/[,\s]+/).map((p) => p.trim().toLowerCase()).filter(Boolean);
  const explicitList = parts.some((p) => !p.startsWith("-") && p !== "all" && p !== "none");
  if (!explicitList) ALL_FLAGS.forEach((f) => on.add(f));   // only negations → start from all
  for (const p of parts) {
    if (p === "all") { ALL_FLAGS.forEach((f) => on.add(f)); continue; }
    if (p === "none") { on.clear(); continue; }
    const neg = p.startsWith("-");
    const name = (neg ? p.slice(1) : p) as Flag;
    if (!(ALL_FLAGS as readonly string[]).includes(name)) continue;
    if (neg) on.delete(name); else on.add(name);
  }
  return on;
}

/** Called once per request from the middleware; env vars are deployment constants, so caching is safe. */
export function setFlags(spec: string | undefined): void {
  current = parseFlags(spec);
}

export function flagOn(f: Flag): boolean {
  return current.has(f);
}

export function flagsSnapshot(): Record<Flag, boolean> {
  return Object.fromEntries(ALL_FLAGS.map((f) => [f, current.has(f)])) as Record<Flag, boolean>;
}
