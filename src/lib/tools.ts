// The tool registry: every AI coding tool the site knows, in one place.
//
// A tool used to live in seven hand-edited lists -- the topic map, the display regexes, the claim topics, the
// claim gate, the search grounds, the built_with vocabulary and the alias map -- and adding one meant touching
// all seven and bumping the method version. This file is the one list the other six are derived from, and
// the reason a tool a moderator approves on /mod can be searched for, credited and counted the same hour.
//
// Two kinds of tool. STATIC_TOOLS are frozen in code with the method; their searches are the named grounds in
// lib/virtual.ts. Rows in `tool_registry` are the ones the scout (jobs/scout.ts) found and a moderator
// approved; they are merged in by allTools() and searched under one extra ground, "The New Waters". A row whose
// key matches a static tool extends it (more aliases, more topics) rather than replacing it, which is how
// "meta-ai" can join muse-code without a deploy.
//
// This module is a leaf on purpose: it imports nothing from virtual.ts or the jobs, so every consumer can
// take a Tool[] as an argument and stay a pure function with the static list as its default.
import { normalizeValue } from "./vocab";

export interface Tool {
  /** The built_with value. Must survive normalizeValue unchanged, or a declared value can never equal it. */
  key: string;
  /** How the tool is named on a listing's signal line and in a legend. */
  name: string;
  /** Literal words a past-tense claim may use, whole-word, case-insensitive: "built with <alias>". */
  aliases: string[];
  /** Regex fragments for the claim gate. Static tools only: allTools() never reads this off a row. */
  raw?: string[];
  /** GitHub topics that ARE the owner's past-tense claim. A subset of `topics`, usually the built-with-* ones. */
  claimTopics: string[];
  /** GitHub topics that credit the tool in built_with without being a claim on their own ("cursor" on a repo). */
  topics: string[];
  /** GitHub search phrases, for a registry tool: '"built with kiro" in:description'. Static tools' searches live in TRAWL_GROUNDS. */
  phrases: string[];
}

/** One row of tool_registry, JSON columns parsed. */
export interface ToolRow {
  key: string;
  name: string;
  aliases: string[];
  claim_topics: string[];
  topics: string[];
  phrases: string[];
  note: string | null;
  approved_by: string;
  approved_at: number;
  retired_at: number | null;
}

/**
 * The tools the method froze, in the order the signal line prefers them (the first alias to match names the
 * tool). Transcribed from the seven lists this file replaced; test/tools.test.ts holds the old literals and
 * checks every derivation reproduces them exactly.
 */
export const STATIC_TOOLS: Tool[] = [
  { key: "claude-code", name: "Claude Code", aliases: ["claude code"], claimTopics: ["built-with-claude-code"], topics: ["claude-code", "built-with-claude-code"], phrases: [] },
  { key: "claude", name: "Claude", aliases: ["claude"], claimTopics: ["built-with-claude"], topics: ["claude", "built-with-claude"], phrases: [] },
  { key: "cursor", name: "Cursor", aliases: ["cursor"], claimTopics: ["built-with-cursor", "cursor-ai"], topics: ["cursor", "cursor-ai"], phrases: [] },
  { key: "copilot", name: "Copilot", aliases: ["copilot", "github copilot"], claimTopics: ["built-with-copilot", "github-copilot"], topics: ["copilot", "github-copilot"], phrases: [] },
  { key: "chatgpt", name: "ChatGPT", aliases: ["chatgpt"], raw: ["gpt-?\\d"], claimTopics: ["built-with-chatgpt", "built-with-gpt"], topics: ["chatgpt"], phrases: [] },
  { key: "codex", name: "Codex", aliases: ["codex"], claimTopics: [], topics: ["codex"], phrases: [] },
  { key: "gemini-cli", name: "Gemini CLI", aliases: ["gemini", "gemini cli"], claimTopics: ["built-with-gemini", "gemini-cli"], topics: ["gemini-cli"], phrases: [] },
  { key: "windsurf", name: "Windsurf", aliases: ["windsurf"], claimTopics: ["windsurf"], topics: ["windsurf"], phrases: [] },
  { key: "aider", name: "Aider", aliases: ["aider"], claimTopics: ["aider"], topics: ["aider"], phrases: [] },
  { key: "cline", name: "Cline", aliases: ["cline"], claimTopics: ["cline"], topics: ["cline"], phrases: [] },
  { key: "roo", name: "Roo Code", aliases: ["roo", "roo code"], claimTopics: ["roo-code", "built-with-roo"], topics: ["roo-code", "built-with-roo"], phrases: [] },
  { key: "muse-code", name: "Muse Code", aliases: ["muse", "muse code", "muse spark", "meta ai", "meta muse"], claimTopics: ["muse-code", "muse-spark", "meta-muse", "built-with-muse", "built-with-muse-code"], topics: ["muse-code", "muse-spark", "meta-muse", "built-with-muse", "built-with-muse-code"], phrases: [] },
  { key: "lovable", name: "Lovable", aliases: ["lovable"], claimTopics: ["built-with-lovable"], topics: ["lovable"], phrases: [] },
  { key: "bolt", name: "Bolt", aliases: ["bolt", "bolt.new"], claimTopics: ["built-with-bolt"], topics: ["bolt", "bolt-new"], phrases: [] },
  { key: "v0", name: "v0", aliases: ["v0"], claimTopics: ["built-with-v0"], topics: ["v0"], phrases: [] },
  { key: "replit", name: "Replit", aliases: ["replit"], claimTopics: [], topics: ["replit"], phrases: [] },
];

/** Topics that are a past-tense claim without naming any tool. Static: they are the population, not a dictionary entry. */
export const GENERIC_CLAIM_TOPICS = ["vibe-coded", "vibecoded", "ai-generated", "ai-written", "llm-generated"];

/** The claim gate's tool-less alternatives ("built by an AI"), kept verbatim from the old regex. */
const GENERIC_CLAIM_WORDS = "an? (llm|ai)|ai( agents?)?|llms";

// ---- merging the registry ----

/** Static plus registry. A row that names a static key extends it; a new key is appended in approval order; retired rows are skipped. */
export function allTools(rows: ToolRow[] = []): Tool[] {
  const out: Tool[] = STATIC_TOOLS.map((t) => ({ ...t, aliases: [...t.aliases], claimTopics: [...t.claimTopics], topics: [...t.topics], phrases: [...t.phrases] }));
  const live = rows.filter((r) => !r.retired_at).sort((a, b) => a.approved_at - b.approved_at || a.key.localeCompare(b.key));
  for (const r of live) {
    const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
    const have = out.find((t) => t.key === r.key);
    if (have) {
      have.aliases = union(have.aliases, r.aliases);
      have.claimTopics = union(have.claimTopics, r.claim_topics);
      have.topics = union(have.topics, r.topics);
      have.phrases = union(have.phrases, r.phrases);
    } else {
      // `raw` is deliberately absent: nothing a moderator typed ever becomes a regex fragment.
      out.push({ key: r.key, name: r.name, aliases: [...r.aliases], claimTopics: [...r.claim_topics], topics: [...r.topics], phrases: [...r.phrases] });
    }
  }
  return out;
}

const list = (s: unknown): string[] => {
  if (Array.isArray(s)) return s.map(String);
  try { const v = JSON.parse(String(s ?? "[]")); return Array.isArray(v) ? v.map(String) : []; } catch { return []; }
};

/** The registry as rows, JSON columns parsed. Mirrors loadDenyRows: callers pass the rows in, nothing reads by side effect. */
export async function loadToolRows(db: D1Database): Promise<ToolRow[]> {
  const r = await db.prepare("SELECT key, name, aliases, claim_topics, topics, phrases, note, approved_by, approved_at, retired_at FROM tool_registry ORDER BY approved_at, key").all<Record<string, unknown>>();
  return (r.results ?? []).map((x) => ({
    key: String(x.key), name: String(x.name), aliases: list(x.aliases), claim_topics: list(x.claim_topics), topics: list(x.topics), phrases: list(x.phrases),
    note: x.note == null ? null : String(x.note), approved_by: String(x.approved_by ?? ""), approved_at: Number(x.approved_at) || 0, retired_at: x.retired_at == null ? null : Number(x.retired_at),
  }));
}

// ---- the derivations the rest of the site reads ----

/** Regex-safe literal, whitespace loosened. The same escaper the denylist uses. */
export const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");

/**
 * topic -> built_with key, the map buildVirtualMd credits from. Credit topics only: a claim topic such as
 * built-with-cursor is a claim, and the method as frozen did not also read it as a credit. The approve form
 * on /mod prefills both lists with the same topics, so a registry tool gets both unless a moderator says not.
 */
export function topicMap(tools: Tool[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tools) for (const topic of t.topics) out[topic] ??= t.key;
  return out;
}

/** Every topic that is a past-tense claim: the generic ones, then each tool's. */
export function vibeTopics(tools: Tool[]): string[] {
  return [...new Set([...GENERIC_CLAIM_TOPICS, ...tools.flatMap((t) => t.claimTopics)])];
}

/**
 * The owner's own past-tense claim that an AI tool wrote this project, as one regex. The shape is the old
 * CLAIM_RE's exactly; only the tool alternation is derived. Longest alias first, so "claude code" is tried
 * before "claude" and the snippet window gets the whole name.
 */
export function claimRe(tools: Tool[]): RegExp {
  const alts = [
    ...tools.flatMap((t) => t.aliases).sort((a, b) => b.length - a.length || a.localeCompare(b)).map(escapeRe),
    ...tools.flatMap((t) => t.raw ?? []),
  ];
  const named = alts.length ? `${alts.join("|")}|` : "";
  return new RegExp(
    `\\bvibe[- ]?coded\\b|\\b(built|made|written|coded|created|generated|developed)\\s+(entirely\\s+|mostly\\s+|completely\\s+|fully\\s+|100%\\s+|almost entirely\\s+)?(with|using|by)\\s+(${named}${GENERIC_CLAIM_WORDS})\\b|\\b100%\\s+ai[- ]generated\\b|\\bentirely ai[- ]generated\\b`,
    "i",
  );
}

/** One display regex per tool name, in registry order, for the "says it was built with X" signal. */
export function signalTools(tools: Tool[]): [RegExp, string][] {
  const out: [RegExp, string][] = [];
  for (const t of tools) {
    if (out.some(([, name]) => name === t.name)) continue;
    const same = tools.filter((x) => x.name === t.name);
    const alts = [...same.flatMap((x) => x.aliases).sort((a, b) => b.length - a.length).map(escapeRe), ...same.flatMap((x) => x.raw ?? [])];
    if (alts.length) out.push([new RegExp(`\\b(${alts.join("|")})\\b`, "i"), t.name]);
  }
  return out;
}

/** The built_with values, in registry order. vocab.ts keeps its own literal tuple; a test pins the two together. */
export const builtWithValues = (tools: Tool[]): string[] => tools.map((t) => t.key);

/** alias (normalised) -> key, for folding a declared value onto its tool. */
export function aliasMap(tools: Tool[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const t of tools) for (const a of t.aliases) {
    const n = a.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9.+#-]/g, "");
    if (n && n !== t.key) out[n] ??= t.key;
  }
  return out;
}

/** The searches a registry tool adds, in approval order: a topic search per claim topic, then its phrases. Retired rows add nothing. */
export function extraQueries(rows: ToolRow[]): string[] {
  const live = rows.filter((r) => !r.retired_at).sort((a, b) => a.approved_at - b.approved_at || a.key.localeCompare(b.key));
  return live.flatMap((r) => [...r.claim_topics.map((t) => `topic:${t}`), ...r.phrases]);
}

// ---- what a moderator may type ----

const ALIAS_RE = /^[a-z0-9][a-z0-9 .+#-]{0,38}[a-z0-9]$/;
const TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,49}$/;
const PHRASE_RE = /^"[a-z0-9][a-z0-9 .+#-]{0,60}" in:description$/;

export interface ToolInput { key: string; name: string; aliases: string[]; claimTopics: string[]; topics: string[]; phrases: string[] }

/**
 * Validate a registry entry before it can reach a regex or a search. Every rule here exists because its
 * absence would let one approval break the claim gate for every tool: an empty alias matches every "made by",
 * a trailing "+" breaks the word boundary, a metacharacter is a pattern.
 */
export function validateToolInput(input: ToolInput, existing: Tool[]): { ok: true; tool: ToolInput } | { ok: false; error: string } {
  const key = input.key.trim().toLowerCase();
  if (!key || normalizeValue(key) !== key) return { ok: false, error: `key "${input.key}" must be a lowercase slug that normalizes to itself` };
  if (key === "other") return { ok: false, error: "\"other\" is the fold bucket, not a tool" };
  const name = input.name.trim().slice(0, 40);
  if (name.length < 2) return { ok: false, error: "name is required" };
  const clean = (xs: string[]) => [...new Set(xs.map((x) => x.trim().toLowerCase().replace(/\s+/g, " ")).filter(Boolean))];
  const aliases = clean(input.aliases);
  if (!aliases.length) return { ok: false, error: "at least one alias is required: the words a claim would use" };
  const taken = new Map<string, string>();
  for (const t of existing) if (t.key !== key) for (const a of t.aliases) taken.set(a.toLowerCase(), t.key);
  for (const a of aliases) {
    if (!ALIAS_RE.test(a)) return { ok: false, error: `alias "${a}" must be 2 to 40 characters of letters, digits, spaces, . + # or -, ending in a letter or digit` };
    if (STOPLIST.has(a) || STOPLIST.has(a.replace(/\s+/g, "-"))) return { ok: false, error: `alias "${a}" is a generic word, not a tool` };
    if (taken.has(a)) return { ok: false, error: `alias "${a}" already names ${taken.get(a)}` };
  }
  const claimTopics = clean(input.claimTopics);
  const topics = clean([...input.topics, ...claimTopics]);
  for (const t of [...claimTopics, ...topics]) if (!TOPIC_RE.test(t)) return { ok: false, error: `topic "${t}" is not a GitHub topic slug` };
  const phrases = clean(input.phrases);
  for (const p of phrases) if (!PHRASE_RE.test(p)) return { ok: false, error: `phrase ${p} must look like "built with kiro" in:description` };
  return { ok: true, tool: { key, name, aliases, claimTopics, topics, phrases } };
}

/**
 * Write an approval. A key the registry already holds is widened (union of every list) rather than replaced,
 * so merging "meta-ai" into muse-code, or a second approval for the same tool, only ever adds. The static
 * tools are never written here: an extension row for a frozen key is exactly how they grow.
 */
export async function upsertToolRow(db: D1Database, t: ToolInput, by: string, note: string | null, at: number): Promise<"added" | "widened"> {
  const have = (await loadToolRows(db)).find((r) => r.key === t.key);
  const union = (a: string[], b: string[]) => [...new Set([...a, ...b])];
  if (have) {
    await db.prepare("UPDATE tool_registry SET aliases = ?, claim_topics = ?, topics = ?, phrases = ?, note = coalesce(?, note), retired_at = NULL WHERE key = ?")
      .bind(JSON.stringify(union(have.aliases, t.aliases)), JSON.stringify(union(have.claim_topics, t.claimTopics)), JSON.stringify(union(have.topics, t.topics)), JSON.stringify(union(have.phrases, t.phrases)), note, t.key).run();
    return "widened";
  }
  await db.prepare("INSERT INTO tool_registry (key, name, aliases, claim_topics, topics, phrases, note, approved_by, approved_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .bind(t.key, t.name, JSON.stringify(t.aliases), JSON.stringify(t.claimTopics), JSON.stringify(t.topics), JSON.stringify(t.phrases), note, by, at).run();
  return STATIC_TOOLS.some((s) => s.key === t.key) ? "widened" : "added";
}

// ---- sightings: the raw material the scout works from ----

/** "built with <something>" in a description or README. The capture is the something, greedy and unnormalised. */
export const BUILT_WITH_RE = /\b(?:built|made|written|coded|created|generated|developed)\s+(?:entirely\s+|mostly\s+|completely\s+|fully\s+|100%\s+|almost entirely\s+)?(?:with|using|by)\s+([a-z0-9.\- ]{2,20})/i;

/** Where a "built with X" capture stops meaning the tool and starts being the rest of the sentence. */
const CAPTURE_STOP = new Set(["in", "for", "and", "or", "over", "on", "the", "a", "an", "my", "our", "using", "by", "to", "at", "as", "from", "during", "while", "of", "under", "within", "just", "only"]);

/**
 * Words the scout must never propose as a tool. Languages, frameworks and the things people say they built
 * things with that are not tools at all. A moderator can still type any of these by hand; the scout cannot.
 */
export const STOPLIST = new Set([
  "ai", "an-ai", "llm", "llms", "ml", "ai-agent", "ai-agents", "agents", "agent", "bot", "bots", "chatbot", "help", "the-help", "assistance",
  "love", "passion", "care", "hand", "hands", "scratch", "heart", "pride", "fun", "coffee", "tears", "spite", "rage", "boredom", "vibes", "vibe",
  "python", "javascript", "typescript", "js", "ts", "react", "reactjs", "vue", "svelte", "sveltekit", "angular", "solid", "solidjs", "astro", "htmx",
  "rust", "go", "golang", "java", "kotlin", "swift", "swiftui", "flutter", "dart", "node", "nodejs", "deno", "bun", "next", "nextjs", "nuxt", "remix",
  "django", "flask", "fastapi", "rails", "ruby", "php", "laravel", "csharp", "dotnet", "cpp", "c", "html", "css", "tailwind", "tailwindcss", "bootstrap",
  "electron", "tauri", "unity", "godot", "unreal", "docker", "kubernetes", "k8s", "sqlite", "postgres", "postgresql", "mysql", "redis", "supabase", "firebase",
  "vanilla", "pure", "plain", "tools", "tool", "api", "apis", "sdk", "cli", "gui", "web", "code", "software", "hardware", "arduino", "esp32", "raspberry-pi",
  "openai-api", "chatgpt-api", "claude-api", "gpt", "gpt-4", "gpt4", "ai-tools", "ai-assistance", "ai-help", "generative-ai", "machine-learning",
]);

export interface Sighting { term: string; kind: "topic" | "phrase" }

/**
 * A term as the scout stores it: normalised like a facet value, aliases folded, 3 to 30 characters. A dot may
 * sit inside a name (node.js) but never at either end: there it is the sentence's full stop, not the tool's.
 */
export function normalizeTerm(raw: string): string | null {
  const t = normalizeValue(raw).replace(/^[-.]+|[-.]+$/g, "");
  return t.length >= 3 && t.length <= 30 && !/^\d+$/.test(t) ? t : null;
}

/** Everything the registry already knows, normalised, so a sighting of a known tool is not a sighting. */
export function knownTerms(tools: Tool[]): Set<string> {
  const out = new Set<string>();
  for (const t of tools) {
    out.add(t.key);
    for (const a of t.aliases) { const n = normalizeTerm(a); if (n) out.add(n); }
    for (const topic of [...t.topics, ...t.claimTopics]) {
      out.add(topic);
      const tail = /^(?:built|made|coded|generated|vibe-coded)-with-(.+)$/.exec(topic)?.[1];
      if (tail) out.add(tail);
    }
  }
  return out;
}

/**
 * The unknown tool names one candidate mentions: a `built-with-<x>` topic, or "built with <x>" in its
 * description or README. Known tools, generic words and the rest of the sentence are left out; what remains
 * is exactly what a moderator would want to be told about.
 */
export function extractSightings(g: { topics?: string[] | null; description?: string | null }, readme: string | null, tools: Tool[] = STATIC_TOOLS): Sighting[] {
  const known = knownTerms(tools);
  const out = new Map<string, Sighting>();
  const keep = (raw: string, kind: Sighting["kind"]) => {
    const term = normalizeTerm(raw);
    if (!term || known.has(term) || STOPLIST.has(term)) return;
    if (!out.has(term)) out.set(term, { term, kind });
  };
  for (const topic of g.topics ?? []) {
    const tail = /^(?:built|made|coded|generated|vibe-coded)-with-(.+)$/.exec(topic.toLowerCase())?.[1];
    if (tail) keep(tail, "topic");
  }
  for (const text of [g.description ?? "", readme ?? ""]) {
    if (!text) continue;
    const flat = text.replace(/```[\s\S]*?```/g, " ").replace(/[`*_>#|\[\]]/g, " ").replace(/https?:\/\/\S+/g, " ");
    const re = new RegExp(BUILT_WITH_RE.source, "gi");
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = re.exec(flat)) && guard++ < 20) {
      const words: string[] = [];
      for (const raw of m[1].trim().toLowerCase().split(/\s+/)) {
        // "built with Claude. It does X": the full stop ends the name as surely as it ends the sentence.
        const w = raw.replace(/\.+$/, "");
        if (!w || CAPTURE_STOP.has(w)) break;
        words.push(w);
        if (words.length === 2 || w !== raw) break;
      }
      if (words.length) keep(words.join(" "), "phrase");
    }
  }
  return [...out.values()];
}
