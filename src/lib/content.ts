// Gate 3: content. Secrets, link safety (Google Safe Browsing), Llama Guard on text, a vision check on the thumbnail.
// Every Workers AI call is metered against a daily neuron budget kept in crawl_state so the free tier never silently fails.
import type { Env } from "../env";
import { CONTAINS_LISTED } from "./vocab";

export const NEURONS_PER_1K_INPUT_TOKENS = 44;       // @cf/meta/llama-guard-3-8b
export const VISION_NEURONS = 12;                   // ~1–2k image tokens at 4.4/1k, plus a few output tokens
export const GUARD_TEXT_CAP = 16_000;               // chars ≈ 5k tokens ≈ 230 neurons

export const SECRET_PATTERNS: [RegExp, string][] = [
  [/AKIA[0-9A-Z]{16}/, "AWS access key"],
  [/ghp_[A-Za-z0-9]{36}/, "GitHub personal token"],
  [/github_pat_[A-Za-z0-9_]{60,}/, "GitHub fine-grained token"],
  [/xox[abpr]-[0-9A-Za-z-]{10,}/, "Slack token"],
  [/sk-[A-Za-z0-9]{32,}/, "OpenAI-style secret key"],
  [/sk-ant-[A-Za-z0-9-]{20,}/, "Anthropic key"],
  [/AIza[0-9A-Za-z_-]{35}/, "Google API key"],
  [/-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/, "private key"],
  [/eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/, "JWT"],
];

export function findSecrets(text: string): string[] {
  return SECRET_PATTERNS.filter(([re]) => re.test(text)).map(([, label]) => label);
}

// ---- neuron budget ----
export async function neuronsUsedToday(db: D1Database): Promise<number> {
  const key = `ai_neurons:${new Date().toISOString().slice(0, 10)}`;
  const r = await db.prepare("SELECT value FROM crawl_state WHERE key = ?").bind(key).first<{ value: string }>();
  return Number(r?.value ?? 0);
}
export async function spendNeurons(db: D1Database, n: number): Promise<void> {
  const day = new Date().toISOString().slice(0, 10);
  await db.batch([
    db.prepare("INSERT INTO crawl_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + ? AS TEXT)").bind(`ai_neurons:${day}`, String(n), n),
    db.prepare("INSERT INTO stats_daily (date, neurons_used) VALUES (?, ?) ON CONFLICT(date) DO UPDATE SET neurons_used = neurons_used + ?").bind(day, n, n),
  ]);
}
export function estimateGuardNeurons(text: string): number {
  return Math.ceil((Math.min(text.length, GUARD_TEXT_CAP) / 4 / 1000) * NEURONS_PER_1K_INPUT_TOKENS) + 2;
}
/** True if the budget can absorb `n` more neurons today. */
export async function budgetAllows(db: D1Database, env: Env, n: number): Promise<{ ok: boolean; used: number; budget: number }> {
  const used = await neuronsUsedToday(db);
  const budget = Number(env.AI_NEURON_BUDGET || 9000);
  return { ok: env.PLAN_MODE === "paid" || used + n <= budget, used, budget };
}

// ---- Safe Browsing ----
export async function safeBrowsing(links: string[], key: string | undefined): Promise<{ checked: boolean; bad: string[] }> {
  if (!key || !links.length) return { checked: false, bad: [] };
  const res = await fetch(`https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client: { clientId: "slopscore", clientVersion: "1.0" },
      threatInfo: {
        threatTypes: ["MALWARE", "SOCIAL_ENGINEERING", "UNWANTED_SOFTWARE", "POTENTIALLY_HARMFUL_APPLICATION"],
        platformTypes: ["ANY_PLATFORM"], threatEntryTypes: ["URL"],
        threatEntries: links.slice(0, 500).map((url) => ({ url })),
      },
    }),
  });
  if (!res.ok) return { checked: false, bad: [] };
  const j = (await res.json()) as { matches?: { threat: { url: string }; threatType: string }[] };
  return { checked: true, bad: (j.matches ?? []).map((m) => `${m.threat.url} (${m.threatType})`) };
}

// ---- Llama Guard ----
/** Llama Guard 3 hazard categories → what a repo must have disclosed for us to keep it, and how hard we react. */
export const GUARD_MAP: Record<string, { label: string; disclose: string[]; severity: "reject" | "flag" | "ignore" }> = {
  S1: { label: "violent crimes", disclose: ["weapons-fiction"], severity: "reject" },
  S2: { label: "non-violent crimes", disclose: ["security-research", "scraping"], severity: "reject" },
  S3: { label: "sex-related crimes", disclose: [], severity: "reject" },
  S4: { label: "child sexual exploitation", disclose: [], severity: "reject" },
  S5: { label: "defamation", disclose: [], severity: "flag" },
  S6: { label: "specialized advice", disclose: ["medical", "legal", "financial"], severity: "flag" },
  S7: { label: "privacy", disclose: ["scraping"], severity: "flag" },
  S8: { label: "intellectual property", disclose: [], severity: "ignore" },
  S9: { label: "indiscriminate weapons", disclose: [], severity: "reject" },
  S10: { label: "hate", disclose: [], severity: "reject" },
  S11: { label: "suicide & self-harm", disclose: [], severity: "reject" },
  S12: { label: "sexual content", disclose: [], severity: "reject" },
  S13: { label: "elections", disclose: [], severity: "ignore" },
  S14: { label: "code interpreter abuse", disclose: ["security-research"], severity: "reject" },
};

export interface GuardResult { ran: boolean; safe: boolean; categories: string[]; raw?: string; neurons: number; error?: string; provider?: "workers-ai" | "openrouter"; tokens?: number }

export const OPENROUTER_GUARD_DEFAULT = "meta-llama/llama-guard-4-12b";
export const OPENROUTER_VISION_DEFAULT = "meta-llama/llama-3.2-11b-vision-instruct";

async function openrouter(env: Env, model: string, messages: unknown[], maxTokens = 60): Promise<{ text: string; tokens: number } | { error: string }> {
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${env.OPENROUTER_API_KEY}`, "content-type": "application/json", "http-referer": env.SITE_URL ?? "https://slopscore.org", "x-title": "SlopScore" },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0 }),
    });
    if (!res.ok) return { error: `openrouter ${res.status}: ${(await res.text()).slice(0, 200)}` };
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number } };
    return { text: j.choices?.[0]?.message?.content?.trim() ?? "", tokens: j.usage?.total_tokens ?? 0 };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/** Llama Guard through OpenRouter (paid scans). Same output contract as the Workers AI path; costs dollars, not neurons. */
export async function llamaGuardOpenRouter(env: Env, text: string): Promise<GuardResult> {
  if (!env.OPENROUTER_API_KEY) return { ran: false, safe: true, categories: [], neurons: 0, error: "no OPENROUTER_API_KEY", provider: "openrouter" };
  const input = text.slice(0, GUARD_TEXT_CAP);
  const r = await openrouter(env, env.OPENROUTER_GUARD_MODEL || OPENROUTER_GUARD_DEFAULT, [{ role: "user", content: input }], 30);
  if ("error" in r) return { ran: false, safe: true, categories: [], neurons: 0, error: r.error, provider: "openrouter" };
  const safe = /^safe/i.test(r.text);
  const categories = safe ? [] : (r.text.match(/S\d{1,2}/g) ?? []);
  return { ran: true, safe, categories: [...new Set(categories)], raw: r.text, neurons: 0, provider: "openrouter", tokens: r.tokens };
}

export async function llamaGuard(env: Env, text: string): Promise<GuardResult> {
  if (!env.AI) return { ran: false, safe: true, categories: [], neurons: 0, error: "no AI binding" };
  const input = text.slice(0, GUARD_TEXT_CAP);
  const neurons = estimateGuardNeurons(input);
  try {
    const out = (await env.AI.run("@cf/meta/llama-guard-3-8b" as never, {
      messages: [{ role: "user", content: input }],
    } as never)) as { response?: string } | string;
    const raw = (typeof out === "string" ? out : out?.response ?? "").trim();
    const safe = /^safe/i.test(raw);
    const categories = safe ? [] : (raw.match(/S\d{1,2}/g) ?? []);
    return { ran: true, safe, categories: [...new Set(categories)], raw, neurons, provider: "workers-ai" };
  } catch (e) {
    return { ran: false, safe: true, categories: [], neurons: 0, error: (e as Error).message, provider: "workers-ai" };
  }
}

/** Decide what a Llama Guard result means for a repo with the given `contains` disclosures. */
export function judgeGuard(g: GuardResult, contains: string[]): { reject: string[]; flags: string[] } {
  const reject: string[] = []; const flags: string[] = [];
  for (const cat of g.categories) {
    const m = GUARD_MAP[cat];
    if (!m || m.severity === "ignore") continue;
    const disclosed = m.disclose.some((d) => contains.includes(d) && (CONTAINS_LISTED as readonly string[]).includes(d));
    if (disclosed) { flags.push(`${m.label} (disclosed as ${m.disclose.filter((d) => contains.includes(d)).join("/")})`); continue; }
    if (m.severity === "reject") reject.push(`${m.label} flagged and not disclosed${m.disclose.length ? ` (disclose: ${m.disclose.join(" | ")})` : ""}`);
    else flags.push(`${m.label} flagged, not disclosed`);
  }
  return { reject, flags };
}

// ---- Vision check on the thumbnail ----
export interface VisionResult { ran: boolean; safe: boolean; note?: string; neurons: number; provider?: "workers-ai" | "openrouter" }

export async function visionCheckOpenRouter(env: Env, bytes: Uint8Array, mime = "image/png"): Promise<VisionResult> {
  if (!env.OPENROUTER_API_KEY) return { ran: false, safe: true, neurons: 0, note: "no OPENROUTER_API_KEY", provider: "openrouter" };
  let b64 = "";
  for (let i = 0; i < bytes.length; i += 0x8000) b64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const dataUrl = `data:${mime};base64,${btoa(b64)}`;
  const r = await openrouter(env, env.OPENROUTER_VISION_MODEL || OPENROUTER_VISION_DEFAULT, [{ role: "user", content: [
    { type: "text", text: "You are a content moderator. Is this image safe to show to a general audience of all ages (no nudity, sexual content, gore, hate symbols, or graphic violence)? Answer with exactly one word, SAFE or UNSAFE, then a short reason." },
    { type: "image_url", image_url: { url: dataUrl } },
  ] }], 40);
  if ("error" in r) return { ran: false, safe: true, neurons: 0, note: r.error, provider: "openrouter" };
  return { ran: true, safe: !/^unsafe/i.test(r.text), note: r.text.slice(0, 160), neurons: 0, provider: "openrouter" };
}
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

/** Workers AI gates this model behind a one-time license acceptance per account: the first call must be the prompt "agree". */
async function acceptVisionLicense(env: Env): Promise<boolean> {
  try {
    await env.AI!.run(VISION_MODEL as never, { prompt: "agree" } as never);
    return true;
  } catch (e) {
    console.log("vision license acceptance failed", (e as Error).message);
    return false;
  }
}

export async function visionCheck(env: Env, bytes: Uint8Array, retried = false): Promise<VisionResult> {
  if (!env.AI) return { ran: false, safe: true, neurons: 0, note: "no AI binding" };
  try {
    const out = (await env.AI.run(VISION_MODEL as never, {
      prompt: "You are a content moderator. Is this image safe to show to a general audience of all ages (no nudity, sexual content, gore, hate symbols, or graphic violence)? Answer with exactly one word, SAFE or UNSAFE, then a short reason.",
      image: [...bytes],
      max_tokens: 40,
    } as never)) as { response?: string } | string;
    const raw = (typeof out === "string" ? out : out?.response ?? "").trim();
    return { ran: true, safe: !/unsafe/i.test(raw.split(/\s/)[0] ?? "") && !/^unsafe/i.test(raw), note: raw.slice(0, 160), neurons: VISION_NEURONS, provider: "workers-ai" };
  } catch (e) {
    const msg = (e as Error).message;
    if (!retried && /submit the prompt 'agree'/i.test(msg) && (await acceptVisionLicense(env))) return visionCheck(env, bytes, true);
    return { ran: false, safe: true, neurons: 0, note: msg, provider: "workers-ai" };
  }
}
