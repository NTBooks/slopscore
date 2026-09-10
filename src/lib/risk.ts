// Gate 2b: risk score from free signals. >= RISK_QUARANTINE => quarantined for a human.
import type { GhRepo, GhContentsEntry } from "./github";
import { now } from "./time";

const DAY = 86400;
const BINARY_EXT = /\.(exe|msi|dmg|pkg|apk|ipa|scr|bat|cmd|ps1|jar|bin|so|dll|dylib)$/i;

export interface RiskInput {
  repo: GhRepo;
  ownerCreatedAt: number | null;   // unix, from the owner user record when known
  ownerFollowers: number | null;
  ownerPublicRepos: number | null;
  commitCount: number | null;
  languages: Record<string, number> | null;
  contents: GhContentsEntry[] | null;
  readmeChars: number;
  denyFlags: string[];
  title: string;
  writeEligible: boolean;          // account passes the site's write threshold
  contentFlags: string[];          // soft flags from gate 3 (e.g. undisclosed specialized advice)
}

export function riskScore(i: RiskInput): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  const add = (n: number, why: string) => { score += n; reasons.push(`+${n} ${why}`); };
  const t = now();
  if (i.ownerCreatedAt != null && t - i.ownerCreatedAt < 30 * DAY) add(20, "owner account < 30 days old");
  if (i.ownerFollowers === 0) add(10, "owner has 0 followers");
  if (i.ownerPublicRepos != null && i.ownerPublicRepos <= 1) add(10, "owner has no other public repos");
  if (i.commitCount != null && i.commitCount <= 1) add(10, "single commit");
  if (i.languages && Object.keys(i.languages).length === 0) add(15, "no detected language (no code?)");
  const binaries = (i.contents ?? []).filter((e) => e.type === "file" && BINARY_EXT.test(e.name));
  if (binaries.length) add(25, `binaries at repo root (${binaries.slice(0, 3).map((b) => b.name).join(", ")})`);
  if (i.readmeChars < 200) add(10, "README under 200 chars");
  if (i.denyFlags.some((f) => /prohibited term|spam|crypto bait|chat invite/.test(f))) add(20, "denylist flags");
  if (i.denyFlags.some((f) => /invisible unicode|mixed-script/.test(f))) add(20, "suspicious title encoding");
  const ageDays = Math.max(1, (t - (Date.parse(i.repo.created_at) / 1000)) / DAY);
  if (i.repo.stargazers_count > 50 && i.repo.stargazers_count / ageDays > 100) add(15, "stars implausible for repo age");
  if (i.contentFlags.length) add(15, "content flags: " + i.contentFlags.join(", "));
  if (!i.writeEligible) add(40, "owner below the site's write threshold (always reviewed by a human)");
  return { score: Math.min(100, score), reasons };
}
