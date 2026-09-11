// The scan pipeline. Every gate result is stored in repos.scan (JSON) and rendered publicly on the repo page.
// Order: fetch GitHub → gate 0 denylist → gate 1 metadata → gate 2 contract → gate 3 content (budgeted AI) → gate 2b risk → status.
import { GitHub, parseGhDate, fullNameFromRedirect, type GhRepo, type GhContentsEntry, type GhRelease, type GhCommunity, type GhUser } from "./github";
import { parseSlopMd, type TagRow, type SlopMeta } from "./slopmd";
import { replaceTags, registerBuckets, type RepoRow } from "./db";
import { renderMarkdown, sanitizeReadmeHtml, stripHtml } from "./markdown";
import { normalizeValue } from "./vocab";
import { now } from "./time";
import { denylistGate, loadDenyRows } from "./denylist";
import { riskScore } from "./risk";
import { findSecrets, safeBrowsing, llamaGuard, llamaGuardOpenRouter, judgeGuard, visionCheck, visionCheckOpenRouter, budgetAllows, spendNeurons, estimateGuardNeurons, VISION_NEURONS, VISION_HARD } from "./content";
import { bump } from "../jobs/stats";
import { vulnerableDeps, type VulnSummary } from "./osv";
import type { Env } from "../env";

export type Policy = "denylist" | "metadata" | "contract" | "risk" | "content" | "owner-request" | "admin";

export interface GateResult { gate: Policy; ok: boolean; reasons: string[]; notes?: string[] }
export interface ScanReport {
  at: number;
  gates: GateResult[];
  policy?: Policy;
  warnings: string[];
  risk?: { score: number; reasons: string[] };
  images?: { path: string; size: number; checked: string }[];
  ai?: { guard?: { ran: boolean; categories: string[]; neurons: number; error?: string; provider?: string }; vision?: { ran: boolean; safe: boolean; note?: string; neurons: number; provider?: string }; deferred?: boolean; provider?: string };
  links?: number;
  calls?: number;
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

export type ScanOutcome =
  | { status: RepoRow["status"]; report: ScanReport; reject_reason: string | null; deferred?: boolean }
  | { status: "missing"; error: string };

const IMAGE_RE = /^slop(score)?[-_]?([1-9])\.(png|jpe?g|gif|webp)$/i;
const MAX_IMAGE = 3_000_000;

export interface ScanOptions {
  byOwner?: boolean;
  /** Skip the AI budget check (paid plan / rushed scan when PLAN_MODE=paid). */
  ignoreBudget?: boolean;
  /** A paid scan: AI checks go to OpenRouter when a key is set (no neurons), and the budget is ignored. */
  paid?: boolean;
  /** An admin-triggered rescan may lift an admin lock. */
  byAdmin?: boolean;
}

export async function scanRepo(db: D1Database, env: Env, gh: GitHub, owner: string, name: string, opts: ScanOptions = {}): Promise<{ repo: RepoRow | null; outcome: ScanOutcome }> {
  const report: ScanReport = { at: now(), gates: [], warnings: [] };
  const existingByName = await db.prepare("SELECT * FROM repos WHERE lower(full_name) = lower(?)").bind(`${owner}/${name}`).first<RepoRow>();

  // ---- 1. repository metadata (follow one rename) ----
  let metaRes = await gh.repo(owner, name);
  if (metaRes.status >= 300 && metaRes.status < 400 && "redirect" in metaRes) {
    const moved = fullNameFromRedirect(metaRes.redirect);
    if (moved) { const [o2, n2] = moved.split("/"); metaRes = await gh.repo(o2, n2); }
  }
  if (metaRes.status !== 200) {
    if (metaRes.status === 404 || metaRes.status === 451 || metaRes.status === 403 || metaRes.status === 410) {
      if (existingByName && existingByName.status !== "delisted") {
        const reason = metaRes.status === 451 ? "dmca" : ("blocked" in metaRes && metaRes.blocked) ? "tos-block" : "404";
        await delist(db, existingByName.id, reason);
        return { repo: { ...existingByName, status: "delisted", removed_reason: reason }, outcome: { status: "missing", error: `GitHub returned ${metaRes.status}` } };
      }
    }
    return { repo: null, outcome: { status: "missing", error: `GitHub returned ${metaRes.status}: ${"error" in metaRes ? metaRes.error : ""}` } };
  }
  const g = metaRes.data as GhRepo;
  const existing = (await db.prepare("SELECT * FROM repos WHERE id = ?").bind(g.id).first<RepoRow>()) ?? existingByName;

  // ---- 2. the marker file ----
  const raw = await gh.rawFile(g.owner.login, g.name, g.default_branch, "slopscore.md");
  if (raw.status !== 200 || !raw.text) {
    if (existing && existing.status !== "delisted") {
      await delist(db, existing.id, "marker-removed");
      return { repo: { ...existing, status: "delisted", removed_reason: "marker-removed" }, outcome: { status: "missing", error: "slopscore.md not found on the default branch" } };
    }
    return { repo: null, outcome: { status: "missing", error: `no slopscore.md on ${g.default_branch} (raw fetch returned ${raw.status})` } };
  }
  const md_sha = await sha1(raw.text);
  const mdChanged = !existing || existing.md_sha !== md_sha;

  // ---- 3. everything else GitHub knows (parallel, ETag where we have one) ----
  const [langs, readme, contents, release, community, contributors, ownerUser, commitsRes, denyRows] = await Promise.all([
    gh.languages(g.owner.login, g.name),
    gh.readmeHtml(g.owner.login, g.name, existing?.etag_readme),
    gh.contents(g.owner.login, g.name, existing?.etag_contents),
    gh.latestRelease(g.owner.login, g.name),
    gh.community(g.owner.login, g.name),
    gh.contributorsCount(g.owner.login, g.name),
    gh.get<GhUser>(`/users/${g.owner.login}`),
    gh.get<unknown[]>(`/repos/${g.owner.login}/${g.name}/commits?per_page=1`),
    loadDenyRows(db),
  ]);
  const languages = langs.status === 200 ? langs.data : null;
  const readmeRaw = readme.status === 200 ? readme.data : readme.status === 304 ? existing?.readme_html ?? null : null;
  const readmeHtml = readmeRaw ? sanitizeReadmeHtml(readmeRaw, { owner: g.owner.login, repo: g.name, branch: g.default_branch }).slice(0, 50_000) : null;
  const readmeText = readmeHtml ? stripHtml(readmeHtml) : "";
  const contentsList: GhContentsEntry[] | null = contents.status === 200 ? contents.data : null;
  const rel: GhRelease | null = release.status === 200 ? release.data : null;
  const comm: GhCommunity | null = community.status === 200 ? community.data : null;
  const ownerInfo = ownerUser.status === 200 ? ownerUser.data : null;
  const commitCount = commitsRes.status === 200 && "headers" in commitsRes && commitsRes.data ? linkLast(commitsRes.headers.get("link")) ?? commitsRes.data.length : null;

  // ---- gate 2: contract (parse first; gate 0 needs the tags) ----
  const parsed = parseSlopMd(raw.text);
  const meta = parsed.meta;
  const contractGate: GateResult = { gate: "contract", ok: parsed.ok, reasons: [...parsed.errors], notes: parsed.warnings };
  const tagline = meta?.tagline || g.description || null;
  if (parsed.ok && !tagline) { contractGate.ok = false; contractGate.reasons.push("no tagline: set `tagline:` in slopscore.md or a description on GitHub"); }
  report.warnings.push(...parsed.warnings);

  // ---- gate 0: denylist + links ----
  const title = meta?.title || g.name;
  const shortText = [title, tagline ?? "", g.owner.login, ...(meta?.tags ?? []), ...(meta?.category ?? []), ...(meta?.domain ?? [])].join(" \n ");
  const longText = `${parsed.body}\n${readmeText}`;
  const deny = denylistGate(shortText, longText, denyRows);
  report.gates.push({ gate: "denylist", ok: deny.reject.length === 0, reasons: deny.reject, notes: deny.flags });
  report.links = deny.links.length;

  // ---- gate 1: metadata ----
  report.gates.push(metadataGate(g));
  report.gates.push(contractGate);

  // ---- images: explicit list or auto-discovered slopscore-N.* at the root ----
  const images: { path: string; size: number; checked: string }[] = [];
  if (meta?.images?.length) {
    for (const p of meta.images.slice(0, 6)) {
      if (/\.svg$/i.test(p)) { report.warnings.push(`image ${p} skipped (SVG)`); continue; }
      const entry = contentsList?.find((e) => e.path === p);
      if (entry && entry.size > MAX_IMAGE) { report.warnings.push(`image ${p} skipped (${Math.round(entry.size / 1e6)} MB > 3 MB)`); continue; }
      images.push({ path: p, size: entry?.size ?? 0, checked: "pending" });
    }
  } else if (contentsList) {
    contentsList
      .filter((e) => e.type === "file" && IMAGE_RE.test(e.name))
      .sort((a, b) => Number(IMAGE_RE.exec(a.name)![2]) - Number(IMAGE_RE.exec(b.name)![2]))
      .slice(0, 6)
      .forEach((e) => { if (e.size > MAX_IMAGE) report.warnings.push(`image ${e.name} skipped (> 3 MB)`); else images.push({ path: e.path, size: e.size, checked: "pending" }); });
  }

  // ---- gate 3: content (secrets + links free; AI budgeted) ----
  const contentReasons: string[] = [];
  const contentFlags: string[] = [];
  const secrets = findSecrets(`${raw.text}\n${readmeText}`);
  if (secrets.length) contentReasons.push(`secrets in the repo text: ${secrets.join(", ")}`);
  const sb = await safeBrowsing(deny.links, env.SAFE_BROWSING_KEY);
  if (sb.bad.length) contentReasons.push(`unsafe links (Google Safe Browsing): ${sb.bad.slice(0, 3).join(", ")}`);
  if (!sb.checked && deny.links.length) report.warnings.push("Safe Browsing not checked (no SAFE_BROWSING_KEY)");

  const preFail = report.gates.some((x) => !x.ok) || contentReasons.length > 0;
  const guardText = `${g.description ?? ""}\n\n${parsed.body}\n\n${readmeText}`;
  const needNeurons = estimateGuardNeurons(guardText) + (images.length ? VISION_NEURONS : 0);
  let deferred = false;
  const viaOpenRouter = Boolean(opts.paid && env.OPENROUTER_API_KEY);
  report.ai = { provider: viaOpenRouter ? "openrouter" : "workers-ai" };
  if (!preFail) {
    const budget = opts.ignoreBudget || viaOpenRouter ? { ok: true } : await budgetAllows(db, env, needNeurons);
    if (!budget.ok) {
      deferred = true;
      report.ai.deferred = true;
      report.warnings.push(`AI content check deferred: today's neuron budget is spent (${needNeurons} needed)`);
    } else {
      const guard = viaOpenRouter ? await llamaGuardOpenRouter(env, guardText) : await llamaGuard(env, guardText);
      report.ai.guard = { ran: guard.ran, categories: guard.categories, neurons: guard.neurons, error: guard.error, provider: guard.provider };
      if (guard.neurons) await spendNeurons(db, guard.neurons);
      if (guard.ran) {
        const j = judgeGuard(guard, meta?.contains ?? []);
        contentReasons.push(...j.reject);
        contentFlags.push(...j.flags);
      } else contentFlags.push(`Llama Guard did not run: ${guard.error ?? "unknown"}`);
      if (images.length) {
        const bytes = await gh.rawBytes(g.owner.login, g.name, g.default_branch, images[0].path);
        if (bytes) {
          const v = viaOpenRouter ? await visionCheckOpenRouter(env, bytes, images[0].path.toLowerCase().endsWith(".png") ? "image/png" : images[0].path.toLowerCase().endsWith(".webp") ? "image/webp" : images[0].path.toLowerCase().endsWith(".gif") ? "image/gif" : "image/jpeg") : await visionCheck(env, bytes);
          report.ai.vision = v;
          if (v.neurons) await spendNeurons(db, v.neurons);
          const hard = v.ran && !v.safe && VISION_HARD.has(v.category ?? "");
          images[0].checked = v.ran ? (v.safe ? "safe" : hard ? "unsafe" : "flagged") : "skipped";
          if (hard) contentReasons.push(`thumbnail failed the vision check (${v.category}): ${v.note ?? ""}`);
          else if (v.ran && !v.safe) contentFlags.push(`thumbnail flagged by the vision check (${v.category}): ${v.note ?? ""}`);
        } else images[0].checked = "unreadable";
        for (const im of images.slice(1)) im.checked = "skipped";
      }
    }
  }
  report.gates.push({ gate: "content", ok: contentReasons.length === 0, reasons: contentReasons, notes: contentFlags });
  report.images = images;

  // ---- gate 2b: risk ----
  const ownerCreated = parseGhDate(ownerInfo?.created_at);
  const minAge = Number(env.MIN_ACCOUNT_AGE_DAYS || 30) * 86400;
  const writeEligible = ownerInfo ? ((ownerCreated ?? now()) <= now() - minAge || (ownerInfo.public_repos ?? 0) >= 1) : true;
  const risk = riskScore({
    repo: g, ownerCreatedAt: ownerCreated, ownerFollowers: ownerInfo?.followers ?? null, ownerPublicRepos: ownerInfo?.public_repos ?? null,
    commitCount, languages, contents: contentsList, readmeChars: readmeText.length, denyFlags: deny.flags, title, writeEligible, contentFlags,
  });
  report.risk = risk;
  const threshold = Number(env.RISK_QUARANTINE || 40);
  report.gates.push({ gate: "risk", ok: risk.score < threshold, reasons: risk.score >= threshold ? [`risk ${risk.score} ≥ ${threshold}`] : [], notes: risk.reasons });
  report.calls = gh.calls;

  // ---- decide ----
  const order: Policy[] = ["denylist", "metadata", "contract", "content", "risk"];
  const failing = order.map((p) => report.gates.find((x) => x.gate === p && !x.ok)).find(Boolean);
  let status: RepoRow["status"] = failing ? (failing.gate === "risk" ? "quarantined" : "rejected") : "listed";
  if (deferred && !failing) status = "discovered";
  report.policy = failing?.gate;
  const rejectReason = failing && failing.gate !== "risk" ? `${POLICY_LABELS[failing.gate]}: ${failing.reasons.join("; ")}` : null;

  // owner/admin states stick
  if (existing?.status === "delisted" && existing.removed_reason === "owner-request" && !opts.byOwner) status = "delisted";
  if (existing?.locked_by && !opts.byAdmin) status = existing.status;   // admin hide/delist/reject sticks until an admin lifts it
  else if (existing?.status === "hidden" && !opts.byAdmin) status = "hidden";
  if (meta?.unlisted) status = "delisted";
  const queueReason = status === "discovered" ? "ai-budget" : status === "quarantined" ? "awaiting-review" : null;

  // ---- body html (GitHub's sanitiser when the file changed; fallback to ours) ----
  let bodyHtml = existing?.body_html ?? null;
  if (parsed.body && (mdChanged || !bodyHtml)) {
    bodyHtml = (await gh.renderMarkdown(parsed.body, g.full_name)) ?? renderMarkdown(parsed.body, { owner: g.owner.login, repo: g.name, branch: g.default_branch });
    bodyHtml = sanitizeReadmeHtml(bodyHtml, { owner: g.owner.login, repo: g.name, branch: g.default_branch });
  } else if (!parsed.body) bodyHtml = null;

  // Known-vulnerable dependencies (badge, not a gate): GitHub SBOM → OSV. Re-checked when the repo was pushed since the last check.
  let vulns: VulnSummary | null = null;
  const prevGh = existing?.gh ? (JSON.parse(existing.gh) as { vulns?: VulnSummary }) : null;
  const pushedAt = parseGhDate(g.pushed_at) ?? 0;
  if (status === "listed" || status === "quarantined") {
    if (!prevGh?.vulns || prevGh.vulns.checked_at < pushedAt || prevGh.vulns.checked_at < now() - 7 * 86400) {
      try { vulns = await vulnerableDeps(gh, g.owner.login, g.name); } catch (e) { vulns = { checked_at: now(), deps: 0, vulnerable: 0, sample: [], note: (e as Error).message }; }
    } else vulns = prevGh.vulns;
  }
  const ghSnapshot = {
    vulns,
    description: g.description, homepage: g.homepage, topics: g.topics ?? [], watchers: g.watchers_count, open_issues: g.open_issues_count, size: g.size,
    is_template: g.is_template ?? false, parent: g.parent?.full_name ?? null, owner_avatar: g.owner.avatar_url,
    languages, release: rel ? { tag: rel.tag_name, name: rel.name, date: rel.published_at, url: rel.html_url } : null,
    community: comm ? { health: comm.health_percentage, files: Object.entries(comm.files ?? {}).filter(([, v]) => v).map(([k]) => k) } : null,
    contributors, commits: commitCount, owner: ownerInfo ? { created_at: ownerInfo.created_at, followers: ownerInfo.followers, public_repos: ownerInfo.public_repos } : null,
  };
  const t = now();
  const listedAt = status === "listed" ? (existing?.listed_at ?? t) : existing?.listed_at ?? null;
  const removed = status === "delisted" ? { at: existing?.removed_at ?? t, reason: meta?.unlisted ? "owner-request" : existing?.removed_reason ?? null } : { at: null, reason: null };
  const nextCrawl = t + nextInterval(parseGhDate(g.pushed_at), existing?.hot ?? 0);

  await db.prepare(
    `INSERT INTO repos (id, full_name, owner, name, owner_id, owner_type, default_branch, title, tagline, demo_url, stars, forks, language, license,
       pushed_at, gh_created_at, is_fork, archived, gh, readme_html, readme_sha, images, etag_repo, etag_readme, etag_contents, md_sha, md_updated_at,
       meta, body_md, body_html, status, queue_reason, risk, reject_reason, scan, listed_at, last_crawled, next_crawl, removed_at, removed_reason)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET
       full_name = excluded.full_name, owner = excluded.owner, name = excluded.name, owner_id = excluded.owner_id, owner_type = excluded.owner_type,
       default_branch = excluded.default_branch, title = excluded.title, tagline = excluded.tagline, demo_url = excluded.demo_url,
       stars = excluded.stars, forks = excluded.forks, language = excluded.language, license = excluded.license, pushed_at = excluded.pushed_at,
       gh_created_at = excluded.gh_created_at, is_fork = excluded.is_fork, archived = excluded.archived, gh = excluded.gh,
       readme_html = excluded.readme_html, readme_sha = excluded.readme_sha, images = excluded.images,
       etag_repo = excluded.etag_repo, etag_readme = COALESCE(excluded.etag_readme, repos.etag_readme), etag_contents = COALESCE(excluded.etag_contents, repos.etag_contents),
       md_sha = excluded.md_sha, md_updated_at = CASE WHEN repos.md_sha IS excluded.md_sha THEN COALESCE(repos.md_updated_at, excluded.md_updated_at) ELSE excluded.md_updated_at END,
       meta = excluded.meta, body_md = excluded.body_md, body_html = excluded.body_html, status = excluded.status, queue_reason = excluded.queue_reason,
       risk = excluded.risk, reject_reason = excluded.reject_reason, scan = excluded.scan, listed_at = excluded.listed_at, last_crawled = excluded.last_crawled,
       next_crawl = excluded.next_crawl, removed_at = excluded.removed_at, removed_reason = excluded.removed_reason`,
  ).bind(
    g.id, g.full_name, g.owner.login, g.name, g.owner.id, g.owner.type, g.default_branch, title, tagline, meta?.demo_url || g.homepage || null,
    g.stargazers_count, g.forks_count, g.language, g.license?.spdx_id && g.license.spdx_id !== "NOASSERTION" ? g.license.spdx_id : null,
    parseGhDate(g.pushed_at), parseGhDate(g.created_at), g.fork ? 1 : 0, g.archived ? 1 : 0, JSON.stringify(ghSnapshot),
    readmeHtml, readme.status === 200 ? readme.etag : existing?.readme_sha ?? null, JSON.stringify(images),
    metaRes.etag, readme.status === 200 ? readme.etag : null, contents.status === 200 ? contents.etag : null, md_sha, t,
    meta ? JSON.stringify(meta) : null, parsed.body || null, bodyHtml, status, queueReason, risk.score, rejectReason, JSON.stringify(report),
    listedAt, t, nextCrawl, removed.at, removed.reason,
  ).run();

  // tags: declared + detected; community slopbuckets are registered, banned ones stripped
  let tags: TagRow[] = [...parsed.tags];
  const declaredBuckets = tags.filter((x) => x.facet === "slopbucket").map((x) => x.value);
  if (declaredBuckets.length) {
    const banned = await registerBuckets(db, declaredBuckets, g.full_name);
    if (banned.length) { report.warnings.push(`slopbucket ${banned.join(", ")} is banned; stripped`); tags = tags.filter((x) => !(x.facet === "slopbucket" && banned.includes(x.value))); }
  }
  const langNames = languages ? Object.keys(languages) : g.language ? [g.language] : [];
  for (const l of langNames.slice(0, 8)) tags.push({ facet: "language", value: normalizeValue(l), source: "detected", recognized: true });
  for (const topic of g.topics ?? []) tags.push({ facet: "topic", value: normalizeValue(topic), source: "detected", recognized: true });
  if (g.license?.spdx_id && g.license.spdx_id !== "NOASSERTION") tags.push({ facet: "license", value: normalizeValue(g.license.spdx_id), source: "detected", recognized: true });
  await replaceTags(db, g.id, dedupe(tags));

  if (mdChanged) {
    await db.prepare("INSERT INTO repo_versions (repo_id, md_sha, meta, body_md, stars) VALUES (?,?,?,?,?)")
      .bind(g.id, md_sha, meta ? JSON.stringify(meta) : null, parsed.body || null, g.stargazers_count).run();
  }
  if (!deferred) {
    await bump(db, "scans");
    if (status === "listed" && existing?.status !== "listed") await bump(db, "listed");
    if (status === "rejected") await bump(db, "rejected");
    if (status === "quarantined") await bump(db, "quarantined");
  }

  const repo = await db.prepare("SELECT * FROM repos WHERE id = ?").bind(g.id).first<RepoRow>();
  return { repo, outcome: { status, report, reject_reason: rejectReason, deferred } };
}

export function metadataGate(g: GhRepo): GateResult {
  const reasons: string[] = [];
  const notes: string[] = [];
  if (g.private) reasons.push("repository is private");
  if (g.archived) reasons.push("repository is archived");
  if (g.disabled) reasons.push("repository was disabled by GitHub");
  if (g.fork) {
    if (!g.parent || g.stargazers_count <= (g.parent?.stargazers_count ?? 0)) reasons.push("forks are only listed when they out-star their parent");
    else notes.push("fork that out-stars its parent");
  }
  if (g.is_template) notes.push("template repository");
  return { gate: "metadata", ok: reasons.length === 0, reasons, notes };
}

export async function delist(db: D1Database, id: number, reason: string): Promise<void> {
  await db.prepare("UPDATE repos SET status = 'delisted', removed_at = unixepoch(), removed_reason = ?, last_crawled = unixepoch(), next_crawl = unixepoch() + 30 * 86400 WHERE id = ? AND status != 'delisted'").bind(reason, id).run();
}

/** Seconds until the next recrawl: 1 h … 7 d by how recently the repo was pushed; ≤ 6 h when it's hot. */
export function nextInterval(pushedAt: number | null, hot: number): number {
  const age = now() - (pushedAt ?? 0);
  let s = age < 86400 ? 3600 : age < 7 * 86400 ? 6 * 3600 : age < 30 * 86400 ? 24 * 3600 : 7 * 86400;
  if (hot > 0 && s > 6 * 3600) s = 6 * 3600;
  return s;
}

function linkLast(link: string | null): number | null {
  if (!link) return null;
  const m = /[?&]page=(\d+)>; rel="last"/.exec(link);
  return m ? Number(m[1]) : null;
}

function dedupe(tags: TagRow[]): TagRow[] {
  const seen = new Set<string>();
  return tags.filter((t) => { const k = `${t.facet}:${t.value}`; if (seen.has(k) || !t.value) return false; seen.add(k); return true; });
}

async function sha1(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export type { SlopMeta };
