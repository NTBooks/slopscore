// Controlled vocabularies for slopscore.md. Published at /api/v1/vocab and docs/SPEC.md.

export const SPEC_VERSION = 2;
/** Canonical URL of the contract. Every slopscore.md names it in `spec:`, so the file credits the spec it follows. */
export const SPEC_URL = "https://slopscore.org/spec";
/** True when a declared `spec:` value points at the canonical spec. Tolerates protocol, www, a trailing slash, and .md. */
export function isSpecUrl(v: unknown): boolean {
  if (typeof v !== "string") return false;
  const s = v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\.md$|\/$/, "");
  return s === "slopscore.org/spec";
}

export const AI_GENERATED = ["entirely", "mostly", "partly", "none"] as const;
export const HUMAN_TOUCH = ["none", "light", "heavy"] as const;
export const CONTENT_RATING = ["everyone", "mature", "adult"] as const;
export const STATUS = [
  "idea", "prototype", "works-on-my-machine", "alpha", "beta", "stable", "maintained", "abandoned",
] as const;
export const WIP_STATUSES = new Set(["idea", "prototype", "works-on-my-machine", "alpha"]);

export const CONTAINS_LISTED = [
  "crypto", "financial", "medical", "legal", "scraping", "security-research",
  "weapons-fiction", "gambling-sim", "mild-language",
] as const;
export const CONTAINS_REJECTED = [
  "nudity", "sexual", "gore", "hate", "harassment", "drugs", "real-weapons", "malware", "spam",
] as const;

export const CATEGORY = [
  "devtools", "cli", "web-app", "mobile", "game", "library", "api", "bot", "agent", "mcp-server",
  "data", "ml", "automation", "iot", "media", "productivity", "security", "finance", "education",
  "science", "art", "social", "infra", "plugin", "extension", "template", "dataset", "docs", "toy",
  "other",
] as const;

export const BUILT_WITH = [
  "claude-code", "claude", "cursor", "copilot", "codex", "gemini-cli", "windsurf", "aider", "cline",
  "chatgpt", "lovable", "bolt", "v0", "replit", "other",
] as const;
export const INTERFACE = [
  "cli", "tui", "web", "desktop", "mobile", "api", "library", "bot", "mcp", "plugin", "headless",
] as const;
export const PLATFORMS = [
  "linux", "macos", "windows", "android", "ios", "web", "docker", "cloudflare", "aws", "gcp",
  "azure", "raspberry-pi", "browser",
] as const;
export const AUDIENCE = ["developers", "end-users", "researchers", "kids", "enterprises", "agents", "me"] as const;
export const DATA = ["none", "local-only", "sends-telemetry", "needs-api-key", "stores-pii", "scrapes"] as const;

/** Facets whose values are a closed vocabulary. Unknown values are kept as free tags, flagged unrecognized. */
export const CONTROLLED: Record<string, readonly string[]> = {
  ai_generated: AI_GENERATED,
  human_touch: HUMAN_TOUCH,
  content_rating: CONTENT_RATING,
  status: STATUS,
  contains: [...CONTAINS_LISTED, ...CONTAINS_REJECTED],
  category: CATEGORY,
  built_with: BUILT_WITH,
  interface: INTERFACE,
  platforms: PLATFORMS,
  audience: AUDIENCE,
  data: DATA,
};

/** Free-vocabulary facets. */
export const FREE_FACETS = ["slopbucket", "models", "frameworks", "needs", "domain", "tags"] as const;

/** All facets that land in repo_tags from the marker file, in display order. */
export const DECLARED_FACETS = [
  "slopbucket", "category", "ai_generated", "human_touch", "status", "contains", "built_with", "models",
  "interface", "frameworks", "platforms", "audience", "data", "needs", "domain", "tags",
] as const;

/** Facets filled from GitHub, source=detected. */
export const DETECTED_FACETS = ["language", "topic", "license"] as const;

/** Alias normalization: input (lowercased) -> canonical value. Applied to every facet value. */
export const ALIASES: Record<string, string> = {
  cc: "claude-code",
  "claude code": "claude-code",
  claudecode: "claude-code",
  "github-copilot": "copilot",
  "github copilot": "copilot",
  "openai-codex": "codex",
  "gemini cli": "gemini-cli",
  gemini: "gemini-cli",
  gpt: "chatgpt",
  "gpt-4": "chatgpt",
  "gpt4": "chatgpt",
  k8s: "kubernetes",
  js: "javascript",
  ts: "typescript",
  py: "python",
  rb: "ruby",
  rs: "rust",
  golang: "go",
  "c++": "cpp",
  "c#": "csharp",
  "node": "nodejs",
  "node.js": "nodejs",
  "next": "nextjs",
  "next.js": "nextjs",
  "vue.js": "vue",
  "react.js": "react",
  "svelte-kit": "sveltekit",
  "mac": "macos",
  "osx": "macos",
  "win": "windows",
  "rpi": "raspberry-pi",
  "raspberrypi": "raspberry-pi",
  "cf": "cloudflare",
  "workers": "cloudflare",
  "cloudflare-workers": "cloudflare",
  "devs": "developers",
  "developer": "developers",
  "users": "end-users",
  "end users": "end-users",
  "myself": "me",
  "wip": "prototype",
  "works": "works-on-my-machine",
  "fully": "entirely",
  "all": "entirely",
  "100%": "entirely",
  "some": "partly",
  "partially": "partly",
  "heavily": "heavy",
  "lightly": "light",
  "minimal": "light",
  "web-ui": "web",
  "website": "web",
  "webapp": "web-app",
  "command-line": "cli",
  "terminal": "cli",
  "everybody": "everyone",
  "general": "everyone",
  "g": "everyone",
};

/** Search operators -> facet (or column) they filter. */
export const SEARCH_OPERATORS: Record<string, { facet?: string; column?: string }> = {
  category: { facet: "category" },
  cat: { facet: "category" },
  lang: { facet: "language" },
  language: { facet: "language" },
  tool: { facet: "built_with" },
  built_with: { facet: "built_with" },
  model: { facet: "models" },
  platform: { facet: "platforms" },
  interface: { facet: "interface" },
  ui: { facet: "interface" },
  audience: { facet: "audience" },
  data: { facet: "data" },
  human: { facet: "human_touch" },
  ai: { facet: "ai_generated" },
  status: { facet: "status" },
  contains: { facet: "contains" },
  framework: { facet: "frameworks" },
  needs: { facet: "needs" },
  domain: { facet: "domain" },
  tag: { facet: "tags" },
  bucket: { facet: "slopbucket" },
  slopbucket: { facet: "slopbucket" },
  topic: { facet: "topic" },
  license: { facet: "license" },
  owner: { column: "owner" },
  user: { column: "owner" },
  tier: { column: "tier" },
};

export function normalizeValue(raw: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase();
  const aliased = ALIASES[s] ?? s;
  return aliased.replace(/\s+/g, "-").replace(/[^a-z0-9.+#-]/g, "");
}

export function isRecognized(facet: string, value: string): boolean {
  const vocab = CONTROLLED[facet];
  if (!vocab) return true; // free facet
  return vocab.includes(value);
}

export const vocabJson = () => ({
  spec: SPEC_VERSION,
  spec_url: SPEC_URL,
  required: ["slopscore", "spec", "ai_generated", "human_touch", "content_rating", "contains", "category", "status"],
  controlled: CONTROLLED,
  contains: { listed: CONTAINS_LISTED, rejected: CONTAINS_REJECTED },
  free: FREE_FACETS,
  detected: DETECTED_FACETS,
  aliases: ALIASES,
  search_operators: Object.fromEntries(Object.entries(SEARCH_OPERATORS).map(([k, v]) => [k, v.facet ?? v.column])),
});
