// Scan pipeline. Phase 1 implements gates 1 (metadata) and 2 (contract) so /ping produces real listings;
// gates 0 (denylist), 2b (risk), 3 (content/AI) are added in phases 3–4. Every gate result is public.
import { GitHub, parseGhDate, type GhRepo } from "./github";
import { parseSlopMd, type TagRow } from "./slopmd";
import { replaceTags, type RepoRow } from "./db";
import { renderMarkdown } from "./markdown";
import { normalizeValue } from "./vocab";
import { now } from "./time";

export type Policy = "denylist" | "metadata" | "contract" | "risk" | "content" | "owner-request" | "admin";

export interface GateResult { gate: Policy; ok: boolean; reasons: string[]; notes?: string[] }
export interface ScanReport {
  at: number;
  gates: GateResult[];
  /** The policy that rejected/quarantined the repo, if any. */
  policy?: Policy;
  warnings: string[];
}

export const POLICY_LABELS: Record<Policy, string> = {
  denylist: "Prohibited terms or links",
  metadata: "Repository eligibility",
  contract: "slopscore.md paperwork",
  risk: "Risk review",
  content: "Content policy",
  "owner-request": "Owner request",
  admin: "Moderator action",
};

export interface ScanOutcome {
  status: RepoRow["status"];
  report: ScanReport;
  reject_reason: string | null;
}

/**
 * Quick scan used by /ping and owner refresh: fetch repo metadata + raw slopscore.md, run gates 1–2, upsert the row.
 * Returns the row after the update. Later phases extend this with gates 0, 2b, 3 without changing the shape.
 */
export async function scanRepo(db: D1Database, gh: GitHub, owner: string, name: string, opts: { byOwner?: boolean } = {}): Promise<{ repo: RepoRow | null; outcome: ScanOutcome | { status: "missing"; error: string } }> {
  const report: ScanReport = { at: now(), gates: [], warnings: [] };
  const metaRes = await gh.repo(owner, name);
  if (metaRes.status !== 200) {
    if (metaRes.status === 404 || metaRes.status === 451 || metaRes.status === 403) {
      // Known to us? Delist it. Unknown? Just report.
      const existing = await db.prepare("SELECT * FROM repos WHERE lower(full_name) = lower(?)").bind(`${owner}/${name}`).first<RepoRow>();
      if (existing && existing.status !== "delisted") {
        const reason = metaRes.status === 451 ? "dmca" : "blocked" in metaRes && metaRes.blocked ? "tos-block" : "404";
        await db.prepare("UPDATE repos SET status = 'delisted', removed_at = unixepoch(), removed_reason = ?, last_crawled = unixepoch() WHERE id = ?").bind(reason, existing.id).run();
        return { repo: { ...existing, status: "delisted", removed_reason: reason }, outcome: { status: "missing", error: `GitHub returned ${metaRes.status}` } };
      }
    }
    return { repo: null, outcome: { status: "missing", error: `GitHub returned ${metaRes.status}: ${"error" in metaRes ? metaRes.error : ""}` } };
  }
  const g = metaRes.data as GhRepo;
  const raw = await gh.rawFile(g.owner.login, g.name, g.default_branch, "slopscore.md");
  if (raw.status !== 200) {
    const existing = await db.prepare("SELECT * FROM repos WHERE id = ?").bind(g.id).first<RepoRow>();
    if (existing && existing.status !== "delisted") {
      await db.prepare("UPDATE repos SET status = 'delisted', removed_at = unixepoch(), removed_reason = 'marker-removed', last_crawled = unixepoch() WHERE id = ?").bind(g.id).run();
      return { repo: { ...existing, status: "delisted" }, outcome: { status: "missing", error: "slopscore.md not found on the default branch" } };
    }
    return { repo: null, outcome: { status: "missing", error: `no slopscore.md on ${g.default_branch} (raw fetch returned ${raw.status})` } };
  }

  // Gate 1: metadata
  const meta = metadataGate(g);
  report.gates.push(meta);

  // Gate 2: contract
  const parsed = parseSlopMd(raw.text!);
  report.gates.push({ gate: "contract", ok: parsed.ok, reasons: parsed.errors, notes: parsed.warnings });
  report.warnings.push(...parsed.warnings);

  const failing = report.gates.find((x) => !x.ok);
  const status = (failing ? "rejected" : "listed") as RepoRow["status"];
  report.policy = failing?.gate;
  const rejectReason = failing ? `${POLICY_LABELS[failing.gate]}: ${failing.reasons.join("; ")}` : null;

  const tagline = parsed.meta?.tagline || g.description || null;
  if (status === "listed" && !tagline) {
    report.gates[1] = { gate: "contract", ok: false, reasons: ["no tagline: set `tagline:` in slopscore.md or a description on GitHub"], notes: parsed.warnings };
    report.policy = "contract";
  }
  const finalFailing = report.gates.find((x) => !x.ok);
  const finalStatus = (finalFailing ? "rejected" : "listed") as RepoRow["status"];
  const finalReason = finalFailing ? `${POLICY_LABELS[finalFailing.gate]}: ${finalFailing.reasons.join("; ")}` : null;

  const md_sha = await sha1(raw.text!);
  const title = parsed.meta?.title || g.name;
  const bodyHtml = parsed.body ? renderMarkdown(parsed.body, { owner: g.owner.login, repo: g.name, branch: g.default_branch }) : null;
  const ghSnapshot = {
    description: g.description, homepage: g.homepage, topics: g.topics ?? [], watchers: g.watchers_count,
    open_issues: g.open_issues_count, size: g.size, is_template: g.is_template ?? false, parent: g.parent?.full_name ?? null,
    owner_avatar: g.owner.avatar_url,
  };

  const existing = await db.prepare("SELECT * FROM repos WHERE id = ? OR lower(full_name) = lower(?)").bind(g.id, g.full_name).first<RepoRow>();
  const mdChanged = !existing || existing.md_sha !== md_sha;
  const t = now();
  // Delisted-by-owner repos stay delisted unless the owner refreshes; a rejected/discovered/listed row is re-evaluated.
  let nextStatus: RepoRow["status"] = finalStatus;
  if (existing?.status === "delisted" && existing.removed_reason === "owner-request" && !opts.byOwner) nextStatus = "delisted";
  if (existing?.status === "hidden") nextStatus = "hidden";
  if (parsed.meta?.unlisted) nextStatus = "delisted";

  const listedAt = nextStatus === "listed" ? (existing?.listed_at ?? t) : existing?.listed_at ?? null;
  const removed = nextStatus === "delisted" ? { at: existing?.removed_at ?? t, reason: parsed.meta?.unlisted ? "owner-request" : existing?.removed_reason ?? null } : { at: null, reason: null };

  await db.prepare(
    `INSERT INTO repos (id, full_name, owner, name, owner_id, owner_type, default_branch, title, tagline, demo_url, stars, forks, language, license,
       pushed_at, gh_created_at, is_fork, archived, gh, etag_repo, md_sha, md_updated_at, meta, body_md, body_html, status, queue_reason, reject_reason, scan,
       listed_at, last_crawled, next_crawl, removed_at, removed_reason)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       full_name = excluded.full_name, owner = excluded.owner, name = excluded.name, owner_id = excluded.owner_id, owner_type = excluded.owner_type,
       default_branch = excluded.default_branch, title = excluded.title, tagline = excluded.tagline, demo_url = excluded.demo_url,
       stars = excluded.stars, forks = excluded.forks, language = excluded.language, license = excluded.license, pushed_at = excluded.pushed_at,
       gh_created_at = excluded.gh_created_at, is_fork = excluded.is_fork, archived = excluded.archived, gh = excluded.gh, etag_repo = excluded.etag_repo,
       md_sha = excluded.md_sha, md_updated_at = CASE WHEN repos.md_sha IS excluded.md_sha THEN repos.md_updated_at ELSE excluded.md_updated_at END,
       meta = excluded.meta, body_md = excluded.body_md, body_html = excluded.body_html, status = excluded.status, queue_reason = NULL,
       reject_reason = excluded.reject_reason, scan = excluded.scan, listed_at = excluded.listed_at, last_crawled = excluded.last_crawled,
       next_crawl = excluded.next_crawl, removed_at = excluded.removed_at, removed_reason = excluded.removed_reason`,
  ).bind(
    g.id, g.full_name, g.owner.login, g.name, g.owner.id, g.owner.type, g.default_branch, title, tagline, parsed.meta?.demo_url || g.homepage || null,
    g.stargazers_count, g.forks_count, g.language, g.license?.spdx_id ?? null, parseGhDate(g.pushed_at), parseGhDate(g.created_at),
    g.fork ? 1 : 0, g.archived ? 1 : 0, JSON.stringify(ghSnapshot), metaRes.etag, md_sha, t,
    parsed.meta ? JSON.stringify(parsed.meta) : null, parsed.body || null, bodyHtml, nextStatus, null, finalReason, JSON.stringify(report),
    listedAt, t, t + 3600, removed.at, removed.reason,
  ).run();

  const tags: TagRow[] = [...parsed.tags];
  if (g.language) tags.push({ facet: "language", value: normalizeValue(g.language), source: "detected", recognized: true });
  for (const topic of g.topics ?? []) tags.push({ facet: "topic", value: normalizeValue(topic), source: "detected", recognized: true });
  if (g.license?.spdx_id && g.license.spdx_id !== "NOASSERTION") tags.push({ facet: "license", value: normalizeValue(g.license.spdx_id), source: "detected", recognized: true });
  await replaceTags(db, g.id, tags);

  if (mdChanged) {
    await db.prepare("INSERT INTO repo_versions (repo_id, md_sha, meta, body_md, stars) VALUES (?,?,?,?,?)")
      .bind(g.id, md_sha, parsed.meta ? JSON.stringify(parsed.meta) : null, parsed.body || null, g.stargazers_count).run();
  }

  const repo = await db.prepare("SELECT * FROM repos WHERE id = ?").bind(g.id).first<RepoRow>();
  return { repo, outcome: { status: nextStatus, report, reject_reason: finalReason } };
}

export function metadataGate(g: GhRepo): GateResult {
  const reasons: string[] = [];
  const notes: string[] = [];
  if (g.private) reasons.push("repository is private");
  if (g.archived) reasons.push("repository is archived");
  if (g.disabled) reasons.push("repository was disabled by GitHub");
  if (g.size === 0) reasons.push("repository is empty");
  if (g.fork) {
    if (!g.parent || g.stargazers_count <= (g.parent?.stargazers_count ?? 0)) reasons.push("forks are only listed when they out-star their parent");
    else notes.push("fork that out-stars its parent");
  }
  if (g.is_template) notes.push("template repository");
  return { gate: "metadata", ok: reasons.length === 0, reasons, notes };
}

async function sha1(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
