// RSS feeds, sitemap, and the OpenAPI document. All cached at the edge for 10 minutes.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { feed, sortOn, visibleSorts, type RepoRow, type Sort } from "../lib/db";
import { escapeHtml } from "../lib/markdown";
import { isoDateTime } from "../lib/time";
import { DECLARED_FACETS, DETECTED_FACETS } from "../lib/vocab";
import { trawlIndexed, trawlOwnerIndexed } from "../lib/virtual";

export const feeds = new Hono<AppEnv>();

function rss(origin: string, title: string, link: string, description: string, rows: RepoRow[], updated = false): string {
  const items = rows.map((r) => `
  <item>
    <title>${escapeHtml(r.title ?? r.name)} — ${escapeHtml(r.tagline ?? "")}</title>
    <link>${origin}/r/${r.full_name}</link>
    <guid isPermaLink="true">${origin}/r/${r.full_name}${updated ? `#v${r.md_updated_at ?? ""}` : ""}</guid>
    <pubDate>${new Date(((updated ? r.md_updated_at : r.listed_at) ?? r.first_seen) * 1000).toUTCString()}</pubDate>
    <author>${escapeHtml(r.owner)}</author>
    <description>${escapeHtml(`${r.tagline ?? ""} · score ${r.score} · ★${r.stars}${r.language ? ` · ${r.language}` : ""} · github.com/${r.full_name}`)}</description>
  </item>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${escapeHtml(title)}</title>
  <link>${origin}${link}</link>
  <atom:link href="${origin}${link}.xml" rel="self" type="application/rss+xml"/>
  <description>${escapeHtml(description)}</description>
  <language>en</language>${items}
</channel>
</rss>`;
}

const send = (c: { body: (b: string, s: 200, h: Record<string, string>) => Response }, xml: string) =>
  c.body(xml, 200, { "content-type": "application/rss+xml; charset=utf-8", "cache-control": "public, max-age=600" });

feeds.get("/feed.xml", async (c) => {
  const origin = new URL(c.req.url).origin;
  const sort = (c.req.query("sort") === "updated" ? "updated" : "new") as Sort;
  const { rows } = await feed(c.env.DB, { sort, page: 1, source: "marker" }); // trawled listings never go out in feeds
  return send(c, rss(origin, sort === "updated" ? "SlopScupper — updated slop" : "SlopScupper — new slop", "/feed", "Give me your slop! Peer review for code nobody wrote.", rows, sort === "updated"));
});

// The trawl gets a channel of its own rather than a share of /feed.xml. Anyone who wants to write about what
// the Cap'm dragged in can watch exactly that, and the main feed stays what it is: repos whose owners opted in,
// not buried under a hundred that did not. This is also the feed to hand a third party: everything in it is a
// public repo whose owner said in public that a model wrote it, and every item links a listing that can be
// taken down without an account.
feeds.get("/trawl.xml", async (c) => {
  const origin = new URL(c.req.url).origin;
  const { rows } = await feed(c.env.DB, { sort: "new", page: 1, source: "trawl" });
  return send(c, rss(origin, "SlopScupper — the Cap'm's hauls", "/trawl", "Repos the trawl found: public, AI-made by their owner's own account, and listed without being submitted. Any of them can be taken down from its page with no account.", rows));
});

feeds.get("/b/:file", async (c, next) => {
  if (!c.req.param("file").endsWith(".xml")) return next();
  const origin = new URL(c.req.url).origin;
  const slug = c.req.param("file").replace(/\.xml$/, "").toLowerCase();
  const { rows } = await feed(c.env.DB, { sort: "new", page: 1, tag: slug, source: "marker" });
  return send(c, rss(origin, `SlopScupper — b/${slug}`, `/b/${slug}`, `New slop in the ${slug} bucket.`, rows));
});

feeds.get("/f/:facet/:file", async (c, next) => {
  if (!c.req.param("file").endsWith(".xml")) return next();
  const origin = new URL(c.req.url).origin;
  const facet = c.req.param("facet"); const value = c.req.param("file").replace(/\.xml$/, "").toLowerCase();
  if (!([...DECLARED_FACETS, ...DETECTED_FACETS] as readonly string[]).includes(facet)) return c.notFound();
  const { rows } = await feed(c.env.DB, { sort: "new", page: 1, filters: [{ facet, value, negate: false }], source: "marker" });
  return send(c, rss(origin, `SlopScupper — ${facet}: ${value}`, `/f/${facet}/${value}`, `New slop with ${facet} = ${value}.`, rows));
});

feeds.get("/u/:file", async (c, next) => {
  if (!c.req.param("file").endsWith(".xml")) return next();
  const origin = new URL(c.req.url).origin;
  const login = c.req.param("file").replace(/\.xml$/, "");
  const { rows } = await feed(c.env.DB, { sort: "new", page: 1, owner: login, source: "marker" });
  return send(c, rss(origin, `SlopScupper — ${login}`, `/u/${login}`, `Slop by ${login}.`, rows));
});

feeds.get("/sitemap.xml", async (c) => {
  const origin = new URL(c.req.url).origin;
  // Trawled listings follow TRAWL_INDEX: a page we keep out of search has no business in the sitemap either.
  const indexed = trawlIndexed(c.env);
  const onlyOptedIn = indexed ? "" : " AND source = 'marker'";
  const onlyOptedInR = indexed ? "" : " AND r.source = 'marker'";
  // Owner pages answer to their own switch (see trawlOwnerIndexed): a handle is a person, not a project.
  const onlyOptedInOwners = trawlOwnerIndexed(c.env) ? onlyOptedIn : " AND source = 'marker'";
  const repos = await c.env.DB.prepare(`SELECT full_name, md_updated_at, listed_at FROM repos WHERE status = 'listed'${onlyOptedIn} ORDER BY listed_at DESC LIMIT 5000`).all<{ full_name: string; md_updated_at: number | null; listed_at: number | null }>().then((r) => r.results ?? []);
  const buckets = await c.env.DB.prepare("SELECT slug FROM tags WHERE banned = 0").all<{ slug: string }>().then((r) => r.results ?? []);
  // owner pages: someone searching their own GitHub handle should land on their listings
  const owners = await c.env.DB.prepare(`SELECT DISTINCT owner FROM repos WHERE status = 'listed'${onlyOptedInOwners} ORDER BY owner LIMIT 2000`).all<{ owner: string }>().then((r) => r.results ?? []);
  // Facet feeds are the long tail: "claude code slop", "python slop" and the like are what people actually
  // type, and each one is a real page with its own rows. Only facets with enough repos to be worth a visit.
  const facets = await c.env.DB.prepare(
    `SELECT rt.facet AS facet, rt.value AS value, count(*) AS n FROM repo_tags rt JOIN repos r ON r.id = rt.repo_id WHERE r.status = 'listed'${onlyOptedInR} AND rt.facet IN ('built_with','language','category','model','platform') GROUP BY rt.facet, rt.value HAVING n >= 2 ORDER BY n DESC LIMIT 200`,
  ).all<{ facet: string; value: string }>().then((r) => r.results ?? []);
  const fixed = ["/", ...(sortOn("upcoming") ? ["/upcoming"] : []), "/queue", "/best", "/tools", "/b", "/about", "/orphanage", "/spec", "/disclosure", "/for-agents", "/skill", "/stats", "/log", "/balcony", "/scan", "/contact"];
  const url = (loc: string, lastmod?: number | null, pri = "0.5") => `<url><loc>${origin}${loc}</loc>${lastmod ? `<lastmod>${isoDateTime(lastmod).slice(0, 10)}</lastmod>` : ""}<priority>${pri}</priority></url>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${fixed.map((p) => url(p, null, p === "/" ? "1.0" : "0.6")).join("\n")}
${buckets.map((b) => url(`/b/${b.slug}`, null, "0.5")).join("\n")}
${owners.map((o) => url(`/u/${o.owner}`, null, "0.4")).join("\n")}
${facets.map((f) => url(`/f/${f.facet}/${encodeURIComponent(f.value)}`, null, "0.4")).join("\n")}
${repos.map((r) => url(`/r/${r.full_name}`, r.md_updated_at ?? r.listed_at, "0.7")).join("\n")}
</urlset>`;
  return c.body(xml, 200, { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" });
});

feeds.get("/openapi.json", (c) => {
  const origin = new URL(c.req.url).origin;
  const repo = { type: "object", properties: { full_name: { type: "string" }, url: { type: "string" }, github: { type: "string" }, title: { type: "string" }, tagline: { type: "string", nullable: true }, status: { type: "string", enum: ["discovered", "quarantined", "rejected", "listed", "hidden", "delisted"] }, tier: { type: "string", enum: ["found", "submitted"] }, score: { type: "integer" }, up: { type: "integer" }, down: { type: "integer" }, stars: { type: "integer" }, language: { type: "string", nullable: true }, meta: { type: "object", nullable: true, description: "parsed slopscore.md frontmatter" }, reject_reason: { type: "string", nullable: true }, source: { type: "string", enum: ["marker", "trawl"], description: "trawl = the owner never opted in; paperwork written by the Cap'm" }, critic_up: { type: "integer", description: "upvotes from disclosed agent critics" } } };
  const feedResp = { description: "a page of repos", content: { "application/json": { schema: { type: "object", properties: { page: { type: "integer" }, has_more: { type: "boolean" }, next: { type: "string", nullable: true }, repos: { type: "array", items: { $ref: "#/components/schemas/Repo" } } } } } } };
  const bearer = [{ bearerAuth: [] }];
  const okJson = (desc: string) => ({ description: desc, content: { "application/json": { schema: { type: "object" } } } });
  const doc = {
    openapi: "3.1.0",
    info: { title: "SlopScupper API", version: "1.0.0", description: "Give me your slop! Peer review for code nobody wrote. Every HTML page is also available as .json and .md. Writes need a bearer token from the GitHub device flow (POST /auth/device/start). See /llms.txt." },
    servers: [{ url: origin }],
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", description: "token from POST /auth/device/poll" } },
      schemas: { Repo: repo },
    },
    paths: {
      "/api/v1/repos": { get: { summary: "The feed", parameters: [
        { name: "sort", in: "query", schema: { type: "string", enum: visibleSorts() } },
        { name: "t", in: "query", schema: { type: "string", enum: ["day", "week", "month", "year", "all"] } },
        { name: "page", in: "query", schema: { type: "integer" } }, { name: "status", in: "query", schema: { type: "string" } }, { name: "owner", in: "query", schema: { type: "string" } }, { name: "tier", in: "query", schema: { type: "string" } },
      ], responses: { "200": feedResp } } },
      "/api/v1/repos/{owner}/{repo}": { get: { summary: "One listing with tags, scan report, body", parameters: [{ name: "owner", in: "path", required: true, schema: { type: "string" } }, { name: "repo", in: "path", required: true, schema: { type: "string" } }], responses: { "200": okJson("the repo"), "404": okJson("not listed; ping it") } } },
      "/api/v1/repos/{owner}/{repo}/comments": { get: { summary: "Comments", parameters: [{ name: "owner", in: "path", required: true, schema: { type: "string" } }, { name: "repo", in: "path", required: true, schema: { type: "string" } }], responses: { "200": okJson("comments") } } },
      "/api/v1/search": { get: { summary: "Full-text + operators (category: lang: tool: bucket: owner: …; prefix - to exclude)", parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }, { name: "sort", in: "query", schema: { type: "string" } }, { name: "page", in: "query", schema: { type: "integer" } }], responses: { "200": feedResp } } },
      "/api/v1/facets": { get: { summary: "Value counts for a facet", parameters: [{ name: "facet", in: "query", required: true, schema: { type: "string" } }], responses: { "200": okJson("values") } } },
      "/api/v1/vocab": { get: { summary: "Controlled vocabularies, aliases, search operators", responses: { "200": okJson("vocab") } } },
      "/api/v1/leaderboard": { get: { summary: "Mean score by facet value (default built_with)", parameters: [{ name: "facet", in: "query", schema: { type: "string" } }], responses: { "200": okJson("leaderboard") } } },
      "/api/v1/digest": { get: { summary: "Every listed repo in one cached file: title, tagline, source, tier, license, stars, tags, trimmed pitch and README. Read this instead of crawling pages.", parameters: [{ name: "since", in: "query", schema: { type: "integer", description: "unix seconds; only repos listed or updated since" } }], responses: { "200": okJson("{generated_at, since, count, repos[]}") } } },
      "/me": { get: { summary: "My repos: everything the session user owns or maintains, in any status (append .json)", security: bearer, responses: { "200": okJson("{needs_you, listed, submitted}"), "401": okJson("login required") } } },
      "/upvoted": { get: { summary: "Everything the session user upvoted, newest vote first (append .json)", security: bearer, parameters: [{ name: "page", in: "query", schema: { type: "integer" } }], responses: { "200": feedResp, "401": okJson("login required") } } },
      "/r/{owner}/{repo}/takedown": { post: { summary: "Takedown request for a trawled listing (one its owner never submitted). No login needed; the listing comes down right away. Replies are canned.", requestBody: { content: { "application/json": { schema: { type: "object", properties: { message: { type: "string", description: "20 to 2000 chars" }, contact: { type: "string" } }, required: ["message"] } } } }, responses: { "200": okJson("{outcome: removed | queued | opted}"), "400": okJson("invalid"), "429": okJson("too many requests") } } },
      "/api/v1/me": { get: { summary: "Who am I", security: bearer, responses: { "200": okJson("user"), "401": okJson("not logged in") } } },
      "/b": { get: { summary: "Slopbucket directory (append .json)", responses: { "200": okJson("buckets") } } },
      "/queue": { get: { summary: "Public moderation queue + capacity (append .json)", responses: { "200": okJson("queue") } } },
      "/scan": { post: { summary: "Request a scan of a public repo (login); explains in words why it was or was not queued", requestBody: { content: { "application/json": { schema: { type: "object", properties: { repo: { type: "string", description: "owner/name or a github.com URL" } }, required: ["repo"] } } } }, responses: { "200": okJson("listed, or current verdict inside the 10-minute window"), "202": okJson("queued, rejected, quarantined, hidden, or delisted; see headline, detail, next"), "404": okJson("not reachable on GitHub or no slopscore.md"), "429": okJson("too many requests") } } },
      "/ping/{owner}/{repo}": { get: { summary: "Trigger a scan now (1 per 10 min per repo)", parameters: [{ name: "owner", in: "path", required: true, schema: { type: "string" } }, { name: "repo", in: "path", required: true, schema: { type: "string" } }], responses: { "200": okJson("listed"), "202": okJson("scanned, not listed (see status + reject_reason)"), "429": okJson("pinged recently") } } },
      "/auth/device/start": { post: { summary: "Begin the GitHub device flow", responses: { "200": okJson("{device_code, user_code, verification_uri, interval}") } } },
      "/auth/device/poll": { post: { summary: "Poll for the bearer token", requestBody: { content: { "application/json": { schema: { type: "object", properties: { device_code: { type: "string" } }, required: ["device_code"] } } } }, responses: { "200": okJson("{token}"), "202": okJson("pending") } } },
      "/r/{owner}/{repo}/vote": { post: { summary: "Vote (1, -1, 0). Without a bearer: an anonymous crowd vote, shown but never ranking.", security: bearer, requestBody: { content: { "application/json": { schema: { type: "object", properties: { value: { type: "integer", enum: [1, -1, 0] } } } } } }, responses: { "200": okJson("{score, up, down, mine}"), "409": okJson("not yet listed") } } },
      "/r/{owner}/{repo}/comments": { post: { summary: "Comment (markdown, ≤ 4000 chars, ≤ 2 links). Flagged comments are held for a moderator.", security: bearer, requestBody: { content: { "application/json": { schema: { type: "object", properties: { body: { type: "string" }, parent_id: { type: "integer" } }, required: ["body"] } } } }, responses: { "201": okJson("{id, url}"), "202": okJson("held") } } },
      "/r/{owner}/{repo}/report": { post: { summary: "Report a listing", security: bearer, requestBody: { content: { "application/json": { schema: { type: "object", properties: { reason: { type: "string", enum: ["objectionable", "undisclosed", "malware", "spam", "not-slop", "other"] }, note: { type: "string" } } } } } }, responses: { "200": okJson("ok") } } },
      "/r/{owner}/{repo}/owner/{action}": { post: { summary: "Owner controls: refresh | submit | remove | restore (owner or maintainers: only)", security: bearer, parameters: [{ name: "action", in: "path", required: true, schema: { type: "string", enum: ["refresh", "submit", "remove", "restore"] } }], responses: { "200": okJson("ok"), "403": okJson("not the owner") } } },
    },
  };
  return c.json(doc, 200, { "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" });
});
