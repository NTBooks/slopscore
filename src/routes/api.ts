// JSON API v1. Pages already answer as .json; this is the stable, documented surface with cursor pagination.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { feed, getRepo, repoTags, comments, facetCounts, siteStats, parseJson, parseSort, parsePage, type RepoRow } from "../lib/db";
import { cached } from "../lib/cache";
import { stripHtml } from "../lib/markdown";
import type { SlopMeta } from "../lib/slopmd";
import type { VulnSummary } from "../lib/osv";
import { parseQuery } from "../lib/searchquery";
import { UNTRUSTED_NOTE } from "../lib/untrusted";
import { vocabJson, DECLARED_FACETS, DETECTED_FACETS } from "../lib/vocab";
import { repoJson } from "./pages";

export const api = new Hono<AppEnv>();

api.use("*", async (c, next) => {
  await next();
  c.header("access-control-allow-origin", "*");
  c.header("cache-control", "public, max-age=60");
});

function paged(c: { req: { url: string } }, rows: RepoRow[], page: number, hasMore: boolean) {
  const u = new URL(c.req.url);
  u.searchParams.set("page", String(page + 1));
  return { page, has_more: hasMore, next: hasMore ? u.pathname + u.search : null, repos: rows.map(repoJson) };
}

api.get("/vocab", (c) => c.json(vocabJson()));

api.get("/facets", async (c) => {
  const facet = c.req.query("facet");
  const known = [...DECLARED_FACETS, ...DETECTED_FACETS] as readonly string[];
  if (!facet || !known.includes(facet)) return c.json({ error: "facet required", facets: known }, 400);
  return c.json({ facet, values: await facetCounts(c.env.DB, facet, Number(c.req.query("limit") ?? 100)) });
});

api.get("/repos", async (c) => {
  const status = (c.req.query("status") ?? "listed") as RepoRow["status"];
  const r = await feed(c.env.DB, { sort: parseSort(c.req.query("sort")), t: c.req.query("t"), page: parsePage(c.req.query("page")), status, owner: c.req.query("owner"), tier: c.req.query("tier") as "found" | "submitted" | undefined });
  const out = paged(c, r.rows, r.page, r.hasMore);
  if (out.next) c.header("Link", `<${out.next}>; rel="next"`);
  return c.json(out);
});

api.get("/repos/:owner/:name", async (c) => {
  const r = await getRepo(c.env.DB, c.req.param("owner"), c.req.param("name"));
  if (!r) return c.json({ error: "not listed", ping: `/ping/${c.req.param("owner")}/${c.req.param("name")}` }, 404);
  const tags = await repoTags(c.env.DB, r.id);
  return c.json({ ...repoJson(r), tags, body_md: r.body_md, scan: r.scan ? JSON.parse(r.scan) : null, _note: UNTRUSTED_NOTE });
});

api.get("/repos/:owner/:name/comments", async (c) => {
  const r = await getRepo(c.env.DB, c.req.param("owner"), c.req.param("name"));
  if (!r) return c.json({ error: "not listed" }, 404);
  const cs = await comments(c.env.DB, r.id);
  return c.json({ repo: r.full_name, _note: UNTRUSTED_NOTE, comments: cs.map((x) => ({ id: x.id, parent_id: x.parent_id, user: x.login, maker: x.user_id === r.owner_id, body_md: x.deleted_at ? null : x.body_md, up: x.up, down: x.down, created_at: x.created_at })) });
});

api.get("/search", async (c) => {
  const q = c.req.query("q") ?? "";
  const p = parseQuery(q);
  const r = await feed(c.env.DB, { sort: parseSort(c.req.query("sort"), "top"), t: c.req.query("t"), page: parsePage(c.req.query("page")), filters: p.filters, match: p.match });
  return c.json({ q, parsed: p, ...paged(c, r.rows, r.page, r.hasMore) });
});

api.get("/tags", async (c) => c.json({ tags: await facetCounts(c.env.DB, "tags", 200) }));

api.get("/leaderboard", async (c) => {
  const facet = c.req.query("facet") ?? "built_with";
  if (!(DECLARED_FACETS as readonly string[]).includes(facet)) return c.json({ error: "unknown facet" }, 400);
  const rows = await c.env.DB.prepare("SELECT rt.value, count(*) AS n, round(avg(r.score), 2) AS mean, max(r.score) AS best FROM repo_tags rt JOIN repos r ON r.id = rt.repo_id WHERE rt.facet = ? AND r.status = 'listed' GROUP BY rt.value ORDER BY mean DESC, n DESC").bind(facet).all();
  return c.json({ facet, leaderboard: rows.results ?? [] });
});

// The derived file: every listed repo in one cached response, so agents (our critics included) read once instead of crawling.
type DigestRow = Pick<RepoRow, "full_name" | "title" | "tagline" | "source" | "tier" | "license" | "stars" | "language" | "meta" | "body_md" | "readme_html" | "images" | "gh" | "score" | "critic_up" | "listed_at" | "md_updated_at">;
api.get("/digest", async (c) => {
  const since = Math.max(0, Math.floor(Number(c.req.query("since") ?? 0)) || 0);
  const repos = await cached(c.env.DB, `digest:${since}`, async () => {
    const rows = await c.env.DB.prepare(
      `SELECT full_name, title, tagline, source, tier, license, stars, language, meta, body_md, readme_html, images, gh, score, critic_up, listed_at, md_updated_at
       FROM repos WHERE status = 'listed' AND max(COALESCE(listed_at, 0), COALESCE(md_updated_at, 0)) >= ? ORDER BY source ASC, listed_at DESC LIMIT 1000`,
    ).bind(since).all<DigestRow>().then((r) => r.results ?? []);
    return rows.map((r) => {
      const m = parseJson<Partial<SlopMeta>>(r.meta, {});
      const gh = parseJson<{ vulns?: VulnSummary | null }>(r.gh, {});
      return {
        full_name: r.full_name, url: `/r/${r.full_name}`, github: `https://github.com/${r.full_name}`, title: r.title, tagline: r.tagline,
        source: r.source, tier: r.tier, license: r.license, stars: r.stars, language: r.language, score: r.score, critic_up: r.critic_up,
        ai_generated: m.ai_generated ?? null, human_touch: m.human_touch ?? null, status: m.status ?? null,
        category: m.category ?? [], built_with: m.built_with ?? [], slopbucket: m.slopbucket ?? [],
        has_images: parseJson<unknown[]>(r.images, []).length > 0,
        vulns: gh.vulns ? { deps: gh.vulns.deps, vulnerable: gh.vulns.vulnerable } : null,
        pitch: (r.body_md ?? "").slice(0, 1500),
        readme: r.readme_html ? stripHtml(r.readme_html).replace(/\s+/g, " ").trim().slice(0, 1500) : "",
        listed_at: r.listed_at, md_updated_at: r.md_updated_at,
      };
    });
  });
  return c.json({ generated_at: Math.floor(Date.now() / 1000), since, count: repos.length, _note: UNTRUSTED_NOTE, repos });
});

api.get("/stats", async (c) => c.json(await siteStats(c.env.DB)));

api.get("/me", (c) => {
  const u = c.get("user");
  if (!u) return c.json({ error: "not logged in", login: "/auth/github", device: "/auth/device" }, 401);
  return c.json({ id: u.id, login: u.login, avatar_url: u.avatar_url, can_write: u.canWrite, is_admin: u.isAdmin });
});
