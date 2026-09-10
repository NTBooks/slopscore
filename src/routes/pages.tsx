// HTML pages (each also answers as .json / .md via respond()).
import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import {
  feed, getRepo, repoTags, comments as loadComments, awardsFor, userVote, userVotesFor, siteStats, facetCounts,
  getUserByLogin, castVote, addComment, castCommentVote, rateLimit, logAction, parseJson, curatedTags, getTag, type Sort, SORTS, type RepoRow,
} from "../lib/db";
import { ipHash } from "../lib/trust";
import { respond } from "../lib/negotiate";
import { parseQuery } from "../lib/searchquery";
import { Layout, SITE } from "../views/layout";
import { FeedList, ogImage } from "../views/feed";
import { Rail, type RailData } from "../views/rail";
import { RepoPage, type RepoPageData } from "../views/repo";
import { feedMd, repoMd } from "../views/md";
import { requireUser, body, wantsJson } from "../middleware";
import { renderMarkdown, escapeHtml } from "../lib/markdown";
import { GitHub } from "../lib/github";
import { scanRepo } from "../lib/scan";
import { isOwnerOf } from "./owner";
import { vocabJson, CONTROLLED, DECLARED_FACETS, DETECTED_FACETS } from "../lib/vocab";
import { MINIMAL_EXAMPLE } from "../lib/slopmd";
import { ago, isoDate } from "../lib/time";

export const pages = new Hono<AppEnv>();

async function railData(db: D1Database): Promise<RailData> {
  const [stats, tags, tools] = await Promise.all([
    siteStats(db),
    curatedTags(db),
    db.prepare(
      "SELECT rt.value, count(*) AS n, avg(r.score) AS mean FROM repo_tags rt JOIN repos r ON r.id = rt.repo_id WHERE rt.facet = 'built_with' AND r.status = 'listed' GROUP BY rt.value ORDER BY mean DESC, n DESC LIMIT 8",
    ).all<{ value: string; n: number; mean: number }>().then((r) => r.results ?? []),
  ]);
  return { stats, tools, tags };
}

function sortParam(s: string | undefined): Sort {
  return (SORTS as readonly string[]).includes(s ?? "") ? (s as Sort) : "hot";
}

const feedJson = (rows: RepoRow[], page: number, hasMore: boolean) => ({
  page, has_more: hasMore, next: hasMore ? page + 1 : null,
  repos: rows.map(repoJson),
});

export function repoJson(r: RepoRow) {
  return {
    id: r.id, full_name: r.full_name, owner: r.owner, name: r.name, url: `/r/${r.full_name}`, github: `https://github.com/${r.full_name}`,
    title: r.title ?? r.name, tagline: r.tagline, demo_url: r.demo_url, language: r.language, license: r.license, stars: r.stars, forks: r.forks,
    status: r.status, tier: r.tier, queue_reason: r.queue_reason, reject_reason: r.reject_reason, removed_reason: r.removed_reason, risk: r.risk,
    score: r.score, up: r.up, down: r.down, hot: r.hot, controversy: r.controversy, comment_count: r.comment_count,
    meta: parseJson(r.meta, null), first_seen: r.first_seen, listed_at: r.listed_at, submitted_at: r.submitted_at, md_updated_at: r.md_updated_at, last_crawled: r.last_crawled,
  };
}

// ---- generic feed page renderer ----
async function feedPage(c: Context<AppEnv>, opts: {
  title: string; heading: string; sort: Sort; t?: string; page: number; filters?: ReturnType<typeof parseQuery>["filters"]; match?: string | null;
  status?: RepoRow["status"] | RepoRow["status"][]; owner?: string; tag?: string; baseUrl: string; intro?: string; empty?: string; showStatus?: boolean; extra?: unknown; description?: string; q?: string; showHero?: boolean;
}) {
  const user = c.get("user");
  const url = new URL(c.req.url);
  const [{ rows, hasMore, page }, rail] = await Promise.all([
    feed(c.env.DB, { sort: opts.sort, t: opts.t, page: opts.page, filters: opts.filters, match: opts.match, status: opts.status, owner: opts.owner, tag: opts.tag }),
    railData(c.env.DB),
  ]);
  const votes = user ? await userVotesFor(c.env.DB, user.id, rows.map((r) => r.id)) : new Map<number, number>();
  const winner = opts.showHero ? await c.env.DB.prepare("SELECT r.*, a.period FROM awards a JOIN repos r ON r.id = a.repo_id WHERE a.kind = 'day' AND a.rank = 1 ORDER BY a.period DESC LIMIT 1").first<RepoRow & { period: string }>() : null;
  return respond(c, { rows, page, hasMore, votes, winner }, {
    json: (d) => ({ ...feedJson(d.rows, d.page, d.hasMore), title: opts.title, extra: opts.extra }),
    md: (d) => feedMd(opts.heading, d.rows, d.page, d.hasMore, opts.intro),
    html: (d) => (
      <Layout meta={{ title: opts.title, description: opts.description ?? opts.intro ?? SITE.tagline }} user={user} url={url} sort={opts.showHero ? opts.sort : undefined} q={opts.q} tags={rail.tags}>
        <section>
          {opts.showHero ? (
            <>
              <div class="hero">
                <div style="font-size:48px" aria-hidden="true">🐷</div>
                <div><h1>SlopScore — {SITE.tagline}</h1><p><em>{SITE.slogan}</em> {SITE.description} A public leaderboard for AI-generated software: opt in by committing one file, humans and agents grade it.</p></div>
              </div>
              <div class="manifesto"><strong>Why public?</strong> {SITE.manifesto}</div>
              {d.winner ? (
                <div class="strip"><span class="stamp">Certified Slop of the Day · {d.winner.period}</span> <a href={`/r/${d.winner.full_name}`}><strong>{d.winner.title ?? d.winner.name}</strong></a> <span class="muted">— {d.winner.tagline}</span> <span class="muted">· score {d.winner.score}</span></div>
              ) : null}
            </>
          ) : <h2 style="margin:8px 0">{opts.heading}</h2>}
          {opts.intro && !opts.showHero ? <p class="muted">{opts.intro}</p> : null}
          {opts.showHero || opts.sort !== "hot" ? (
            <div class="muted" style="margin:4px 0">
              sort: {SORTS.filter((s) => s !== "upcoming").map((s) => <a href={`${opts.baseUrl}${opts.baseUrl.includes("?") ? "&" : "?"}sort=${s}`} class={s === opts.sort ? "chip ok" : "chip"}>{s}</a>)}
              {opts.sort === "top" || opts.sort === "controversial" ? <> · window: {["day", "week", "month", "year", "all"].map((w) => <a href={`${opts.baseUrl}${opts.baseUrl.includes("?") ? "&" : "?"}sort=${opts.sort}&t=${w}`} class={w === (opts.t ?? "all") ? "chip ok" : "chip"}>{w}</a>)}</> : null}
            </div>
          ) : null}
          <FeedList rows={d.rows} page={d.page} hasMore={d.hasMore} votes={d.votes} user={user} baseUrl={opts.baseUrl + (opts.baseUrl.includes("?") ? "&" : "?") + `sort=${opts.sort}${opts.t ? `&t=${opts.t}` : ""}`} empty={opts.empty} showStatus={opts.showStatus} />
        </section>
        <Rail data={rail} />
      </Layout>
    ),
  });
}

// ---- / ----
pages.get("/", (c) => {
  const sort = sortParam(c.req.query("sort"));
  if (sort === "upcoming") return c.redirect("/upcoming");
  return feedPage(c, { title: `SlopScore — ${SITE.tagline}`, heading: "SlopScore — the feed", sort, t: c.req.query("t"), page: Number(c.req.query("page") ?? 1), baseUrl: "/", showHero: true, description: `${SITE.slogan} ${SITE.description}`, intro: SITE.manifesto });
});

pages.get("/upcoming", (c) => feedPage(c, {
  title: "Up and coming slop", heading: "Up and coming", sort: "upcoming", page: Number(c.req.query("page") ?? 1), baseUrl: "/upcoming",
  intro: "Listed repos whose authors admit they're not done: idea, prototype, works-on-my-machine, alpha. Once submitted they compete for Most Promising Slop of the Week.",
  empty: "Nobody is working on anything. Suspicious.",
}));

pages.get("/search", (c) => {
  const q = c.req.query("q") ?? "";
  const parsed = parseQuery(q);
  const sort = sortParam(c.req.query("sort") ?? "top");
  return feedPage(c, {
    title: `search: ${q} — SlopScore`, heading: `Search: ${q}`, sort, t: c.req.query("t"), page: Number(c.req.query("page") ?? 1),
    filters: parsed.filters, match: parsed.match, baseUrl: `/search?q=${encodeURIComponent(q)}`, q,
    intro: parsed.terms.length ? `Parsed as: ${parsed.terms.join(" ")}` : "Operators: category: lang: tool: model: platform: interface: audience: data: human: ai: status: tag: topic: license: owner: — prefix with - to exclude.",
    empty: "Nothing matches. Either it doesn't exist or nobody admitted to it.", extra: { parsed },
  });
});

pages.get("/f/:facet/:value", async (c) => {
  const facet = c.req.param("facet"); const value = c.req.param("value").toLowerCase();
  const known = [...DECLARED_FACETS, ...DETECTED_FACETS] as readonly string[];
  if (!known.includes(facet)) return c.notFound();
  const siblings = await facetCounts(c.env.DB, facet, 30);
  return feedPage(c, {
    title: `${facet}: ${value} — SlopScore`, heading: `${facet} = ${value}`, sort: sortParam(c.req.query("sort") ?? "top"), t: c.req.query("t"), page: Number(c.req.query("page") ?? 1),
    filters: [{ facet, value, negate: false }], baseUrl: `/f/${facet}/${value}`,
    intro: `Other ${facet} values: ${siblings.filter((s) => s.value !== value).slice(0, 15).map((s) => `${s.value} (${s.n})`).join(", ")}`, extra: { facet, value, siblings },
  });
});

pages.get("/t", async (c) => {
  const user = c.get("user"); const url = new URL(c.req.url);
  const tags = await curatedTags(c.env.DB);
  const free = await facetCounts(c.env.DB, "tags", 60);
  return respond(c, { tags, free }, {
    json: (d) => ({ curated: d.tags, free: d.free }),
    md: (d) => ["# Tags", "", "Subreddit-style feeds. A repo lands in s/<tag> when any of its category, tags, domain, or GitHub topics match.", "", ...d.tags.map((t) => `- [s/${t.slug}](/t/${t.slug}) — ${t.title}: ${t.blurb ?? ""} (${t.n})`), "", "## Free tags", "", d.free.map((f) => `[${f.value}](/t/${f.value}) (${f.n})`).join(" · ")].join("\n"),
    html: (d) => (
      <Layout meta={{ title: "Tags — SlopScore" }} user={user} url={url} tags={d.tags}>
        <section class="wrap narrow" style="padding:0">
          <h2>Tags</h2>
          <p class="muted">Subreddit-style feeds. A repo lands in <code>s/tag</code> when any of its category, tags, domain, or GitHub topics match. Curated tags are seeded; everything else is whatever slopsmiths wrote in <code>tags:</code>.</p>
          <table class="list"><tr><th>tag</th><th>what goes here</th><th>slop</th></tr>
            {d.tags.map((t) => <tr><td><a href={`/t/${t.slug}`}><strong>s/{t.slug}</strong></a></td><td>{t.title} <span class="muted">— {t.blurb}</span></td><td>{t.n}</td></tr>)}
          </table>
          <h3>Free tags</h3>
          <p>{d.free.map((f) => <a class="chip" href={`/t/${f.value}`}>{f.value} ({f.n})</a>)}</p>
        </section>
      </Layout>
    ),
  });
});

pages.get("/t/:tag", async (c) => {
  const slug = c.req.param("tag").toLowerCase();
  const tag = await getTag(c.env.DB, slug);
  return feedPage(c, {
    title: `s/${slug} — ${tag?.title ?? slug} — SlopScore`, heading: `s/${slug}${tag ? ` · ${tag.title}` : ""}`, sort: sortParam(c.req.query("sort") ?? "hot"), t: c.req.query("t"), page: Number(c.req.query("page") ?? 1),
    tag: slug, baseUrl: `/t/${slug}`, intro: tag?.blurb ?? `Everything tagged ${slug} by category, tag, domain, or GitHub topic.`, extra: { tag: tag ?? { slug, curated: 0 } },
    empty: `No slop in s/${slug} yet. Be the first slopsmith.`,
  });
});

pages.get("/u/:login", async (c) => {
  const login = c.req.param("login");
  const u = await getUserByLogin(c.env.DB, login);
  return feedPage(c, {
    title: `${login} — SlopScore`, heading: `Slop by ${login}`, sort: sortParam(c.req.query("sort") ?? "new"), page: Number(c.req.query("page") ?? 1),
    owner: login, status: ["listed", "discovered", "quarantined", "rejected"], baseUrl: `/u/${login}`, showStatus: true,
    intro: u ? `Slopsmith since ${isoDate(u.created_at)}${u.banned_at ? " · banned" : ""}. github.com/${login}` : `github.com/${login} — not a slopsmith (yet).`, extra: { user: u ? { id: u.id, login: u.login, avatar_url: u.avatar_url } : null },
    empty: "No slop from this account. Yet.",
  });
});

pages.get("/queue", (c) => {
  const st = c.req.query("status");
  const statuses: RepoRow["status"][] = st === "rejected" ? ["rejected"] : st === "hidden" ? ["hidden"] : st === "quarantined" ? ["quarantined"] : st === "delisted" ? ["delisted"] : st === "discovered" ? ["discovered"] : ["discovered", "quarantined", "rejected"];
  return feedPage(c, {
    title: "The trough — moderation queue", heading: "In the trough", sort: "new", page: Number(c.req.query("page") ?? 1), status: statuses, baseUrl: `/queue${st ? `?status=${st}` : ""}`, showStatus: true,
    intro: "Everything the crawler found that isn't listed yet, and why: awaiting scan, AI budget spent, awaiting human review, or rejected under a policy. Nothing here is votable; everything is readable and reportable. Rejected repos re-enter detection when the owner presses Refresh or anyone pings them after a fix. Filter: ?status=discovered|quarantined|rejected|hidden|delisted",
    empty: "The trough is empty. The inspector is bored.",
  });
});

pages.get("/best", async (c) => {
  const kind = c.req.query("kind") === "week" ? "week" : c.req.query("kind") === "upcoming-week" ? "upcoming-week" : "day";
  const period = c.req.query("period");
  const user = c.get("user"); const url = new URL(c.req.url);
  const rows = await c.env.DB.prepare(
    `SELECT r.*, a.period, a.rank FROM awards a JOIN repos r ON r.id = a.repo_id WHERE a.kind = ? ${period ? "AND a.period = ?" : ""} ORDER BY a.period DESC, a.rank ASC LIMIT 100`,
  ).bind(...(period ? [kind, period] : [kind])).all<RepoRow & { period: string; rank: number }>().then((r) => r.results ?? []);
  const votes = user ? await userVotesFor(c.env.DB, user.id, rows.map((r) => r.id)) : new Map<number, number>();
  const rail = await railData(c.env.DB);
  return respond(c, { rows }, {
    json: (d) => ({ kind, period: period ?? null, winners: d.rows.map((r) => ({ period: r.period, rank: r.rank, ...repoJson(r) })) }),
    md: (d) => feedMd(`Winners — ${kind}${period ? ` ${period}` : ""}`, d.rows, 1, false),
    html: (d) => (
      <Layout meta={{ title: `Winners — Slop of the ${kind} — SlopScore` }} user={user} url={url}>
        <section>
          <h2>🏆 Certified Slop of the {kind === "day" ? "Day" : kind === "week" ? "Week" : "Week (Most Promising)"}</h2>
          <p class="muted">Only submitted repos compete. <a href="/best?kind=day">day</a> · <a href="/best?kind=week">week</a> · <a href="/best?kind=upcoming-week">most promising</a></p>
          {d.rows.length === 0 ? <div class="empty">No winners yet. The awards cron runs at 00:05 UTC.</div> : null}
          {Object.entries(groupBy(d.rows, (r) => r.period)).map(([p, rs]) => (
            <>
              <h3>{p}</h3>
              <FeedList rows={rs} page={1} hasMore={false} votes={votes} user={user} baseUrl={`/best?kind=${kind}&period=${p}`} />
            </>
          ))}
        </section>
        <Rail data={rail} />
      </Layout>
    ),
  });
});

pages.get("/tools", async (c) => {
  const user = c.get("user"); const url = new URL(c.req.url);
  const rows = await c.env.DB.prepare(
    `SELECT rt.value, count(*) AS n, round(avg(r.score), 2) AS mean, max(r.score) AS best,
       (SELECT r2.full_name FROM repo_tags t2 JOIN repos r2 ON r2.id = t2.repo_id WHERE t2.facet = 'built_with' AND t2.value = rt.value AND r2.status = 'listed' ORDER BY r2.score DESC LIMIT 1) AS best_repo
     FROM repo_tags rt JOIN repos r ON r.id = rt.repo_id WHERE rt.facet = 'built_with' AND r.status = 'listed' GROUP BY rt.value ORDER BY mean DESC, n DESC`,
  ).all<{ value: string; n: number; mean: number; best: number; best_repo: string }>().then((r) => r.results ?? []);
  return respond(c, { rows }, {
    json: (d) => ({ facet: "built_with", leaderboard: d.rows }),
    md: (d) => ["# Which AI produces the best slop?", "", "| tool | listings | mean score | best |", "|---|---|---|---|", ...d.rows.map((r) => `| ${r.value} | ${r.n} | ${r.mean} | [${r.best_repo}](/r/${r.best_repo}) (${r.best}) |`)].join("\n"),
    html: (d) => (
      <Layout meta={{ title: "Built with — which AI produces the best slop? — SlopScore" }} user={user} url={url}>
        <section class="wrap narrow" style="padding:0">
          <h2>Which AI produces the best slop?</h2>
          <p class="muted">Mean score of listed repos by declared <code>built_with</code>. Small samples lie; that's part of the fun.</p>
          <table class="list"><tr><th>#</th><th>tool</th><th>listings</th><th>mean score</th><th>best</th></tr>
            {d.rows.map((r, i) => <tr><td>{i + 1}</td><td><a href={`/f/built_with/${r.value}`}>{r.value}</a></td><td>{r.n}</td><td>{r.mean}</td><td><a href={`/r/${r.best_repo}`}>{r.best_repo}</a> ({r.best})</td></tr>)}
          </table>
        </section>
      </Layout>
    ),
  });
});

pages.get("/log", async (c) => {
  const user = c.get("user"); const url = new URL(c.req.url);
  const rows = await c.env.DB.prepare("SELECT * FROM mod_log ORDER BY created_at DESC LIMIT 200").all<{ id: number; actor_login: string; actor_role: string; action: string; target_type: string; target_id: number; target_label: string | null; note: string | null; created_at: number }>().then((r) => r.results ?? []);
  return respond(c, { rows }, {
    json: (d) => ({ log: d.rows }),
    md: (d) => ["# Moderation log", "", ...d.rows.map((r) => `- ${isoDate(r.created_at)} **${r.actor_login}** (${r.actor_role}) ${r.action} ${r.target_type} ${r.target_label ?? r.target_id}${r.note ? ` — ${r.note}` : ""}`)].join("\n"),
    html: (d) => (
      <Layout meta={{ title: "Moderation log — SlopScore" }} user={user} url={url}>
        <section class="wrap narrow" style="padding:0">
          <h2>Moderation log</h2>
          <p class="muted">Every admin and owner action, in public. Nothing here is a secret.</p>
          <table class="list"><tr><th>when</th><th>who</th><th>action</th><th>target</th><th>note</th></tr>
            {d.rows.map((r) => <tr><td title={isoDate(r.created_at)}>{ago(r.created_at)}</td><td><a href={`/u/${r.actor_login}`}>{r.actor_login}</a> <span class="muted">{r.actor_role}</span></td><td>{r.action}</td><td>{r.target_type === "repo" && r.target_label ? <a href={`/r/${r.target_label}`}>{r.target_label}</a> : `${r.target_type} ${r.target_id}`}</td><td class="muted">{r.note}</td></tr>)}
          </table>
          {d.rows.length === 0 ? <div class="empty">Nothing has needed moderating. Suspicious.</div> : null}
        </section>
      </Layout>
    ),
  });
});

pages.get("/stats", async (c) => {
  const user = c.get("user"); const url = new URL(c.req.url);
  const [stats, daily, byStatus] = await Promise.all([
    siteStats(c.env.DB),
    c.env.DB.prepare("SELECT * FROM stats_daily ORDER BY date DESC LIMIT 30").all<Record<string, number | string>>().then((r) => r.results ?? []),
    c.env.DB.prepare("SELECT status, count(*) AS n FROM repos GROUP BY status").all<{ status: string; n: number }>().then((r) => r.results ?? []),
  ]);
  const budget = Number(c.env.AI_NEURON_BUDGET || 9000);
  return respond(c, { stats, daily, byStatus, budget }, {
    md: (d) => ["# Stats", "", ...d.byStatus.map((s) => `- ${s.status}: ${s.n}`), "", `AI neuron budget/day: ${d.budget}`, "", "| date | neurons | scans | deferred | found | listed | rejected | quarantined |", "|---|---|---|---|---|---|---|---|", ...d.daily.map((r) => `| ${r.date} | ${r.neurons_used}/${r.neurons_budget} | ${r.scans} | ${r.deferred} | ${r.found} | ${r.listed} | ${r.rejected} | ${r.quarantined} |`)].join("\n"),
    html: (d) => (
      <Layout meta={{ title: "Stats — SlopScore" }} user={user} url={url}>
        <section class="wrap narrow" style="padding:0">
          <h2>Stats</h2>
          <p class="muted">This site runs on Cloudflare's free tier on purpose. When the "deferred" column grows day over day, the AI budget is the bottleneck and it's time to pay.</p>
          <table class="stats">{d.byStatus.map((s) => <tr><td>{s.status}</td><td>{s.n}</td></tr>)}<tr><td>slopsmiths</td><td>{d.stats.users}</td></tr><tr><td>votes</td><td>{d.stats.votes}</td></tr><tr><td>comments</td><td>{d.stats.comments}</td></tr></table>
          <h3>Last 30 days</h3>
          <table class="list"><tr><th>date</th><th>AI neurons</th><th>scans</th><th>deferred</th><th>found</th><th>listed</th><th>rejected</th><th>quarantined</th></tr>
            {d.daily.map((r) => <tr><td>{r.date}</td><td>{r.neurons_used} / {r.neurons_budget || d.budget}</td><td>{r.scans}</td><td>{r.deferred}</td><td>{r.found}</td><td>{r.listed}</td><td>{r.rejected}</td><td>{r.quarantined}</td></tr>)}
          </table>
          {d.daily.length === 0 ? <div class="empty">No days recorded yet. The crons write one row per UTC day.</div> : null}
        </section>
      </Layout>
    ),
  });
});

pages.get("/spec", (c) => {
  const user = c.get("user"); const url = new URL(c.req.url);
  const v = vocabJson();
  const md = [
    "# slopscore.md — the contract (v1)", "",
    "Principle: the file only holds what GitHub can't tell us. Name, description, topics, language, license, stars, README, and release come from the API.", "",
    "Missing or invalid **disclosure** fields reject the repo with the reason shown publicly on its page. Fix the file, then `curl /ping/owner/repo` (or press Refresh if you own it).", "",
    "## Minimal file", "", "```yaml", MINIMAL_EXAMPLE.trim(), "```", "",
    "## Required (disclosures)", "",
    ...["slopscore: 1 (spec version)", `ai_generated: ${v.controlled.ai_generated.join(" | ")}`, `human_touch: ${v.controlled.human_touch.join(" | ")}`, "content_rating: everyone (mature | adult are rejected)",
      `contains: list, may be empty. Listed with a chip: ${v.contains.listed.join(", ")}. Rejected: ${v.contains.rejected.join(", ")}.`, `category: ≥ 1 of ${v.controlled.category.join(", ")}`, `status: ${v.controlled.status.join(" | ")}`,
      "tagline: ≤ 140 chars, or a GitHub description (rejected only if both are empty)"].map((x) => `- ${x}`), "",
    "## Optional facets (unknown values never reject; they're kept as free tags marked unrecognized)", "",
    ...["title, tagline, demo_url — override GitHub", `built_with: ${v.controlled.built_with.join(", ")}`, "models: free", `interface: ${v.controlled.interface.join(", ")}`, "frameworks: free (aliases normalized: next.js→nextjs)", `platforms: ${v.controlled.platforms.join(", ")}`,
      `audience: ${v.controlled.audience.join(", ")}`, `data: ${v.controlled.data.join(", ")}`, "needs: free (external accounts/keys)", "domain: free (subject matter)", "tags: free, ≤ 20; GitHub topics are merged in as detected",
      "images: explicit repo-relative image paths (else slopscore-1.png … slopscore-6.png at the root are auto-discovered)", "maintainers: GitHub logins who get owner controls on the site (the only way for an org-owned repo)", "unlisted: true — delist on next check without logging in", "x-anything: preserved verbatim, never validated"].map((x) => `- ${x}`), "",
    "## Body", "", "Optional markdown after the frontmatter, ≤ 4000 chars: the pitch. If empty, the README is the pitch.", "",
    "## Aliases", "", ...Object.entries(v.aliases).map(([k, val]) => `- ${k} → ${val}`), "",
    "## Search operators", "", Object.keys(v.search_operators).map((k) => `${k}:`).join(" "), " — prefix with `-` to exclude. Quotes for phrases.", "",
    "Machine-readable: `/api/v1/vocab`.",
  ].join("\n");
  return respond(c, { md, vocab: v }, {
    json: (d) => d.vocab,
    md: (d) => d.md,
    html: (d) => <Layout meta={{ title: "slopscore.md spec — SlopScore" }} user={user} url={url}><section class="wrap narrow" style="padding:0">{(() => { const html = renderMarkdown(d.md); return <div dangerouslySetInnerHTML={{ __html: html }} />; })()}</section></Layout>,
  });
});

pages.get("/about", (c) => {
  const user = c.get("user"); const url = new URL(c.req.url);
  const md = [
    "# About SlopScore", "", `**${SITE.tagline}**`, "", SITE.manifesto, "",
    "SlopScore is a public, tongue-in-cheek leaderboard for AI-generated software. A repo owner opts in by committing a `slopscore.md` file. A crawler finds it, checks the disclosures, runs content gates, and lists it. GitHub-authenticated humans and agents (we call them slopsmiths) upvote, downvote, comment, and (quietly) report.", "",
    "## What we store", "", "Only our own database: listings, votes, comments, reports, and the moderation log. GitHub owns identity, code, images, and the marker file. Log in with GitHub; we keep your id, login, and avatar, and discard the token.", "",
    "## Transparency", "", "Every status has a public reason. The scan report is on every repo page. The [moderation log](/log) is public. The [queue](/queue) is public. The [stats](/stats) are public, including how close the site is to its free-tier limits. The [source](https://github.com/NTBooks/slopscore) is public.", "",
    "## Tiers", "", "A repo the crawler finds is **found**: listed and votable, with an *unclaimed* chip. When the owner logs in and presses Submit it becomes **submitted**: a launch, eligible for Slop of the Day and the weekly awards. Votes carry over.", "",
    "## Votes", "", "Only logged-in slopsmiths vote. Votes are weighted by account trust derived from GitHub (age, public repos, followers), rate-limited per account and per network, and bursts from same-week accounts or one network count for nothing. Displayed scores are lightly fuzzed so bots can't tell whether they counted. This is roughly how Reddit does it; the knobs are public in the repo.", "",
    "## Moderation", "", "Cheapest first: GitHub's own enforcement, a denylist, a risk score that quarantines suspicious repos for a human, Safe Browsing, Llama Guard on the text and a vision check on the thumbnail, community reports with auto-hide, then admins. Nothing is votable until it's listed.", "",
    "## For agents", "", "Append `.json` or `.md` to any page. See [/llms.txt](/llms.txt), [/openapi.json](/openapi.json), and the MCP server at `/mcp`.",
  ].join("\n");
  return respond(c, { md }, {
    json: (d) => ({ about: d.md }),
    md: (d) => d.md,
    html: (d) => <Layout meta={{ title: "About — SlopScore" }} user={user} url={url}><section class="wrap narrow" style="padding:0"><div dangerouslySetInnerHTML={{ __html: renderMarkdown(d.md) }} /></section></Layout>,
  });
});

// ---- /ping ----
pages.get("/ping/:owner/:name", async (c) => {
  const o = c.req.param("owner"); const n = c.req.param("name").replace(/\.git$/, "");
  const ip = c.req.header("cf-connecting-ip") ?? "local";
  if (!(await rateLimit(c.env.DB, `ping:${o}/${n}`.toLowerCase(), 1, 600)) || !(await rateLimit(c.env.DB, `ping-ip:${ip}`, 10, 600))) {
    const existing = await getRepo(c.env.DB, o, n);
    return c.json({ ok: false, error: "pinged recently; try again in 10 minutes", status: existing?.status ?? null, url: existing ? `/r/${existing.full_name}` : null }, 429);
  }
  const gh = new GitHub(c.env.GITHUB_CRAWL_TOKEN);
  const res = await scanRepo(c.env.DB, gh, o, n);
  if (!res.repo) return c.json({ ok: false, error: (res.outcome as { error: string }).error, hint: "Commit a slopscore.md to the root of the default branch. Spec: /spec" }, 404);
  const r = res.repo;
  return c.json({ ok: r.status === "listed", status: r.status, tier: r.tier, url: `/r/${r.full_name}`, reject_reason: r.reject_reason, scan: parseJson(r.scan, null) }, r.status === "listed" ? 200 : 202);
});

// ---- repo page ----
pages.get("/r/:owner/:name", async (c) => {
  const r = await getRepo(c.env.DB, c.req.param("owner"), c.req.param("name"));
  const user = c.get("user"); const url = new URL(c.req.url);
  if (!r) {
    return respond(c, { owner: c.req.param("owner"), name: c.req.param("name") }, {
      json: (d) => ({ error: "not listed", hint: `GET /ping/${d.owner}/${d.name} after committing slopscore.md` }),
      md: (d) => `# Not listed\n\nNo listing for ${d.owner}/${d.name}. Commit a slopscore.md then GET /ping/${d.owner}/${d.name}.`,
      html: (d) => <Layout meta={{ title: "Not listed — SlopScore", noindex: true }} user={user} url={url}><section class="wrap narrow" style="padding:0"><h2>Not listed</h2><p>No listing for <code>{d.owner}/{d.name}</code>. If the repo has a <code>slopscore.md</code>, <a href={`/ping/${d.owner}/${d.name}`}>ping it</a>. Otherwise, <a href="/spec">here's the spec</a>.</p></section></Layout>,
    }, 404);
  }
  const [tags, cs, awards, versions, mine] = await Promise.all([
    repoTags(c.env.DB, r.id), loadComments(c.env.DB, r.id), awardsFor(c.env.DB, r.id),
    c.env.DB.prepare("SELECT md_sha, seen_at, stars FROM repo_versions WHERE repo_id = ? ORDER BY seen_at DESC LIMIT 20").bind(r.id).all<{ md_sha: string | null; seen_at: number; stars: number | null }>().then((x) => x.results ?? []),
    user ? userVote(c.env.DB, user.id, r.id) : Promise.resolve(0),
  ]);
  const data: RepoPageData = { repo: r, tags, comments: cs, awards, versions, mine, user, isOwner: isOwnerOf(r, user?.login, user?.id), flash: c.req.query("flash") ?? null };
  return respond(c, data, {
    json: (d) => ({ ...repoJson(d.repo), tags: d.tags, awards: d.awards, versions: d.versions, scan: parseJson(d.repo.scan, null), body_md: d.repo.body_md, my_vote: d.mine, is_owner: d.isOwner,
      comments: d.comments.map((x) => ({ id: x.id, parent_id: x.parent_id, user: x.login, maker: x.user_id === d.repo.owner_id, body_md: x.deleted_at ? null : x.body_md, up: x.up, down: x.down, created_at: x.created_at })) }),
    md: (d) => repoMd(d.repo, d.tags, d.comments, d.awards),
    html: (d) => (
      <Layout meta={{ title: `${d.repo.title ?? d.repo.name} — SlopScore`, description: d.repo.tagline ?? undefined, image: ogImage(d.repo), noindex: d.repo.status !== "listed" }} user={user} url={url}>
        <RepoPage d={d} />
        <Rail data={{ stats: { listed: 0, queued: 0, users: 0, votes: 0, comments: 0 }, tools: [], tags: [] }} />
      </Layout>
    ),
  });
});

// ---- writes ----
pages.post("/r/:owner/:name/vote", requireUser, async (c) => {
  const user = c.get("user")!;
  const r = await getRepo(c.env.DB, c.req.param("owner"), c.req.param("name"));
  if (!r) return c.json({ error: "unknown repo" }, 404);
  if (r.status !== "listed") return c.json({ error: "not yet graded: voting opens once the repo is listed", status: r.status }, 409);
  if (!user.canWrite) return c.json({ error: `account too new to vote (needs ${c.env.MIN_ACCOUNT_AGE_DAYS} days or a public repo)` }, 403);
  const b = await body(c);
  const v = Number(b.value);
  if (![1, -1, 0].includes(v)) return c.json({ error: "value must be 1, -1, or 0" }, 400);
  if (!(await rateLimit(c.env.DB, `vote:${user.id}`, 60, 600))) return c.json({ error: "slow down" }, 429);
  const updated = await castVote(c.env.DB, user.row, r, v as -1 | 0 | 1, await ipHash(c.req.header("cf-connecting-ip"), c.env.SESSION_SECRET));
  if (updated.ring) await logAction(c.env.DB, { actor: "system", role: "system", action: "vote-ring-flag", targetType: "repo", targetId: r.id, label: r.full_name, note: updated.ring });
  if (wantsJson(c)) return c.json({ ok: true, score: updated.score, up: updated.up, down: updated.down, mine: v });
  return c.redirect(c.req.header("referer")?.startsWith(new URL(c.req.url).origin) ? c.req.header("referer")! : `/r/${r.full_name}`);
});

pages.post("/r/:owner/:name/comments", requireUser, async (c) => {
  const user = c.get("user")!;
  const r = await getRepo(c.env.DB, c.req.param("owner"), c.req.param("name"));
  if (!r) return c.json({ error: "unknown repo" }, 404);
  if (r.status !== "listed") return c.json({ error: "comments open once the repo is listed", status: r.status }, 409);
  if (!user.canWrite) return c.json({ error: "account too new to comment" }, 403);
  const b = await body(c);
  const text = (b.body ?? "").trim();
  if (!text || text.length > 4000) return c.json({ error: "body must be 1–4000 chars" }, 400);
  if ((text.match(/https?:\/\//g) ?? []).length > 2) return c.json({ error: "at most 2 links per comment" }, 400);
  if (!(await rateLimit(c.env.DB, `comment:${user.id}`, 10, 600))) return c.json({ error: "slow down" }, 429);
  const parent = b.parent_id ? Number(b.parent_id) : null;
  const id = await addComment(c.env.DB, r.id, user.id, parent, text, renderMarkdown(text));
  if (wantsJson(c)) return c.json({ ok: true, id, url: `/r/${r.full_name}#c${id}` }, 201);
  return c.redirect(`/r/${r.full_name}#c${id}`);
});

pages.post("/c/:id/vote", requireUser, async (c) => {
  const user = c.get("user")!;
  const id = Number(c.req.param("id"));
  const cm = await c.env.DB.prepare("SELECT c.id, r.full_name FROM comments c JOIN repos r ON r.id = c.repo_id WHERE c.id = ?").bind(id).first<{ id: number; full_name: string }>();
  if (!cm) return c.json({ error: "unknown comment" }, 404);
  const v = Number((await body(c)).value);
  if (![1, -1, 0].includes(v)) return c.json({ error: "value must be 1, -1, or 0" }, 400);
  const res = await castCommentVote(c.env.DB, user.id, id, v as -1 | 0 | 1);
  if (wantsJson(c)) return c.json({ ok: true, ...res, mine: v });
  return c.redirect(`/r/${cm.full_name}#c${id}`);
});

const REASONS = new Set(["objectionable", "undisclosed", "malware", "spam", "not-slop", "other"]);
async function fileReport(c: Context<AppEnv>, targetType: "repo" | "comment", targetId: number, backTo: string) {
  const user = c.get("user")!;
  const b = await body(c);
  const reason = REASONS.has(b.reason) ? b.reason : "other";
  const note = (b.note ?? "").slice(0, 300);
  if (!(await rateLimit(c.env.DB, `report:${user.id}`, 10, 3600))) return c.json({ error: "slow down" }, 429);
  const ins = await c.env.DB.prepare("INSERT OR IGNORE INTO reports (target_type, target_id, user_id, reason, note) VALUES (?,?,?,?,?)").bind(targetType, targetId, user.id, reason, note).run();
  if (ins.meta.changes && targetType === "repo") {
    const threshold = Number(c.env.AUTO_HIDE_REPORTS || 3);
    const cnt = await c.env.DB.prepare("UPDATE repos SET report_count = (SELECT count(*) FROM reports WHERE target_type = 'repo' AND target_id = ? AND resolved_at IS NULL) WHERE id = ? RETURNING report_count, status").bind(targetId, targetId).first<{ report_count: number; status: string }>();
    if (cnt && cnt.report_count >= threshold && cnt.status === "listed") {
      await c.env.DB.prepare("UPDATE repos SET status = 'hidden', queue_reason = 'reports' WHERE id = ?").bind(targetId).run();
      await logAction(c.env.DB, { actor: "system", role: "system", action: "auto-hide", targetType: "repo", targetId, note: `${cnt.report_count} reports` });
    }
  }
  if (wantsJson(c)) return c.json({ ok: true, duplicate: !ins.meta.changes });
  return c.redirect(`${backTo}?flash=${encodeURIComponent("Reported. Quietly. Thank you.")}`);
}
pages.post("/r/:owner/:name/report", requireUser, async (c) => {
  const r = await getRepo(c.env.DB, c.req.param("owner"), c.req.param("name"));
  if (!r) return c.json({ error: "unknown repo" }, 404);
  return fileReport(c, "repo", r.id, `/r/${r.full_name}`);
});
pages.post("/c/:id/report", requireUser, async (c) => {
  const id = Number(c.req.param("id"));
  const cm = await c.env.DB.prepare("SELECT c.id, r.full_name FROM comments c JOIN repos r ON r.id = c.repo_id WHERE c.id = ?").bind(id).first<{ id: number; full_name: string }>();
  if (!cm) return c.json({ error: "unknown comment" }, 404);
  return fileReport(c, "comment", id, `/r/${cm.full_name}`);
});

function groupBy<T>(arr: T[], key: (t: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const x of arr) (out[key(x)] ??= []).push(x);
  return out;
}

export { escapeHtml };
