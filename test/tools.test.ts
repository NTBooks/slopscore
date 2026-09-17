import { describe, it, expect } from "vitest";
import {
  STATIC_TOOLS, GENERIC_CLAIM_TOPICS, allTools, aliasMap, builtWithValues, claimRe, extractSightings, extraQueries, knownTerms,
  normalizeTerm, signalTools, topicMap, validateToolInput, vibeTopics, type ToolRow,
} from "../src/lib/tools";
import { BUILT_WITH } from "../src/lib/vocab";

// The seven lists this registry replaced, copied verbatim from the code as it stood on 2026-09-16. Every
// derivation must reproduce them: the registry is a refactor of the method, not a change to it.
const LEGACY_CLAIM_RE = /\bvibe[- ]?coded\b|\b(built|made|written|coded|created|generated|developed)\s+(entirely\s+|mostly\s+|completely\s+|fully\s+|100%\s+|almost entirely\s+)?(with|using|by)\s+(claude(\s+code)?|cursor|copilot|github copilot|codex|gemini( cli)?|windsurf|aider|cline|roo( code)?|muse( code| spark)?|meta ai|meta muse|lovable|bolt(\.new)?|v0|replit|chatgpt|gpt-?\d|an? (llm|ai)|ai( agents?)?|llms)\b|\b100%\s+ai[- ]generated\b|\bentirely ai[- ]generated\b/i;
const LEGACY_VIBE_TOPICS = [
  "vibe-coded", "vibecoded", "ai-generated", "ai-written", "llm-generated",
  "built-with-claude", "built-with-claude-code", "built-with-cursor", "cursor-ai",
  "built-with-chatgpt", "built-with-gpt", "built-with-copilot", "github-copilot",
  "built-with-gemini", "gemini-cli", "built-with-v0", "built-with-bolt", "built-with-lovable",
  "windsurf", "aider", "cline", "roo-code", "built-with-roo",
  "muse-code", "muse-spark", "meta-muse", "built-with-muse", "built-with-muse-code",
];
const LEGACY_TOPIC_TOOL: Record<string, string> = {
  "claude-code": "claude-code", "built-with-claude-code": "claude-code", claude: "claude", "built-with-claude": "claude",
  cursor: "cursor", "cursor-ai": "cursor", copilot: "copilot", "github-copilot": "copilot", codex: "codex",
  "gemini-cli": "gemini-cli", windsurf: "windsurf", aider: "aider", cline: "cline", chatgpt: "chatgpt",
  lovable: "lovable", bolt: "bolt", "bolt-new": "bolt", v0: "v0", replit: "replit",
  "roo-code": "roo", "built-with-roo": "roo",
  "muse-code": "muse-code", "muse-spark": "muse-code", "meta-muse": "muse-code", "built-with-muse": "muse-code", "built-with-muse-code": "muse-code",
};
// The old table had one "Claude" for both Claude keys and "Gemini" for the CLI; the registry names each key.
const DISPLAY = ["Claude Code", "Claude", "Cursor", "Copilot", "ChatGPT", "Codex", "Gemini CLI", "Windsurf", "Aider", "Cline", "Roo Code", "Muse Code", "Lovable", "Bolt", "v0", "Replit"];

const row = (over: Partial<ToolRow>): ToolRow => ({ key: "kiro", name: "Kiro", aliases: ["kiro"], claim_topics: ["built-with-kiro"], topics: ["kiro", "built-with-kiro"], phrases: ['"built with kiro" in:description'], note: null, approved_by: "NTBooks", approved_at: 1_789_000_000, retired_at: null, ...over });

describe("the registry reproduces the seven lists it replaced", () => {
  it("accepts and rejects exactly what the old claim gate did, over every verb, qualifier and tool", () => {
    const re = claimRe(STATIC_TOOLS);
    const verbs = ["built", "made", "written", "coded", "created", "generated", "developed"];
    const quals = ["", "entirely ", "mostly ", "completely ", "fully ", "100% ", "almost entirely "];
    const preps = ["with", "using", "by"];
    const alts = ["claude", "claude code", "cursor", "copilot", "github copilot", "codex", "gemini", "gemini cli", "windsurf", "aider", "cline", "roo", "roo code", "muse", "muse code", "muse spark", "meta ai", "meta muse", "lovable", "bolt", "bolt.new", "v0", "replit", "chatgpt", "gpt-4", "gpt4", "gpt5", "an llm", "an ai", "ai", "ai agent", "ai agents", "llms",
      "love", "react", "hand", "kiro", "meta", "python", "an intern", "gpt", "aiders", "clinex", "roost", "cursors", "bolted"];
    let checked = 0;
    for (const v of verbs) for (const q of quals) for (const p of preps) for (const a of alts) {
      const s = `A little tool, ${v} ${q}${p} ${a} over a weekend.`;
      expect(re.test(s), s).toBe(LEGACY_CLAIM_RE.test(s));
      checked++;
    }
    expect(checked).toBeGreaterThan(5000);
    for (const s of [
      "vibe coded", "It was vibe-coded.", "100% ai-generated", "entirely AI generated", "This is 100% AI-generated code",
      "A tool that helps you vibe code faster", "vibe coding", "created by Meta.", "made by hand", "bolted on", "v0.1 release", "gpt",
      "A JavaScript library for building user interfaces, created by Meta.",
      "A little tool. Built with Muse Code over a weekend.", "Built with Meta AI", "Built with Roo", "Built with GitHub Copilot", "Built with Gemini CLI",
    ]) expect(re.test(s), s).toBe(LEGACY_CLAIM_RE.test(s));
  });

  it("keeps the tool-less claims even with no tools at all", () => {
    const bare = claimRe([]);
    expect(bare.test("vibe coded")).toBe(true);
    expect(bare.test("built by an AI")).toBe(true);
    expect(bare.test("built with claude")).toBe(false);
  });

  it("maps every topic to the same key, claims the same topics, and lists the same built_with values", () => {
    expect(topicMap(STATIC_TOOLS)).toEqual(LEGACY_TOPIC_TOOL);
    expect(new Set(vibeTopics(STATIC_TOOLS))).toEqual(new Set(LEGACY_VIBE_TOPICS));
    expect(vibeTopics(STATIC_TOOLS).slice(0, 5)).toEqual(GENERIC_CLAIM_TOPICS);
    expect([...builtWithValues(STATIC_TOOLS)].sort()).toEqual(BUILT_WITH.filter((v) => v !== "other").sort());
  });

  it("names tools on the signal line in the old order, one entry per name", () => {
    const names = signalTools(STATIC_TOOLS).map(([, n]) => n);
    expect(names).toEqual(DISPLAY);
    const find = (s: string) => signalTools(STATIC_TOOLS).find(([re]) => re.test(s))?.[1];
    expect(find("Claude Code in an afternoon")).toBe("Claude Code");
    expect(find("gpt-4")).toBe("ChatGPT");
    expect(find("Meta AI")).toBe("Muse Code");
    expect(find("Claude over a weekend")).toBe("Claude");
    expect(find("love")).toBeUndefined();
  });

  it("folds every alias onto its key without inventing one for the key itself", () => {
    const m = aliasMap(STATIC_TOOLS);
    expect(m["claude-code"]).toBeUndefined();
    expect(m["github-copilot"]).toBe("copilot");
    expect(m["meta-ai"]).toBe("muse-code");
    expect(m["bolt.new"]).toBe("bolt");
  });
});

describe("merging the registry", () => {
  it("appends a new tool in approval order and extends a static one it names", () => {
    const tools = allTools([
      row({ key: "amazon-q", name: "Amazon Q", aliases: ["amazon q"], approved_at: 2 }),
      row({ approved_at: 1 }),
      row({ key: "muse-code", name: "ignored", aliases: ["meta ai studio"], claim_topics: ["meta-ai"], topics: ["meta-ai"], phrases: [], approved_at: 3 }),
    ]);
    expect(tools.slice(-2).map((t) => t.key)).toEqual(["kiro", "amazon-q"]);
    const muse = tools.find((t) => t.key === "muse-code")!;
    expect(muse.name).toBe("Muse Code");
    expect(muse.aliases).toContain("meta ai studio");
    expect(muse.claimTopics).toContain("meta-ai");
    expect(topicMap(tools)["meta-ai"]).toBe("muse-code");
    expect(claimRe(tools).test("built with Kiro")).toBe(true);
    expect(claimRe(STATIC_TOOLS).test("built with Kiro")).toBe(false);
  });

  it("never reads a regex fragment off a row, and skips a retired one", () => {
    const tools = allTools([row({ ...({ raw: ["(.*)+"] } as object), key: "evil", name: "Evil", aliases: ["evil"] }), row({ key: "gone", name: "Gone", aliases: ["gone"], retired_at: 5 })]);
    expect(tools.find((t) => t.key === "evil")?.raw).toBeUndefined();
    expect(tools.find((t) => t.key === "gone")).toBeUndefined();
  });

  it("adds a registry tool's searches after every static one, in approval order, and none for a retired tool", () => {
    const q = extraQueries([row({ approved_at: 2 }), row({ key: "amazon-q", aliases: ["amazon q"], claim_topics: ["built-with-amazon-q"], phrases: ['"built with amazon q" in:description'], approved_at: 1 }), row({ key: "gone", retired_at: 9, approved_at: 0 })]);
    expect(q).toEqual(["topic:built-with-amazon-q", '"built with amazon q" in:description', "topic:built-with-kiro", '"built with kiro" in:description']);
  });
});

describe("what a moderator may type", () => {
  const ok = { key: "kiro", name: "Kiro", aliases: ["kiro", "amazon kiro"], claimTopics: ["built-with-kiro"], topics: ["kiro"], phrases: ['"built with kiro" in:description'] };
  it("accepts a clean entry and normalises it", () => {
    const r = validateToolInput({ ...ok, aliases: [" Kiro ", "Amazon  Kiro"] }, STATIC_TOOLS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.tool.aliases).toEqual(["kiro", "amazon kiro"]);
    if (r.ok) expect(r.tool.topics).toContain("built-with-kiro");
  });
  it("refuses everything that could break the claim gate for every other tool", () => {
    const bad = (over: Partial<typeof ok>) => { const r = validateToolInput({ ...ok, ...over }, STATIC_TOOLS); return r.ok ? null : r.error; };
    expect(bad({ aliases: [] })).toMatch(/alias/);
    expect(bad({ aliases: [""] })).toMatch(/alias/);
    expect(bad({ aliases: ["c++"] })).toMatch(/ending in/);
    expect(bad({ aliases: ["(.*)+"] })).toMatch(/alias/);
    expect(bad({ aliases: ["love"] })).toMatch(/generic word/);
    expect(bad({ aliases: ["cursor"] })).toMatch(/already names cursor/);
    expect(bad({ key: "Kiro Pro" })).toMatch(/slug/);
    expect(bad({ key: "other" })).toMatch(/fold bucket/);
    expect(bad({ claimTopics: ["Built With Kiro"] })).toMatch(/topic/);
    expect(bad({ phrases: ["kiro"] })).toMatch(/phrase/);
  });
});

describe("sightings", () => {
  it("names the tool a candidate credits and nothing else", () => {
    const s = extractSightings({ topics: ["built-with-kiro", "discord-bot", "built-with-claude-code", "built-with-ai"], description: "A snack bot, built with Kiro in a weekend and shipped with love." }, "Made entirely using Amazon Q Developer over two evenings. Built with React and Tailwind.");
    expect(s).toEqual([{ term: "kiro", kind: "topic" }, { term: "amazon-q", kind: "phrase" }]);
  });
  it("folds known names and generic words away before they can become candidates", () => {
    expect(extractSightings({ topics: ["built-with-muse", "built-with-gpt", "built-with-roo"], description: "built with GitHub Copilot, then made by hand, then created by Meta AI, then built with Gemini CLI, built with an AI" }, null)).toEqual([]);
    expect(knownTerms(STATIC_TOOLS).has("gpt")).toBe(true); // the tail of built-with-gpt
    expect(normalizeTerm("gpt")).toBe("chatgpt");
    expect(normalizeTerm("  ")).toBeNull();
    expect(normalizeTerm("12")).toBeNull();
  });
  it("sees a registry tool as known once it is approved", () => {
    const tools = allTools([row({})]);
    expect(extractSightings({ topics: ["built-with-kiro"], description: "built with kiro" }, null, tools)).toEqual([]);
  });
});
