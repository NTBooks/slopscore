import type { FC } from "hono/jsx";
import type { RepoRow } from "../lib/db";
import type { SessionUser } from "../env";
import { ago } from "../lib/time";
import { parseJson } from "../lib/db";
import type { SlopMeta } from "../lib/slopmd";
import { CONTAINS_LISTED } from "../lib/vocab";
import { fuzz } from "../lib/trust";
import { Flag } from "./art";
import { isOwnerOf } from "../lib/owner";

export const repoUrl = (r: RepoRow) => `/r/${r.full_name}`;
export const ghUrl = (r: RepoRow) => `https://github.com/${r.full_name}`;

export function thumbUrl(r: RepoRow): string | null {
  const imgs = parseJson<{ path: string }[]>(r.images, []);
  if (imgs.length && !r.images_hidden) return `https://raw.githubusercontent.com/${r.full_name}/${r.default_branch}/${imgs[0].path}`;
  const gh = parseJson<{ owner_avatar?: string }>(r.gh, {});
  return gh.owner_avatar ?? null;
}

export function ogImage(r: RepoRow): string {
  return thumbUrl(r) ?? `https://opengraph.githubassets.com/1/${r.full_name}`;
}

export const VoteBox: FC<{ repo: RepoRow; mine: number; user: SessionUser | null }> = ({ repo, mine, user }) => {
  const votable = repo.status === "listed";
  const title = !votable ? "not yet graded" : !user ? "log in to vote" : "";
  return (
    <form class={`vote votebox${votable ? "" : " off"}`} method="post" action={`${repoUrl(repo)}/vote`} title={title}>
      {user ? <input type="hidden" name="csrf" value={user.csrf} /> : null}
      <button name="value" value={mine === 1 ? "0" : "1"} class={`up${mine === 1 ? " on" : ""}`} disabled={!votable} aria-label="upvote">▲</button>
      <span class="score" title="weighted, lightly fuzzed">{fuzz(repo.score, repo.id)}</span>
      <button name="value" value={mine === -1 ? "0" : "-1"} class={`down${mine === -1 ? " on" : ""}`} disabled={!votable} aria-label="downvote">▼</button>
    </form>
  );
};

export const Chips: FC<{ repo: RepoRow; full?: boolean }> = ({ repo, full }) => {
  const m = parseJson<Partial<SlopMeta>>(repo.meta, {});
  if (!m.ai_generated) return null;
  return (
    <span class="chips">
      <span class="chip" title="ai_generated">{m.ai_generated} ai</span>
      <span class="chip" title="human_touch">{m.human_touch} human</span>
      <span class="chip" title="status">{m.status}</span>
      {(m.category ?? []).slice(0, full ? 99 : 2).map((c) => <a class="chip" href={`/f/category/${c}`}>{c}</a>)}
      {(m.contains ?? []).map((c) => <span class={`chip ${(CONTAINS_LISTED as readonly string[]).includes(c) ? "warn" : "bad"}`} title="disclosed">⚠ {c}</span>)}
      {full ? (m.built_with ?? []).map((c) => <a class="chip" href={`/f/built_with/${c}`}>🤖 {c}</a>) : null}
      {repo.tier === "found" && repo.status === "listed" ? <span class="chip tier" title="the owner hasn't submitted this yet; votes count, awards don't">unclaimed</span> : null}
    </span>
  );
};

export const FeedRow: FC<{ repo: RepoRow; rank: number; mine: number; user: SessionUser | null; showStatus?: boolean }> = ({ repo, rank, mine, user, showStatus }) => {
  const thumb = thumbUrl(repo);
  const gh = parseJson<{ owner_avatar?: string }>(repo.gh, {});
  return (
    <li class="row" id={`r${repo.id}`}>
      <span class="rank">{rank}</span>
      <VoteBox repo={repo} mine={mine} user={user} />
      {thumb ? <a href={repoUrl(repo)}><img class="thumb" src={thumb} alt="" loading="lazy" referrerpolicy="no-referrer" /></a> : <a href={repoUrl(repo)} class="thumb blank">🐷</a>}
      <div>
        <div class="title">
          <a href={ghUrl(repo)} rel="noopener">{repo.title ?? repo.name}</a> <span class="domain">(github.com/{repo.owner})</span>
        </div>
        <div class="tagline">{repo.tagline}</div>
        <div class="meta">
          {repo.language ? <span><i class="langdot"></i>{repo.language} · </span> : null}
          ★ {repo.stars} · <Chips repo={repo} />
        </div>
        <div class="meta">
          {showStatus ? <span class={`chip ${repo.status === "rejected" ? "bad" : "warn"}`}>{repo.status}{repo.queue_reason ? ` · ${repo.queue_reason}` : ""}</span> : null}{" "}
          {repo.status === "listed" ? <>listed {ago(repo.listed_at)}</> : <>found {ago(repo.first_seen)}</>} by <a href={`/u/${repo.owner}`}>{repo.owner}</a>
          {gh.owner_avatar ? null : null} · <a href={`${repoUrl(repo)}#comments`}>{repo.comment_count} comments</a> · <a href={repoUrl(repo)}>details</a> · <a href={`${repoUrl(repo)}#report`} class="report"><Flag /> report</a>
          {repo.status === "rejected" && repo.reject_reason ? <div class="muted">✗ {repo.reject_reason}</div> : null}
          {user && isOwnerOf(repo, user.login, user.id) ? (
            <div class="ownerline">
              <span class="chip tier">yours</span>
              {repo.status === "listed" && repo.tier === "found" ? (
                <form method="post" action={`${repoUrl(repo)}/owner/submit`} class="inline"><input type="hidden" name="csrf" value={user.csrf} /><button type="submit" class="btn small">Submit for consideration</button></form>
              ) : repo.tier === "submitted" ? <span class="muted">submitted {ago(repo.submitted_at)}</span> : <span class="muted">submit opens once listed</span>}
              {" "}<a href={repoUrl(repo)} class="muted">manage ›</a>
            </div>
          ) : null}
        </div>
      </div>
    </li>
  );
};

export const FeedList: FC<{ rows: RepoRow[]; page: number; hasMore: boolean; votes: Map<number, number>; user: SessionUser | null; baseUrl: string; empty?: string; showStatus?: boolean }> = ({ rows, page, hasMore, votes, user, baseUrl, empty, showStatus }) => {
  const sep = baseUrl.includes("?") ? "&" : "?";
  const offset = (page - 1) * 25;
  return (
    <>
      {rows.length === 0 ? <div class="empty">{empty ?? "No slop yet. Suspicious."}</div> : null}
      <ol class="feed">
        {rows.map((r, i) => <FeedRow repo={r} rank={offset + i + 1} mine={votes.get(r.id) ?? 0} user={user} showStatus={showStatus} />)}
      </ol>
      {(page > 1 || hasMore) ? (
        <div class="pager">
          {page > 1 ? <a href={`${baseUrl}${sep}page=${page - 1}`}>‹ prev</a> : null}
          {hasMore ? <a href={`${baseUrl}${sep}page=${page + 1}`}>next ›</a> : null}
        </div>
      ) : null}
    </>
  );
};
