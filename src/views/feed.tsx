import type { FC } from "hono/jsx";
import type { RepoRow } from "../lib/db";
import type { SessionUser } from "../env";
import { ago } from "../lib/time";
import { parseJson } from "../lib/db";
import type { SlopMeta } from "../lib/slopmd";
import { CONTAINS_LISTED } from "../lib/vocab";
import { fuzz } from "../lib/trust";
import { flagOn } from "../lib/flags";
import { Flag, Icon, Caret } from "./art";
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
  const title = !votable ? "not yet graded" : !user ? "anonymous votes count with the crowd, not the score; log in to vote for real" : "";
  const crowd = (repo.crowd_up ?? 0) - (repo.crowd_down ?? 0);
  return (
    <form class={`vote votebox${votable ? "" : " off"}${user ? "" : " anon"}`} method="post" action={`${repoUrl(repo)}/vote`} title={title}>
      {user ? <input type="hidden" name="csrf" value={user.csrf} /> : null}
      <button name="value" value={mine === 1 ? "0" : "1"} class={`up${mine === 1 ? " on" : ""}`} disabled={!votable} aria-label="upvote"><Caret dir="up" /></button>
      <span class="score" title={flagOn("fuzz") ? "weighted, lightly fuzzed" : "weighted"}>{flagOn("fuzz") ? fuzz(repo.score, repo.id) : repo.score}</span>
      <button name="value" value={mine === -1 ? "0" : "-1"} class={`down${mine === -1 ? " on" : ""}`} disabled={!votable} aria-label="downvote"><Caret dir="down" /></button>
      {flagOn("crowd") && (crowd !== 0 || !user) ? <span class="crowd" title="anonymous crowd votes: shown, never ranking">{crowd > 0 ? `+${crowd}` : crowd} crowd</span> : null}
      {repo.critic_up ? <a class="crowd" href="/about#critics" title="upvotes from SlopScore's disclosed agent critics (accounts on this site, not GitHub accounts), at half weight; awards ignore them">incl. {repo.critic_up} critic{repo.critic_up === 1 ? "" : "s"}</a> : null}
    </form>
  );
};

export const Chips: FC<{ repo: RepoRow; full?: boolean }> = ({ repo, full }) => {
  const m = parseJson<Partial<SlopMeta>>(repo.meta, {});
  const trawled = repo.source === "trawl";
  const capm = trawled ? <span class="chip warn" title="The owner didn't submit this. The Cap'm found it on a truffle trawl and wrote its paperwork from GitHub data.">paperwork by the Cap'm</span> : null;
  if (!m.ai_generated) return capm ? <span class="chips">{capm}</span> : null;
  const inf = trawled ? " (inferred)" : "";
  return (
    <span class="chips">
      {capm}
      <span class="chip" title={trawled ? "inferred by the Cap'm from the owner's own tags" : "ai_generated"}>{m.ai_generated} ai{inf}</span>
      <span class="chip" title={trawled ? "inferred by the Cap'm" : "human_touch"}>{m.human_touch} human{inf}</span>
      <span class="chip" title={trawled ? "the Cap'm's default guess" : "status"}>{m.status}{inf}</span>
      {(m.slopscore ?? 2) < 2 ? <span class="chip warn" title="slopscore.md is on spec v1. Still listed, still votable. Owner: add slopscore: 2 and spec: https://slopscore.org/spec">v1 paperwork</span> : null}
      {(m.category ?? []).slice(0, full ? 99 : 2).map((c) => <a class="chip" href={`/f/category/${c}`}>{c}</a>)}
      {(m.contains ?? []).map((c) => <span class={`chip ${(CONTAINS_LISTED as readonly string[]).includes(c) ? "warn" : "bad"}`} title="disclosed">⚠ {c}</span>)}
      {full ? (m.built_with ?? []).map((c) => <a class="chip" href={`/f/built_with/${c}`}>🤖 {c}</a>) : null}
      {repo.tier === "found" && repo.status === "listed" && !trawled ? <span class="chip tier" title="the owner hasn't submitted this yet; votes count, awards don't">unclaimed</span> : null}
    </span>
  );
};

/** The one line in the feed where opted-in listings end and the Cap'm's trawl begins. Hover for the whole
 *  story, or click: it is a <details>, so the explanation costs no script and no room until it is wanted. */
const TRAWL_NOTE = "The Cap'm's net dragged everything below this line out of public GitHub: nobody submitted it, and he wrote the paperwork himself from what the owner already said. Trawled listings sort under every repo that opted in, stay out of the RSS feed, and can't win awards. An owner can claim one with a slopscore.md of their own, or have it removed in a click.";

export const NetLine: FC = () => (
  <li class="netline">
    <details>
      <summary title={TRAWL_NOTE}>the trawling net</summary>
      <p class="netnote">{TRAWL_NOTE} <a href="/about">How the trawl works</a>.</p>
    </details>
  </li>
);

export const FeedRow: FC<{ repo: RepoRow; mine: number; user: SessionUser | null; showStatus?: boolean }> = ({ repo, mine, user, showStatus }) => {
  const thumb = thumbUrl(repo);
  const gh = parseJson<{ owner_avatar?: string }>(repo.gh, {});
  return (
    <li class="row" id={`r${repo.id}`}>
      <VoteBox repo={repo} mine={mine} user={user} />
      {thumb ? <a href={repoUrl(repo)} class="thumbwrap"><img class="thumb" src={thumb} alt="" loading="lazy" referrerpolicy="no-referrer" /></a> : <a href={repoUrl(repo)} class="thumb blank thumbwrap">🐷</a>}
      <div class="rowmain">
        <div class="byline">
          {showStatus ? <span class={`chip ${repo.status === "rejected" ? "bad" : "warn"}`}>{repo.status}{repo.queue_reason ? ` · ${repo.queue_reason}` : ""}</span> : null}{" "}
          {gh.owner_avatar ? <img class="byline-avatar" src={gh.owner_avatar} alt="" loading="lazy" referrerpolicy="no-referrer" /> : null}
          <a href={`/u/${repo.owner}`}>{repo.owner}</a> · {repo.status === "listed" ? <>listed {ago(repo.listed_at)}</> : <>found {ago(repo.first_seen)}</>}
        </div>
        <div class="title">
          <a href={repoUrl(repo)}>{repo.title ?? repo.name}</a>
        </div>
        <div class="repolink"><a href={ghUrl(repo)} rel="noopener"><Icon name="external" /> github.com/{repo.full_name}</a></div>
        <div class="tagline">{repo.tagline}</div>
        <div class="meta">
          {repo.language ? <span><i class="langdot"></i>{repo.language} · </span> : null}
          ★ {repo.stars} · <Chips repo={repo} />
        </div>
        {repo.status === "rejected" && repo.reject_reason ? <div class="meta muted">✗ {repo.reject_reason}</div> : null}
      </div>
      <div class="actions">
        <a class="act" href={`${repoUrl(repo)}#comments`}><Icon name="comment" /> {repo.comment_count} <span class="act-label">comment{repo.comment_count === 1 ? "" : "s"}</span></a>
        <a class="act report" href={`${repoUrl(repo)}#report`}><Flag /> <span class="act-label">report</span></a>
        {user && isOwnerOf(repo, user.login, user.id) ? (
          <>
            <a class="act own" href={repoUrl(repo)}><Icon name="manage" /> manage</a>
            <span class="chip tier">yours</span>
            {repo.status === "listed" && repo.tier === "found" && repo.source !== "trawl" ? (
              <form method="post" action={`${repoUrl(repo)}/owner/submit`} class="inline"><input type="hidden" name="csrf" value={user.csrf} /><button type="submit" class="btn small"><Icon name="rocket" /> Submit for consideration</button></form>
            ) : repo.source === "trawl" ? <span class="muted small">trawled: commit your own slopscore.md to claim it</span> : repo.tier === "submitted" ? <span class="muted small">submitted {ago(repo.submitted_at)}</span> : <span class="muted small">submit opens once listed</span>}
          </>
        ) : null}
      </div>
    </li>
  );
};

export const FeedList: FC<{ rows: RepoRow[]; page: number; hasMore: boolean; votes: Map<number, number>; user: SessionUser | null; baseUrl: string; empty?: string; showStatus?: boolean; markTrawl?: boolean }> = ({ rows, page, hasMore, votes, user, baseUrl, empty, showStatus, markTrawl }) => {
  const sep = baseUrl.includes("?") ? "&" : "?";
  // Every feed sort puts opted-in repos above trawled ones (feedOrder in lib/db), so the first trawled row on the
  // page is the boundary and one line marks it. Off by default: the lists that are all trawl already say so in a
  // heading of their own, and a vote-ordered feed interleaves the two kinds, where a line would be a lie.
  const netAt = markTrawl ? rows.findIndex((r) => r.source === "trawl") : -1;
  return (
    <>
      {rows.length === 0 ? <div class="empty">{empty ?? "No slop yet. Suspicious."}</div> : null}
      <ol class="feed">
        {rows.map((r, i) => <>{i === netAt ? <NetLine /> : null}<FeedRow repo={r} mine={votes.get(r.id) ?? 0} user={user} showStatus={showStatus} /></>)}
      </ol>
      {(page > 1 || hasMore) ? (
        <div class="pager">
          {page > 1 ? <a href={`${baseUrl}${sep}page=${page - 1}`}>‹ prev</a> : null}
          {hasMore ? <a href={`${baseUrl}${sep}page=${page + 1}`} rel="next">next ›</a> : null}
        </div>
      ) : null}
    </>
  );
};
