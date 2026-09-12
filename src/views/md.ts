// Markdown renderers for the .md variant of every page. Agents read these.
import type { RepoRow, CommentRow } from "../lib/db";
import type { TagRow } from "../lib/slopmd";
import { ago, isoDate } from "../lib/time";
import { stripHtml } from "../lib/markdown";
import { criticById, criticQuip, criticShortName } from "../lib/critics";

export function feedMd(title: string, rows: RepoRow[], page: number, hasMore: boolean, intro?: string): string {
  const out = [`# ${title}`, ""];
  if (intro) out.push(intro, "");
  if (!rows.length) out.push("_No slop yet. Suspicious._", "");
  rows.forEach((r, i) => {
    const n = (page - 1) * 25 + i + 1;
    out.push(`${n}. **[${r.title ?? r.name}](/r/${r.full_name})** · score ${r.score} (▲${r.up} ▼${r.down}) · ★${r.stars}${r.language ? ` · ${r.language}` : ""} · ${r.comment_count} comments`);
    out.push(`   ${r.tagline ?? ""}`);
    out.push(`   github: https://github.com/${r.full_name} · owner: ${r.owner} · status: ${r.status}${r.source === "trawl" ? " (trawled: the owner didn't submit this; paperwork by the Cap'm)" : r.tier === "found" ? " (unclaimed)" : ""}${r.reject_reason ? ` · rejected: ${r.reject_reason}` : ""}`);
  });
  out.push("");
  if (page > 1 || hasMore) out.push(`Page ${page}.${hasMore ? " More: add `?page=" + (page + 1) + "`." : ""}`, "");
  out.push("---", "Every page is also available as `.json`. Vote/comment with a bearer token from `/auth/device`. See `/llms.txt`.");
  return out.join("\n");
}

export function repoMd(r: RepoRow, tags: TagRow[], comments: CommentRow[], awards: { kind: string; period: string; rank: number }[], critics: { critic_id: number; upvote: number; reason: string | null }[] = []): string {
  const out = [`# ${r.title ?? r.name}`, "", r.tagline ?? "", ""];
  out.push(`- GitHub: https://github.com/${r.full_name}`);
  if (r.demo_url) out.push(`- Demo: ${r.demo_url}`);
  out.push(`- Status on SlopScore: **${r.status}**${r.queue_reason ? ` (${r.queue_reason})` : ""} · tier: ${r.tier}`);
  if (r.source === "trawl") out.push(`- Trawled: the owner didn't submit this; the Cap'm wrote the paperwork. ${r.virtual_reason ?? ""}`);
  if (r.reject_reason) out.push(`- Rejected under: ${r.reject_reason}`);
  if (r.removed_reason) out.push(`- Removed: ${r.removed_reason} on ${isoDate(r.removed_at)}`);
  out.push(`- Score: ${r.score} (▲${r.up} ▼${r.down}) · ${r.comment_count} comments · ★${r.stars} · ${r.forks} forks`);
  if (r.language) out.push(`- Language: ${r.language}`);
  if (r.license) out.push(`- License: ${r.license}`);
  out.push(`- Listed: ${r.listed_at ? isoDate(r.listed_at) : "not yet"} · first seen ${isoDate(r.first_seen)} · last checked ${ago(r.last_crawled)}`);
  if (awards.length) out.push(`- Awards: ${awards.map((a) => `#${a.rank} ${a.kind} ${a.period}`).join(", ")}`);
  try {
    const gh = r.gh ? (JSON.parse(r.gh) as { vulns?: { deps: number; vulnerable: number; sample: { name: string; version: string; ids: string[] }[]; note?: string } | null }) : null;
    if (gh?.vulns && gh.vulns.deps > 0) out.push(`- Dependencies: ${gh.vulns.vulnerable} of ${gh.vulns.deps} with known advisories (OSV.dev)${gh.vulns.sample.length ? ` · ${gh.vulns.sample.slice(0, 3).map((x) => `${x.name}@${x.version} (${x.ids.join(", ")})`).join("; ")}` : ""}`);
  } catch { /* ignore */ }
  out.push("");
  const byFacet = new Map<string, string[]>();
  for (const t of tags) byFacet.set(t.facet, [...(byFacet.get(t.facet) ?? []), t.value + (t.recognized ? "" : "?") + (t.source === "detected" ? " (detected)" : "")]);
  if (byFacet.size) {
    out.push("## Disclosures and facets", "");
    for (const [f, vals] of byFacet) out.push(`- ${f}: ${vals.join(", ")}`);
    out.push("");
  }
  if (r.body_md) out.push("## Pitch", "", r.body_md, "");
  if (r.readme_html) out.push("## README (excerpt)", "", stripHtml(r.readme_html).slice(0, 2000), "");
  if (r.scan) {
    try {
      const s = JSON.parse(r.scan) as { gates: { gate: string; ok: boolean; reasons: string[] }[] };
      out.push("## Scan report", "");
      for (const g of s.gates) out.push(`- ${g.ok ? "✓" : "✗"} ${g.gate}${g.reasons.length ? `: ${g.reasons.join("; ")}` : ""}`);
      out.push("");
    } catch { /* ignore */ }
  }
  if (comments.length) {
    out.push(`## Comments (${comments.length})`, "");
    for (const c of comments) out.push(`- **${c.login}**${c.user_id === r.owner_id ? " (maker)" : ""} · ${ago(c.created_at)} · ▲${c.up} ▼${c.down}`, `  ${c.deleted_at ? "[deleted]" : c.body_md.replace(/\n/g, "\n  ")}`);
    out.push("");
  }
  out.push("---", `Vote: \`POST /r/${r.full_name}/vote\` {value: 1|-1|0} · Comment: \`POST /r/${r.full_name}/comments\` {body} · Report: \`POST /r/${r.full_name}/report\` {reason, note}. Bearer token from \`/auth/device\`.`);
  if (critics.length) {
    const clapped = critics.filter((v) => v.upvote === 1);
    const passed = critics.filter((v) => v.upvote !== 1).map((v) => criticById(v.critic_id)).filter(Boolean);
    out.push("", `## From the balcony (${clapped.length} of ${critics.length} clapped)`, "");
    for (const v of clapped) {
      const c = criticById(v.critic_id);
      if (c) out.push(`- **${criticShortName(c)}** clapped${criticQuip(v.reason) ? ` — ${criticQuip(v.reason)}` : ""}`);
    }
    if (passed.length) { const n = passed.map((c) => criticShortName(c!)); out.push("", `${n.length > 1 ? `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}` : n[0]} read it and passed; the reasons are on /balcony.`); }
    out.push("", "Critics are accounts on this site with no GitHub account behind them: half weight, never a downvote, subtracted before an award is counted.");
  }

  return out.join("\n");
}
