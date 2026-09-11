import type { FC } from "hono/jsx";
import { raw } from "hono/html";
import type { RepoRow, CommentRow } from "../lib/db";
import { parseJson } from "../lib/db";
import type { SessionUser } from "../env";
import type { TagRow, SlopMeta } from "../lib/slopmd";
import type { ScanReport } from "../lib/scan";
import { POLICY_LABELS } from "../lib/scan";
import { ago, isoDate } from "../lib/time";
import { VoteBox, ghUrl, Chips } from "./feed";
import { CONTAINS_LISTED, DECLARED_FACETS, DETECTED_FACETS } from "../lib/vocab";
import type { VulnSummary } from "../lib/osv";

export interface RepoPageData {
  repo: RepoRow;
  tags: TagRow[];
  comments: CommentRow[];
  awards: { kind: string; period: string; rank: number }[];
  versions: { md_sha: string | null; seen_at: number; stars: number | null }[];
  mine: number;
  user: SessionUser | null;
  isOwner: boolean;
  flash?: string | null;
  donated?: boolean;
}

const REPORT_REASONS = ["objectionable", "undisclosed", "malware", "spam", "not-slop", "other"];

export const RepoPage: FC<{ d: RepoPageData }> = ({ d }) => {
  const { repo: r, user } = d;
  const meta = parseJson<Partial<SlopMeta>>(r.meta, {});
  const gh = parseJson<{ description?: string; homepage?: string; topics?: string[]; watchers?: number; open_issues?: number; owner_avatar?: string; vulns?: VulnSummary | null; languages?: Record<string, number> | null; release?: { tag: string; date: string | null; url: string } | null; contributors?: number | null; commits?: number | null; community?: { health: number; files: string[] } | null }>(r.gh, {});
  const scan = parseJson<ScanReport | null>(r.scan, null);
  const images = r.images_hidden ? [] : parseJson<{ path: string }[]>(r.images, []);
  const byFacet = new Map<string, TagRow[]>();
  for (const t of d.tags) byFacet.set(t.facet, [...(byFacet.get(t.facet) ?? []), t]);
  const top = d.comments.filter((c) => !c.parent_id);
  const replies = (id: number) => d.comments.filter((c) => c.parent_id === id);
  const pinned = top.find((c) => c.user_id === r.owner_id && !c.deleted_at) ?? null;

  return (
    <article class="repo">
      {d.flash ? <div class="notice">{d.flash}</div> : null}
      {d.donated ? <div class="notice">Thanks. The inspector is back from lunch. This page updates once the scan lands (refresh in a moment).</div> : null}
      <div class="row" style="border:0">
        <span class="rank"></span>
        <VoteBox repo={r} mine={d.mine} user={user} />
        {gh.owner_avatar ? <img class="thumb thumbwrap" src={gh.owner_avatar} alt="" referrerpolicy="no-referrer" /> : <span class="thumb blank thumbwrap">🐷</span>}
        <div>
          <h1><a href={ghUrl(r)} rel="noopener">{r.title ?? r.name}</a> <span class="domain muted">(github.com/{r.full_name})</span></h1>
          <div class="tagline">{r.tagline}</div>
          <div class="sub">
            {r.language ? <span><i class="langdot"></i>{r.language} · </span> : null}★ {r.stars} · {r.forks} forks{r.license ? ` · ${r.license}` : ""} · <Chips repo={r} full />
          </div>
          <div class="muted">
            {r.status === "listed" ? <>listed {ago(r.listed_at)}</> : <>found {ago(r.first_seen)}</>} by <a href={`/u/${r.owner}`}>{r.owner}</a> · last checked {ago(r.last_crawled)}
            {r.demo_url ? <> · <a href={r.demo_url} rel="nofollow noopener">demo</a></> : null}
            {d.awards.map((a) => <> · <span class="chip ok" title="a truffle: Schnitzel dug this one up">🏆 #{a.rank} {a.kind} {a.period}</span></>)}
          </div>
        </div>
      </div>

      <StatusBox r={r} scan={scan} />
      {d.isOwner ? <OwnerBox r={r} user={user!} /> : null}

      {images.length ? (
        <div class="gallery">
          {images.map((im) => <img src={`https://raw.githubusercontent.com/${r.full_name}/${r.default_branch}/${im.path}`} alt="" loading="lazy" referrerpolicy="no-referrer" />)}
        </div>
      ) : null}

      <div class="about">
        <dl>
          {gh.description ? <><dt>GitHub says</dt><dd>{gh.description}</dd></> : null}
          {gh.homepage ? <><dt>website</dt><dd><a href={gh.homepage} rel="nofollow noopener">{gh.homepage}</a></dd></> : null}
          {gh.topics?.length ? <><dt>topics</dt><dd>{gh.topics.map((t) => <a class="chip" href={`/f/topic/${t}`}>{t}</a>)}</dd></> : null}
          <dt>created</dt><dd>{isoDate(r.gh_created_at)} · pushed {ago(r.pushed_at)}{gh.commits ? ` · ${gh.commits} commits` : ""}{gh.contributors ? ` · ${gh.contributors} contributor${gh.contributors === 1 ? "" : "s"}` : ""}</dd>
          {gh.release ? <><dt>release</dt><dd><a href={gh.release.url} rel="nofollow noopener">{gh.release.tag}</a>{gh.release.date ? ` · ${gh.release.date.slice(0, 10)}` : ""}</dd></> : null}
          {gh.languages && Object.keys(gh.languages).length ? <><dt>languages</dt><dd><LangBar langs={gh.languages} /></dd></> : null}
          {gh.community?.files?.length ? <><dt>paperwork</dt><dd>{gh.community.files.map((f) => <span class="chip">{f.replace(/_/g, " ")}</span>)} <span class="muted">{gh.community.health}% health</span></dd></> : null}
          {gh.vulns ? (
            <><dt>dependencies</dt><dd>
              {gh.vulns.deps === 0 ? <span class="muted">{gh.vulns.note ?? "none found"}</span> : gh.vulns.vulnerable === 0
                ? <span class="chip ok" title={`${gh.vulns.deps} packages checked against OSV.dev`}>✓ {gh.vulns.deps} deps, none with known advisories</span>
                : <span class="chip bad" title={gh.vulns.sample.map((x) => `${x.name}@${x.version}: ${x.ids.join(", ")}`).join("\n")}>⚠ {gh.vulns.vulnerable} of {gh.vulns.deps} deps have known advisories</span>}
              <span class="muted"> · OSV.dev, checked {ago(gh.vulns.checked_at)}</span>
            </dd></>
          ) : null}
          {r.tier === "submitted" ? <><dt>launched</dt><dd>{isoDate(r.submitted_at)}</dd></> : null}
        </dl>
      </div>

      <div class="disclosures">
        <h3>Disclosures</h3>
        <dl class="about" style="margin:0">
          {DECLARED_FACETS.filter((f) => byFacet.has(f)).map((f) => (
            <><dt>{f}</dt><dd>{byFacet.get(f)!.map((t) => <a class={`chip${t.recognized ? "" : " unrec"}${f === "contains" ? ((CONTAINS_LISTED as readonly string[]).includes(t.value) ? " warn" : " bad") : ""}`} href={`/f/${f}/${t.value}`} title={t.recognized ? "" : "unrecognized value, kept as a free tag"}>{t.value}</a>)}</dd></>
          ))}
          {DETECTED_FACETS.filter((f) => byFacet.has(f)).map((f) => (
            <><dt>{f} <span class="muted">(detected)</span></dt><dd>{byFacet.get(f)!.map((t) => <a class="chip" href={`/f/${f}/${t.value}`}>{t.value}</a>)}</dd></>
          ))}
        </dl>
        {meta.contains?.length ? <p class="muted">Disclosed content is shown as-is. The author says it's there; graders decide if it matters.</p> : null}
      </div>

      {r.body_html ? <div class="body"><h3>The pitch</h3>{raw(r.body_html)}</div> : null}
      {r.readme_html ? (
        <div class="body">
          <h3>README <a class="muted" href={ghUrl(r)}>(read the rest on GitHub)</a></h3>
          <div class="readme">{raw(r.readme_html)}</div>
        </div>
      ) : null}

      {scan ? (
        <details class="scanreport" open={r.status !== "listed"}>
          <summary>Scan report · {isoDate(scan.at)}</summary>
          <ul>
            {scan.gates.map((g) => (
              <li class={g.ok ? "gate-ok" : "gate-bad"}>{g.ok ? "✓" : "✗"} <strong>{POLICY_LABELS[g.gate] ?? g.gate}</strong>{g.reasons.length ? `: ${g.reasons.join("; ")}` : ""}{g.notes?.length ? <span class="muted"> — {g.notes.join("; ")}</span> : null}</li>
            ))}
          </ul>
          {d.versions.length > 1 ? <p class="muted">{d.versions.length} versions of slopscore.md seen; last change {ago(d.versions[0].seen_at)}.</p> : null}
        </details>
      ) : null}

      <section class="comments" id="comments">
        <h3>{r.comment_count} comments</h3>
        {user && r.status === "listed" ? (
          <form class="commentform" method="post" action={`/r/${r.full_name}/comments`}>
            <input type="hidden" name="csrf" value={user.csrf} />
            <textarea name="body" placeholder="Grade it. Markdown ok." required maxlength={4000}></textarea>
            <div><button type="submit">comment</button></div>
          </form>
        ) : !user ? <p class="muted"><a href={`/auth/github?next=/r/${r.full_name}`}>log in</a> to comment.</p> : <p class="muted">Comments open once this repo is listed.</p>}
        {pinned ? <Comment c={pinned} r={r} user={user} pinned replies={replies(pinned.id)} /> : null}
        {top.filter((c) => c !== pinned).map((c) => <Comment c={c} r={r} user={user} replies={replies(c.id)} />)}
      </section>

      <details class="reportform" id="report">
        <summary class="report">report this listing</summary>
        {user ? (
          <form method="post" action={`/r/${r.full_name}/report`}>
            <input type="hidden" name="csrf" value={user.csrf} />
            <select name="reason">{REPORT_REASONS.map((x) => <option value={x}>{x}</option>)}</select>
            <input type="text" name="note" placeholder="optional note" maxlength={300} />
            <button type="submit" class="btn secondary">send</button>
          </form>
        ) : <span class="muted"> — <a href={`/auth/github?next=/r/${r.full_name}`}>log in</a> to report</span>}
      </details>
    </article>
  );
};

const StatusBox: FC<{ r: RepoRow; scan: ScanReport | null }> = ({ r, scan }) => {
  switch (r.status) {
    case "listed": return null;
    case "rejected":
      return (
        <div class="status rejected">
          <strong>Rejected. Your slop lacks paperwork.</strong>
          <div>Policy: <strong>{scan?.policy ? POLICY_LABELS[scan.policy] : "unknown"}</strong></div>
          <div>{r.reject_reason}</div>
          <div class="muted">Fix it, then <code>curl {`/ping/${r.full_name}`}</code> (or press Refresh if you're the owner) to re-enter the queue. <a href="/spec">Spec</a>.</div>
        </div>
      );
    case "discovered":
      return <div class="status queued"><strong>In the trough. Awaiting inspection.</strong> <span class="muted">{r.queue_reason === "ai-budget" ? "The inspector has gone home for the day. Back at 00:00 UTC." : "Found, not yet scanned. Votes open once it's listed."}</span></div>;
    case "quarantined":
      return <div class="status queued"><strong>Awaiting human review.</strong> <span class="muted">Risk score {r.risk}. A moderator will look at it. Everything is still readable; nothing is votable yet.</span></div>;
    case "hidden":
      return <div class="status queued"><strong>Under review.</strong> <span class="muted">Reported by several graders; hidden from feeds until a moderator decides.</span></div>;
    case "delisted":
      return <div class="status delisted"><strong>Removed {isoDate(r.removed_at)}.</strong> <span class="muted">Reason: {r.removed_reason === "owner-request" ? "the owner asked" : r.removed_reason === "marker-removed" ? "slopscore.md was removed" : r.removed_reason === "dmca" ? "DMCA takedown on GitHub" : r.removed_reason === "404" ? "gone from GitHub" : r.removed_reason}. Votes and comments stay readable.</span></div>;
  }
};

const OwnerBox: FC<{ r: RepoRow; user: SessionUser }> = ({ r, user }) => {
  const canSubmit = r.status === "listed" && (r.tier === "found" || (r.submitted_at ?? 0) < Math.floor(Date.now() / 1000) - 180 * 86400);
  const act = (name: string, label: string, opts: { disabled?: boolean; secondary?: boolean; confirm?: string; title?: string } = {}) => (
    <form class="owner" method="post" action={`/r/${r.full_name}/owner/${name}`} onsubmit={opts.confirm ? `return confirm(${JSON.stringify(opts.confirm)})` : undefined}>
      <input type="hidden" name="csrf" value={user.csrf} />
      <button type="submit" class={opts.secondary ? "secondary" : ""} disabled={opts.disabled} title={opts.title}>{label}</button>
    </form>
  );
  return (
    <div class="owner">
      <h3>You own this. Controls:</h3>
      <p class="muted">Tier: <strong>{r.tier}</strong> · status: <strong>{r.status}</strong>. {r.tier === "found" ? "Votes already count. Submitting makes it a launch and puts it in the running for Slop of the Day." : `Launched ${isoDate(r.submitted_at)}.`}</p>
      {act("refresh", "Refresh from GitHub", { secondary: true, title: "re-crawl now, re-run every gate" })}
      {act("submit", "Submit for consideration", { disabled: !canSubmit, title: canSubmit ? "" : r.status !== "listed" ? "available once listed" : "already submitted in the last 180 days" })}
      {r.status === "delisted" && r.removed_reason === "owner-request"
        ? act("restore", "Restore listing", { secondary: true })
        : act("remove", "Remove listing", { secondary: true, confirm: "Remove this listing? The page stays as a public tombstone and the removal is logged. You can restore it later, or set unlisted: true in slopscore.md instead." })}
      {r.status === "discovered" || r.status === "rejected" ? (
        <form class="owner" method="post" action={`/r/${r.full_name}/donate`}>
          <input type="hidden" name="csrf" value={user.csrf} />
          <button type="submit" title="Stripe Checkout. Covers the hosting bill; buys the wait, never a gate.">Jump the line · $5 toward the hosting bill</button>
        </form>
      ) : null}
      <p class="muted">Badge: <code>{`[![SlopScore](https://slopscore.org/badge/${r.full_name}.svg)](https://slopscore.org/r/${r.full_name})`}</code></p>
    </div>
  );
};

const Comment: FC<{ c: CommentRow; r: RepoRow; user: SessionUser | null; pinned?: boolean; replies: CommentRow[] }> = ({ c, r, user, pinned, replies }) => (
  <div class={`comment${pinned ? " pinned" : ""}`} id={`c${c.id}`}>
    <div class="meta">
      <a href={`/u/${c.login}`}>{c.login}</a>{c.user_id === r.owner_id ? <span class="maker"> maker</span> : null} · {ago(c.created_at)} · ▲{c.up} ▼{c.down}
      {pinned ? <span class="muted"> · pinned maker comment</span> : null}
      {user ? <> · <form class="inline" method="post" action={`/c/${c.id}/vote`}><input type="hidden" name="csrf" value={user.csrf} /><button class="link" name="value" value="1">▲</button> <button class="link" name="value" value="-1">▼</button></form> · <a href={`#reply-${c.id}`} class="muted">reply</a> · <form class="inline" method="post" action={`/c/${c.id}/report`}><input type="hidden" name="csrf" value={user.csrf} /><input type="hidden" name="reason" value="objectionable" /><button class="link report">report</button></form></> : null}
    </div>
    <div class="cbody">{c.deleted_at ? <em class="muted">[deleted]</em> : raw(c.body_html)}</div>
    {user && r.status === "listed" ? (
      <details id={`reply-${c.id}`}><summary class="muted">reply</summary>
        <form class="commentform" method="post" action={`/r/${r.full_name}/comments`}>
          <input type="hidden" name="csrf" value={user.csrf} /><input type="hidden" name="parent_id" value={String(c.id)} />
          <textarea name="body" required maxlength={4000}></textarea><div><button type="submit">reply</button></div>
        </form>
      </details>
    ) : null}
    {replies.length ? <div class="replies">{replies.map((x) => <Comment c={x} r={r} user={user} replies={[]} />)}</div> : null}
  </div>
);


const LangBar = ({ langs }: { langs: Record<string, number> }) => {
  const total = Object.values(langs).reduce((a, b) => a + b, 0) || 1;
  const top = Object.entries(langs).sort((a, b) => b[1] - a[1]).slice(0, 6);
  return (
    <span class="langbar" title={top.map(([n, b]) => `${n} ${((b / total) * 100).toFixed(1)}%`).join(" · ")}>
      {top.map(([n, b]) => <span class="chip">{n} {Math.round((b / total) * 100)}%</span>)}
    </span>
  );
};
