// The truffle trawl: repos that never opted in but call themselves vibe coded, listed below everything that did,
// with a stand-in slopscore.md the Cap'm wrote from GitHub data. Everything here is deterministic: no model writes
// the file, picks a candidate, or reads a takedown request.
import type { GhRepo } from "./github";
import { denylistGate, type DenyRow } from "./denylist";
import { SPEC_VERSION, SPEC_URL } from "./vocab";
import { isoDate } from "./time";
import { markDirty } from "./cache";

/** Licenses that allow redistribution of the README text we show. The pick reason cites the one found. */
export const PERMISSIVE = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "Unlicense", "CC0-1.0"]);

/**
 * Whether a trawled listing is allowed into search results and the sitemap.
 *
 * Both answers are defensible and the choice is a product one, so it is a var rather than a decision in code.
 * "on": the maker finds the page when they google their own handle, which is the challenge working as intended —
 * wear the label or label yourself properly. It also means anyone else googling that person finds it, which is
 * the part that reads as a shaming page rather than an invitation. "off": the listing is still public, readable,
 * linkable and votable; search engines just are not handed a page about somebody who never asked for one.
 */
export function trawlIndexed(env: { TRAWL_INDEX?: string }): boolean {
  return (env.TRAWL_INDEX ?? "").trim().toLowerCase() === "on";
}

/**
 * Whether a page under somebody's GitHub handle is indexed when that person never opted in.
 *
 * Deliberately a separate switch from TRAWL_INDEX, and deliberately off. A repo page is about a project
 * somebody published; a page at /u/{login} is about a person, and it is the page a search for their name
 * is most likely to find. Indexing a repo is commentary on a thing. Indexing a handle is a profile of
 * someone who never asked for one. An owner who has opted in on any repo is indexed either way: that is
 * consent, and it does not need a flag.
 */
export function trawlOwnerIndexed(env: { TRAWL_OWNER_INDEX?: string }): boolean {
  return (env.TRAWL_OWNER_INDEX ?? "").trim().toLowerCase() === "on";
}

/** One star, not five: the whole point is repos nobody starred. Five threw away about 95% of the
 *  pool, including almost every zero-star weekend project the site exists for. Zero would also
 *  drag in scaffolds nobody finished, so one is the floor that means somebody cared at all. */
export const MIN_STARS = 1;
/** Famous repos aren't the audience, and they're the likeliest to mind. */
export const MAX_STARS = 2000;
/** Lists, guides and prompt packs *about* vibe coding use the same topics; they aren't vibe-coded software. */
const NOT_SOFTWARE = /\b(awesome|best[- ]practices?|curated|cheat[- ]?sheets?|guides?|tutorials?|prompts?|roadmap|course)\b/i;
/** "An IDE for vibe coding" is a tool for vibe coders, not vibe-coded software; "vibe coded" (past tense) is the owner's claim. */
const FOR_VIBE_CODING = /\bvibe[- ]?coding\b/i;
const VIBE_CODED = /\bvibe[- ]?coded\b/i;
export const PUSHED_WITHIN_DAYS = 90;

/** Topics that are the owner's own past-tense claim that the repo was made by AI. "vibe-coding" is not one: it mostly marks tools for vibe coders. */
export const VIBE_TOPICS = [
  "vibe-coded", "vibecoded", "ai-generated", "ai-written", "llm-generated",
  "built-with-claude", "built-with-claude-code", "built-with-cursor", "cursor-ai",
  "built-with-chatgpt", "built-with-gpt", "built-with-copilot", "github-copilot",
  "built-with-gemini", "gemini-cli", "built-with-v0", "built-with-bolt", "built-with-lovable",
  "windsurf", "aider", "cline",
];

/** Named so the signal on the listing says which tool, not just "an AI". The tools match CLAIM_RE's list. */
const TOOLS: [RegExp, string][] = [
  [/\bclaude(\s+code)?\b/i, "Claude"], [/\bcursor\b/i, "Cursor"], [/\b(github\s+)?copilot\b/i, "Copilot"],
  [/\bchatgpt\b|\bgpt-?\d\b/i, "ChatGPT"], [/\bcodex\b/i, "Codex"], [/\bgemini(\s+cli)?\b/i, "Gemini"],
  [/\bwindsurf\b/i, "Windsurf"], [/\baider\b/i, "Aider"], [/\bcline\b/i, "Cline"],
  [/\blovable\b/i, "Lovable"], [/\bbolt(\.new)?\b/i, "Bolt"], [/\bv0\b/i, "v0"], [/\breplit\b/i, "Replit"],
];

const BUILT_WITH_RE = /\b(?:built|made|written|coded|created|generated|developed)\s+(?:entirely\s+|mostly\s+|completely\s+|fully\s+|100%\s+|almost entirely\s+)?(?:with|using|by)\s+([a-z0-9.\- ]{2,20})/i;

const DESCRIPTION_SIGNALS: [RegExp, string][] = [
  [VIBE_CODED, 'says "vibe coded" in its description'],
  [/\b(100% )?ai[- ]generated\b/i, 'says "AI-generated" in its description'],
];

/**
 * The grounds the Cap'm works, and the searches that make up each one.
 *
 * Grouped rather than listed flat because the net used to be four-sixths Claude, which said more about who
 * wrote the crawler than about who is writing the slop. Claude is one ground of six now. Everything
 * downstream was already model-agnostic -- CLAIM_RE accepts a dozen tools and TOPIC_TOOL maps them onto
 * built_with -- so this was the only narrow part.
 *
 * A ground is what the chart in the rail draws (src/lib/sea.ts); the queries inside it are the detail.
 * trawl:cursor indexes the flattened QUERY list, not this one, so groundOfQuery() is how the chart knows
 * which water she is working tonight.
 */
export const TRAWL_GROUNDS: { name: string; blurb: string; queries: string[] }[] = [
  {
    name: "The Vibe Banks",
    blurb: "repos that call themselves vibe-coded and name no tool at all",
    queries: ["topic:vibe-coded", "topic:vibecoded", '"vibe coded" in:description'],
  },
  {
    name: "Claude Cay",
    blurb: "repos that name Claude or Claude Code",
    queries: ["topic:built-with-claude", "topic:built-with-claude-code", '"built with claude" in:description'],
  },
  {
    name: "Cursor Shoals",
    blurb: "repos that name Cursor",
    queries: ["topic:built-with-cursor", "topic:cursor-ai", '"built with cursor" in:description'],
  },
  {
    name: "The GPT Narrows",
    blurb: "repos that name ChatGPT, GPT or Codex",
    queries: ["topic:built-with-chatgpt", "topic:built-with-gpt", '"built with chatgpt" in:description'],
  },
  {
    name: "Copilot Reach",
    blurb: "repos that name GitHub Copilot or Gemini",
    queries: ["topic:built-with-copilot", "topic:built-with-gemini", '"built with copilot" in:description'],
  },
  {
    name: "The Generated Deeps",
    blurb: "repos that say a machine wrote them, and the builder tools: v0, Bolt, Lovable, Windsurf",
    queries: ["topic:ai-generated", "topic:built-with-v0", "topic:built-with-lovable", '"ai-generated" in:description'],
  },
];

/** Every search, in ground order. trawl:cursor is an index into this. */
export const TRAWL_QUERIES: string[] = TRAWL_GROUNDS.flatMap((g) => g.queries);

/** Which ground a query belongs to. Wraps, because the cursor only ever counts up. */
export function groundOfQuery(i: number): number {
  const n = TRAWL_QUERIES.length;
  const idx = (((Math.floor(Number(i) || 0) % n) + n) % n);
  let seen = 0;
  for (let g = 0; g < TRAWL_GROUNDS.length; g++) {
    seen += TRAWL_GROUNDS[g].queries.length;
    if (idx < seen) return g;
  }
  return 0;
}

/** How many searches one night's trawl works, starting at the cursor. Bounds the GitHub search calls per
 *  invocation now that there are three times as many queries; the cursor still advances one a night, so
 *  every search comes round often. Half the list a night rather than a third: eight of these topics match
 *  nothing at all right now, and a run could otherwise spend most of its slots on empty water. An empty search
 *  costs one call and moves on, so reaching further down the list is close to free. */
export const QUERIES_PER_RUN = 9;

/** The same searches without a pushed clause: the auto-trawl supplies its own date window, because asking
 *  by date is what stops it re-reading water it has already worked (src/jobs/trawl.ts). */
export function trawlQueriesUnwindowed(): string[] {
  const base = `fork:false archived:false template:false is:public stars:${MIN_STARS}..${MAX_STARS}`;
  return TRAWL_QUERIES.map((q) => `${q} ${base}`);
}

/**
 * The broad half of the sieve: everything that can be decided from the search result alone.
 *
 * Order matters for cost, not just correctness. Reading a README is a GitHub call and the judge is money, so
 * anything knowable from the description and topics is decided here, before either is spent. Two things get
 * through the hard rules and waste both: lists and guides *about* vibe coding, and tools *for* vibe coders —
 * an IDE that writes your code is not a thing an AI wrote. Both say so plainly in their own description.
 *
 * Returns why it was thrown back, or null to look closer.
 */
export function cheapReject(g: GhRepo): string | null {
  const text = `${g.name} ${g.description ?? ""}`;
  if (NOT_SOFTWARE.test(text)) return "a list, guide or prompt pack about vibe coding, not vibe-coded software";
  const topics = (g.topics ?? []).map((t) => t.toLowerCase());
  const claimsPastTense = VIBE_CODED.test(text) || topics.some((t) => VIBE_TOPICS.includes(t));
  if (FOR_VIBE_CODING.test(text) && !claimsPastTense) return "a tool for vibe coding, not something vibe coded";
  return null;
}

/** GitHub repository-search queries, rotated one start position per day. */
export function trawlQueries(at: number): string[] {
  const since = isoDate(at - PUSHED_WITHIN_DAYS * 86400);
  const base = `fork:false archived:false template:false is:public pushed:>=${since} stars:${MIN_STARS}..${MAX_STARS}`;
  return TRAWL_QUERIES.map((q) => `${q} ${base}`);
}

/** Why the Cap'm thinks this repo is proud vibe slop, in the owner's own words. Empty = no signal, don't pick. */
export function trawlSignals(g: GhRepo): string[] {
  const out: string[] = [];
  for (const t of g.topics ?? []) if (VIBE_TOPICS.includes(t.toLowerCase())) out.push(`tagged ${t.toLowerCase()}`);
  for (const [re, label] of DESCRIPTION_SIGNALS) if (re.test(g.description ?? "")) out.push(label);
  // "built with <something>" where the something is a tool we know. Named rather than generic, because a
  // listing that says "built with Cursor" is telling the reader more than "made by an AI" does.
  const built = BUILT_WITH_RE.exec(g.description ?? "");
  if (built) {
    const tool = TOOLS.find(([re]) => re.test(built[1]));
    if (tool) out.push(`says it was built with ${tool[1]} in its description`);
  }
  return out;
}

/** The owner's own past-tense claim that an AI tool wrote this project. Matched against the description and the README. */
export const CLAIM_RE = /\bvibe[- ]?coded\b|\b(built|made|written|coded|created|generated|developed)\s+(entirely\s+|mostly\s+|completely\s+|fully\s+|100%\s+|almost entirely\s+)?(with|using|by)\s+(claude(\s+code)?|cursor|copilot|github copilot|codex|gemini( cli)?|windsurf|aider|cline|lovable|bolt(\.new)?|v0|replit|chatgpt|gpt-?\d|an? (llm|ai)|ai( agents?)?|llms)\b|\b100%\s+ai[- ]generated\b|\bentirely ai[- ]generated\b/i;

/** The sentence around the claim, trimmed and stripped of markup: the listing quotes this, so it is the owner's words, not ours. */
export function claimSnippet(text: string): string | null {
  const flat = String(text ?? "").replace(/```[\s\S]*?```/g, " ").replace(/[`*_>#|\[\]]/g, " ").replace(/https?:\/\/\S+/g, " ").replace(/\s+/g, " ");
  const m = CLAIM_RE.exec(flat);
  if (!m) return null;
  const start = flat.lastIndexOf(".", m.index) + 1;
  const dot = flat.indexOf(".", m.index + m[0].length);
  const end = dot === -1 ? Math.min(flat.length, m.index + m[0].length + 90) : Math.min(dot, m.index + m[0].length + 120);
  const s = flat.slice(Math.max(start, m.index - 110), end).trim();
  return s.length >= 8 ? s.slice(0, 160) : m[0];
}

/** The public "why picked" for an auto-trawled repo: the owner's own sentence, quoted, never a model's words. */
export function autoReason(g: GhRepo, claim: string): string | null {
  const c = cleanReason(claim);
  const d = cleanReason(g.description ?? "");
  if (!c || !d) return null;
  return cleanReason(`${d.slice(0, 110)}; its own README says "${c.slice(0, 140)}"`);
}

export interface Pick { repo: GhRepo; signals: string[]; reason: string; virtualMd: string }
export interface Skip { full_name: string; why: string; /** true = remember in trawl_skipped (never look again) */ record: boolean }

/** Pure filter over one page of search results. `known` holds lowercased full names already in repos or trawl_skipped. */
export function pickCandidates(items: GhRepo[], o: { known: Set<string>; deny: DenyRow[]; at: number }): { picks: Pick[]; skipped: Skip[] } {
  const picks: Pick[] = [];
  const skipped: Skip[] = [];
  const skip = (g: GhRepo, why: string, record = false) => skipped.push({ full_name: g.full_name.toLowerCase(), why, record });
  for (const g of items) {
    if (o.known.has(g.full_name.toLowerCase())) { skip(g, "already known"); continue; }
    if (g.private || g.fork || g.archived || g.disabled || g.is_template) { skip(g, "private, fork, archived, disabled or template"); continue; }
    if (g.owner.type !== "User") { skip(g, "org-owned: nobody can log in as the repo owner"); continue; }
    const spdx = g.license?.spdx_id ?? "";
    if (!PERMISSIVE.has(spdx)) { skip(g, `license ${spdx || "none"} is not on the permissive list`); continue; }
    if (!(g.description ?? "").trim()) { skip(g, "no description"); continue; }
    if (g.stargazers_count < MIN_STARS) { skip(g, `fewer than ${MIN_STARS} stars`); continue; }
    if (g.stargazers_count > MAX_STARS) { skip(g, `more than ${MAX_STARS} stars: famous repos aren't the audience`); continue; }
    if (NOT_SOFTWARE.test(`${g.name.replace(/[-_]/g, " ")} ${g.description ?? ""}`)) { skip(g, "a list, guide or prompt pack about vibe coding, not vibe-coded software"); continue; }
    if (FOR_VIBE_CODING.test(g.description ?? "") && !VIBE_CODED.test(g.description ?? "")) { skip(g, "a tool for vibe coding, not vibe-coded software"); continue; }
    const pushed = Date.parse(g.pushed_at) / 1000;
    if (!pushed || pushed < o.at - PUSHED_WITHIN_DAYS * 86400) { skip(g, `not pushed in ${PUSHED_WITHIN_DAYS} days`); continue; }
    const signals = trawlSignals(g);
    if (!signals.length) { skip(g, "no vibe-coded signal in topics or description"); continue; }
    const deny = denylistGate([g.name, g.description ?? "", ...(g.topics ?? [])].join(" \n "), "", o.deny);
    if (deny.reject.length) { skip(g, `denylist: ${deny.reject[0]}`, true); continue; }
    picks.push({ repo: g, signals, reason: trawlReason(g, signals, o.at), virtualMd: buildVirtualMd(g, signals) });
  }
  return { picks, skipped };
}

export function trawlReason(g: GhRepo, signals: string[], at: number): string {
  return `Picked by the Cap'm on ${isoDate(at)}: ${signals.join("; ")}; ${g.stargazers_count} stars; ${g.license?.spdx_id} license; last pushed ${isoDate(Date.parse(g.pushed_at) / 1000)}. The owner did not submit this.`;
}

const TOPIC_CATEGORY: Record<string, string> = {
  cli: "cli", "command-line": "cli", "command-line-tool": "cli", terminal: "cli", tui: "cli", "terminal-ui": "cli", ratatui: "cli",
  mcp: "mcp-server", "mcp-server": "mcp-server", "model-context-protocol": "mcp-server",
  game: "game", games: "game", "game-development": "game", gamedev: "game", "browser-game": "game",
  bot: "bot", "discord-bot": "bot", "telegram-bot": "bot", "slack-bot": "bot",
  agent: "agent", agents: "agent", "ai-agent": "agent", "ai-agents": "agent",
  "chrome-extension": "extension", "browser-extension": "extension", "vscode-extension": "extension", extension: "extension",
  plugin: "plugin", "obsidian-plugin": "plugin",
  "web-app": "web-app", webapp: "web-app", website: "web-app", pwa: "web-app", dashboard: "web-app", nextjs: "web-app",
  ios: "mobile", android: "mobile", "react-native": "mobile", flutter: "mobile", "mobile-app": "mobile",
  api: "api", library: "library", sdk: "library",
  "home-assistant": "iot", iot: "iot", "raspberry-pi": "iot",
  automation: "automation", productivity: "productivity",
  "developer-tools": "devtools", devtools: "devtools", "dev-tools": "devtools",
  education: "education", finance: "finance", data: "data", "data-visualization": "data",
  ml: "ml", "machine-learning": "ml", security: "security", template: "template", boilerplate: "template",
  music: "media", video: "media", audio: "media", art: "art", "generative-art": "art", social: "social", toy: "toy",
};

const TOPIC_TOOL: Record<string, string> = {
  "claude-code": "claude-code", "built-with-claude-code": "claude-code", claude: "claude", "built-with-claude": "claude",
  cursor: "cursor", "cursor-ai": "cursor", copilot: "copilot", "github-copilot": "copilot", codex: "codex",
  "gemini-cli": "gemini-cli", windsurf: "windsurf", aider: "aider", cline: "cline", chatgpt: "chatgpt",
  lovable: "lovable", bolt: "bolt", "bolt-new": "bolt", v0: "v0", replit: "replit",
};

/**
 * The stand-in file. Only controlled-vocabulary values go into the YAML; title and tagline are left out so
 * scanRepo falls back to GitHub (no stranger-written text is ever templated into YAML).
 * ai_generated/human_touch come from the owner's own "vibe coded" claim and render as "inferred".
 */
export function buildVirtualMd(g: GhRepo, signals: string[], curated?: string): string {
  const topics = (g.topics ?? []).map((t) => t.toLowerCase());
  const categories = [...new Set(topics.map((t) => TOPIC_CATEGORY[t]).filter(Boolean))].slice(0, 3);
  const tools = new Set(topics.map((t) => TOPIC_TOOL[t]).filter(Boolean));
  if (/\bclaude code\b/i.test(g.description ?? "")) tools.add("claude-code");
  const why = signals.map((s) => s.replace(/^tagged /, "is tagged ")).join(" and ");
  return [
    "---",
    `slopscore: ${SPEC_VERSION}`,
    `spec: ${SPEC_URL}`,
    "ai_generated: mostly",
    "human_touch: light",
    "content_rating: everyone",
    "contains: []",
    `category: [${(categories.length ? categories : ["other"]).join(", ")}]`,
    "status: works-on-my-machine",
    ...(tools.size ? [`built_with: [${[...tools].join(", ")}]`] : []),
    "slopbucket: [vibe-coded]",
    "x-virtual: true",
    "---",
    "",
    `**The Cap'm wrote this paperwork, not the owner.** This repo never submitted itself to SlopScore. ${curated ? `The Cap'm picked it by hand: ${curated.replace(/\.$/, "")}` : `The Cap'm hauled it in on a truffle trawl because it ${why}`}. It carries the ${g.license?.spdx_id ?? "unknown"} license. The disclosures above are his best guess from what GitHub shows.`,
    "",
    "Is this yours? Commit a real `slopscore.md` and press Refresh to replace this, or remove the listing in one click. There's no account to make: you log in with GitHub.",
    "",
  ].join("\n");
}

/** Server-side checks for a hand-vetted pick: the curator's reading replaces the keyword signals, the hard rules stay. Null = OK. */
export function curatedCheck(g: GhRepo, o: { known: Set<string>; deny: DenyRow[] }): string | null {
  if (o.known.has(g.full_name.toLowerCase())) return "already on SlopScore, or removed and remembered";
  if (g.private || g.fork || g.archived || g.disabled || g.is_template) return "private, fork, archived, disabled or template";
  if (g.owner.type !== "User") return "org-owned: nobody can log in as the repo owner";
  const spdx = g.license?.spdx_id ?? "";
  if (!PERMISSIVE.has(spdx)) return `license ${spdx || "none"} is not on the permissive list`;
  if (!(g.description ?? "").trim()) return "no description (the listing needs a tagline)";
  const deny = denylistGate([g.name, g.description ?? "", ...(g.topics ?? [])].join(" \n "), "", o.deny);
  if (deny.reject.length) return `denylist: ${deny.reject[0]}`;
  return null;
}

/** A curator's public "why picked": plain text, one or two sentences, no markup or line breaks. Null = unusable. */
export function cleanReason(s: unknown): string | null {
  const t = String(s ?? "").replace(/[\r\n\t]+/g, " ").replace(/[<>`*_\[\]#|]/g, "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim();
  return t.length >= 10 && t.length <= 280 ? t : null;
}

/** A hand-vetted pick, ready to insert. The reason is published on the listing. */
export function curatedPick(g: GhRepo, reason: string, at: number): Pick {
  const r = reason.replace(/\.$/, "");
  return {
    repo: g, signals: [r],
    reason: `Picked by hand by the Cap'm on ${isoDate(at)}: ${r}. ${g.stargazers_count} stars; ${g.license?.spdx_id} license. The owner did not submit this.`,
    virtualMd: buildVirtualMd(g, [], r),
  };
}

/** The virtual file's frontmatter, minus the marker line, as a starting point the owner can commit. */
export function adoptionTemplate(virtualMd: string | null): string {
  const fm = /^---\n[\s\S]*?\n---\n/.exec(virtualMd ?? "")?.[0] ?? "";
  return fm.split("\n").filter((l) => !l.startsWith("x-virtual")).join("\n").trim() + "\n";
}

/** Takedown form input check. Canned errors only; the message itself never reaches a model. */
export function validateTakedown(b: { message?: string; contact?: string }): { ok: true; message: string; contact: string | null } | { ok: false; error: string } {
  const message = (b.message ?? "").trim();
  const contact = (b.contact ?? "").trim().slice(0, 200) || null;
  if (message.length < 20) return { ok: false, error: "Please say a little more (at least 20 characters): who you are and what you'd like removed." };
  if (message.length > 2000) return { ok: false, error: "Please keep it under 2000 characters." };
  if ((message.match(/https?:\/\//g) ?? []).length > 2) return { ok: false, error: "At most 2 links, please." };
  return { ok: true, message, contact };
}

/** Owner removal or takedown of a trawled listing: delist and forget its content. The row stays so the trawl never re-adds it. */
export async function retireTrawled(db: D1Database, id: number, reason: "takedown" | "owner-request"): Promise<void> {
  await db.prepare(
    `UPDATE repos SET status = 'delisted', removed_at = unixepoch(), removed_reason = ?, queue_reason = NULL,
       readme_html = NULL, body_md = NULL, body_html = NULL, virtual_md = NULL, virtual_reason = NULL, images = '[]', scan = NULL,
       next_crawl = unixepoch() + 30 * 86400
     WHERE id = ? AND source = 'trawl'`,
  ).bind(reason, id).run();
  await markDirty(db);
}

/** A trawled candidate that failed a gate: nobody who never asked gets a public "rejected" page. Deleting cascades. */
export async function dropTrawled(db: D1Database, id: number, fullName: string, reason: string): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM repos WHERE id = ? AND source = 'trawl'").bind(id),
    db.prepare("INSERT OR REPLACE INTO trawl_skipped (full_name, reason) VALUES (?, ?)").bind(fullName.toLowerCase(), reason.slice(0, 300)),
  ]);
  await markDirty(db);
}
