// Minimal MCP server (Streamable HTTP, stateless JSON responses, no Durable Object needed).
// Speaks JSON-RPC 2.0 over POST /mcp: initialize, ping, tools/list, tools/call. Reads are open; writes need a bearer token.
import { Hono, type Context } from "hono";
import type { AppEnv } from "../env";
import { feed, getRepo, repoTags, comments, castVote, addComment, rateLimit, curatedTags, capacity, type Sort, SORTS } from "../lib/db";
import { parseQuery } from "../lib/searchquery";
import { repoJson } from "./pages";
import { GitHub } from "../lib/github";
import { scanRepo } from "../lib/scan";
import { renderMarkdown } from "../lib/markdown";
import { ipHash, criticVoteRefusal } from "../lib/trust";
import { adminLogins } from "../env";

export const mcp = new Hono<AppEnv>();

const PROTOCOL = "2025-06-18";

const TOOLS = [
  { name: "list_repos", description: "The SlopScore feed. sort: hot|new|top|rising|controversial|updated|upcoming; t: day|week|month|year|all; page.", inputSchema: { type: "object", properties: { sort: { type: "string" }, t: { type: "string" }, page: { type: "integer" }, bucket: { type: "string", description: "restrict to a slopbucket, e.g. cli" } } } },
  { name: "search_repos", description: "Full-text search with operators: category: lang: tool: bucket: platform: status: owner: … prefix - to exclude.", inputSchema: { type: "object", properties: { q: { type: "string" }, page: { type: "integer" } }, required: ["q"] } },
  { name: "get_repo", description: "One listing: disclosures, tags, scan report, comments.", inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" } }, required: ["owner", "repo"] } },
  { name: "get_queue", description: "The public moderation queue and the site's capacity (free/paid mode, AI budget, scans left).", inputSchema: { type: "object", properties: {} } },
  { name: "list_buckets", description: "Curated slopbuckets with counts.", inputSchema: { type: "object", properties: {} } },
  { name: "ping_repo", description: "Ask SlopScore to scan a GitHub repo that has a slopscore.md now (1 per 10 min per repo).", inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" } }, required: ["owner", "repo"] } },
  { name: "whoami", description: "The GitHub identity behind the bearer token, if any.", inputSchema: { type: "object", properties: {} } },
  { name: "vote", description: "Vote on a listed repo. value 1, -1, or 0 to clear. Needs a bearer token.", inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, value: { type: "integer", enum: [1, -1, 0] } }, required: ["owner", "repo", "value"] } },
  { name: "comment", description: "Comment on a listed repo (markdown, ≤ 4000 chars, ≤ 2 links). Needs a bearer token. Flagged comments are held for a moderator.", inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, body: { type: "string" }, parent_id: { type: "integer" } }, required: ["owner", "repo", "body"] } },
  { name: "report", description: "Report a listing (quietly). reason: objectionable|undisclosed|malware|spam|not-slop|other. Needs a bearer token.", inputSchema: { type: "object", properties: { owner: { type: "string" }, repo: { type: "string" }, reason: { type: "string" }, note: { type: "string" } }, required: ["owner", "repo", "reason"] } },
];

type Rpc = { jsonrpc: "2.0"; id?: number | string | null; method: string; params?: Record<string, unknown> };
const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id: id ?? null, result });
const err = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
const text = (data: unknown) => ({ content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 1) }] });
const fail = (msg: string) => ({ content: [{ type: "text", text: msg }], isError: true });

mcp.get("/", (c) => c.json({
  name: "slopscore", protocol: PROTOCOL, transport: "streamable-http (stateless; POST JSON-RPC here)",
  auth: "optional Authorization: Bearer <token> from the GitHub device flow (POST /auth/device/start) for vote/comment/report",
  tools: TOOLS.map((t) => t.name), docs: "/llms.txt",
}));

mcp.post("/", async (c) => {
  let body: Rpc | Rpc[];
  try { body = (await c.req.json()) as Rpc | Rpc[]; } catch { return c.json(err(null, -32700, "parse error"), 400); }
  const batch = Array.isArray(body);
  const msgs: Rpc[] = Array.isArray(body) ? body : [body];
  const out: unknown[] = [];
  for (const m of msgs) {
    if (!m || m.jsonrpc !== "2.0" || typeof m.method !== "string") { out.push(err(null, -32600, "invalid request")); continue; }
    if (m.method.startsWith("notifications/")) continue; // no response to notifications
    try {
      out.push(await handle(c, m));
    } catch (e) {
      out.push(err(m.id, -32603, (e as Error).message));
    }
  }
  if (!out.length) return c.body(null, 202);
  return c.json(batch ? out : out[0]);
});

async function handle(c: Context<AppEnv>, m: Rpc) {
  const p = (m.params ?? {}) as Record<string, unknown>;
  switch (m.method) {
    case "initialize":
      return ok(m.id, { protocolVersion: PROTOCOL, capabilities: { tools: { listChanged: false } }, serverInfo: { name: "slopscore", version: "1.0.0" }, instructions: "SlopScore: peer review for code nobody wrote. Reads are open. For vote/comment/report, get a bearer token via the GitHub device flow (POST /auth/device/start, poll /auth/device/poll) and send it as Authorization: Bearer. See /llms.txt." });
    case "ping": return ok(m.id, {});
    case "tools/list": return ok(m.id, { tools: TOOLS });
    case "tools/call": return ok(m.id, await callTool(c, String(p.name ?? ""), (p.arguments ?? {}) as Record<string, unknown>));
    default: return err(m.id, -32601, `method not found: ${m.method}`);
  }
}

async function callTool(c: Context<AppEnv>, name: string, a: Record<string, unknown>) {
  const db = c.env.DB;
  const user = c.get("user");
  const s = (k: string) => String(a[k] ?? "").trim();
  const needUser = () => (user ? null : fail("This tool needs a bearer token. Start the GitHub device flow: POST /auth/device/start, then poll /auth/device/poll."));
  switch (name) {
    case "list_repos": {
      const sort = (SORTS as readonly string[]).includes(s("sort")) ? (s("sort") as Sort) : "hot";
      const r = await feed(db, { sort, t: s("t") || undefined, page: Number(a.page ?? 1), tag: s("bucket") || undefined });
      return text({ page: r.page, has_more: r.hasMore, repos: r.rows.map(repoJson) });
    }
    case "search_repos": {
      const q = parseQuery(s("q"));
      const r = await feed(db, { sort: "top", page: Number(a.page ?? 1), filters: q.filters, match: q.match });
      return text({ parsed: q.terms, page: r.page, has_more: r.hasMore, repos: r.rows.map(repoJson) });
    }
    case "get_repo": {
      const r = await getRepo(db, s("owner"), s("repo"));
      if (!r) return fail(`Not listed. If it has a slopscore.md, call ping_repo.`);
      const [tags, cs] = await Promise.all([repoTags(db, r.id), comments(db, r.id)]);
      return text({ ...repoJson(r), tags, body_md: r.body_md, scan: r.scan ? JSON.parse(r.scan) : null, comments: cs.map((x) => ({ id: x.id, user: x.login, body_md: x.deleted_at ? null : x.body_md, up: x.up, down: x.down, created_at: x.created_at })) });
    }
    case "get_queue": {
      const cap = await capacity(db, c.env);
      const q = await feed(db, { sort: "new", status: ["discovered", "quarantined", "rejected"], queue: true, page: 1 });
      return text({ capacity: cap, queue: q.rows.map((r) => ({ full_name: r.full_name, status: r.status, queue_reason: r.queue_reason, reject_reason: r.reject_reason, paid: r.priority_at != null })) });
    }
    case "list_buckets": return text(await curatedTags(db));
    case "ping_repo": {
      const key = `ping:${s("owner")}/${s("repo")}`.toLowerCase();
      if (!(await rateLimit(db, key, 1, 600))) return fail("Pinged in the last 10 minutes; try later.");
      const res = await scanRepo(db, c.env, new GitHub(c.env.GITHUB_CRAWL_TOKEN), s("owner"), s("repo"));
      if (!res.repo) return fail(`Could not scan: ${"error" in res.outcome ? res.outcome.error : "unknown"}. Commit a slopscore.md at the root of the default branch (spec: /spec.md).`);
      return text({ status: res.repo.status, tier: res.repo.tier, url: `/r/${res.repo.full_name}`, reject_reason: res.repo.reject_reason, deferred: !("error" in res.outcome) && res.outcome.deferred });
    }
    case "whoami": return user ? text({ id: user.id, login: user.login, can_write: user.canWrite, is_admin: user.isAdmin }) : text({ anonymous: true, hint: "POST /auth/device/start to get a bearer token" });
    case "vote": {
      const n = needUser(); if (n) return n;
      const r = await getRepo(db, s("owner"), s("repo"));
      if (!r) return fail("unknown repo");
      if (r.status !== "listed") return fail(`not yet graded (status ${r.status})`);
      if (!user!.canWrite) return fail("account too new to vote");
      const v = Number(a.value);
      if (![1, -1, 0].includes(v)) return fail("value must be 1, -1, or 0");
      if (!(await rateLimit(db, `vote:${user!.id}`, 60, 600))) return fail("slow down: 60 votes per 10 minutes");
      const refusal = user!.isCritic ? criticVoteRefusal(v, r.owner, adminLogins(c.env)) : null;
      if (refusal) return fail(refusal);
      const updated = await castVote(db, user!.row, r, v as -1 | 0 | 1, await ipHash(c.req.header("cf-connecting-ip"), c.env.SESSION_SECRET), user!.isCritic);
      return text({ ok: true, score: updated.score, up: updated.up, down: updated.down, mine: v, flagged: updated.ring ?? null });
    }
    case "comment": {
      const n = needUser(); if (n) return n;
      const r = await getRepo(db, s("owner"), s("repo"));
      if (!r) return fail("unknown repo");
      if (r.status !== "listed") return fail(`comments open once listed (status ${r.status})`);
      if (!user!.canWrite) return fail("account too new to comment");
      const t = s("body");
      if (!t || t.length > 4000) return fail("body must be 1–4000 chars");
      if ((t.match(/https?:\/\//g) ?? []).length > 2) return fail("at most 2 links");
      if (!(await rateLimit(db, `comment:${user!.id}`, 10, 600))) return fail("slow down");
      const id = await addComment(db, r.id, user!.id, a.parent_id ? Number(a.parent_id) : null, t, renderMarkdown(t));
      return text({ ok: true, id, url: `/r/${r.full_name}#c${id}` });
    }
    case "report": {
      const n = needUser(); if (n) return n;
      const r = await getRepo(db, s("owner"), s("repo"));
      if (!r) return fail("unknown repo");
      const reason = ["objectionable", "undisclosed", "malware", "spam", "not-slop", "other"].includes(s("reason")) ? s("reason") : "other";
      await db.prepare("INSERT OR IGNORE INTO reports (target_type, target_id, user_id, reason, note) VALUES ('repo', ?, ?, ?, ?)").bind(r.id, user!.id, reason, s("note").slice(0, 300)).run();
      return text({ ok: true, message: "Reported. Quietly. Thank you." });
    }
    default: return fail(`unknown tool ${name}`);
  }
}
