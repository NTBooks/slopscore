// Parser + validator for slopscore.md. The contract: docs/SPEC.md.
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import {
  AI_GENERATED, HUMAN_TOUCH, CONTENT_RATING, STATUS, CATEGORY, CONTAINS_LISTED, CONTAINS_REJECTED,
  DECLARED_FACETS, CONTROLLED, SPEC_VERSION, normalizeValue, isRecognized,
} from "./vocab";

export type TagRow = { facet: string; value: string; source: "declared" | "detected" | "alias"; recognized: boolean };

export interface SlopMeta {
  slopscore: number;
  ai_generated: (typeof AI_GENERATED)[number];
  human_touch: (typeof HUMAN_TOUCH)[number];
  content_rating: (typeof CONTENT_RATING)[number];
  contains: string[];
  category: string[];
  status: (typeof STATUS)[number];
  title?: string;
  tagline?: string;
  demo_url?: string;
  built_with: string[];
  models: string[];
  interface: string[];
  frameworks: string[];
  platforms: string[];
  audience: string[];
  data: string[];
  needs: string[];
  domain: string[];
  tags: string[];
  images: string[];
  maintainers: string[];
  unlisted: boolean;
  x: Record<string, unknown>;
}

export interface ParseResult {
  ok: boolean;
  /** Field-level reasons the file was rejected. Empty when ok. */
  errors: string[];
  /** Non-fatal notes (unrecognized values, ignored keys). */
  warnings: string[];
  meta?: SlopMeta;
  body: string;
  tags: TagRow[];
  raw?: Record<string, unknown>;
}

const MAX_BODY = 4000;

// ---- frontmatter split ----
export function splitFrontmatter(text: string): { yaml: string | null; body: string } {
  const t = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const m = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)([\s\S]*)$/.exec(t);
  if (!m) return { yaml: null, body: t.trim() };
  return { yaml: m[1], body: m[2].trim() };
}

// ---- zod schema (disclosure fields strict, optional fields lenient) ----
const listOfStrings = z
  .union([z.string(), z.array(z.union([z.string(), z.number()]))])
  .transform((v) => (Array.isArray(v) ? v : String(v).split(/[,\s]+/)))
  .transform((arr) => arr.map((x) => normalizeValue(x)).filter(Boolean))
  .optional()
  .default([]);

const enumNorm = <T extends readonly [string, ...string[]]>(vals: T, label: string) =>
  z.preprocess((v) => normalizeValue(v), z.enum(vals, {
    errorMap: () => ({ message: `${label} must be one of: ${vals.join(", ")}` }),
  }));

const CATEGORY_ENUM = CATEGORY as unknown as readonly [string, ...string[]];
const CONTAINS_ALL = [...CONTAINS_LISTED, ...CONTAINS_REJECTED];

export const slopSchema = z.object({
  slopscore: z.preprocess((v) => Number(v), z.literal(SPEC_VERSION, {
    errorMap: () => ({ message: `slopscore must be ${SPEC_VERSION} (spec version)` }),
  })),
  ai_generated: enumNorm(AI_GENERATED as unknown as readonly [string, ...string[]], "ai_generated"),
  human_touch: enumNorm(HUMAN_TOUCH as unknown as readonly [string, ...string[]], "human_touch"),
  content_rating: enumNorm(CONTENT_RATING as unknown as readonly [string, ...string[]], "content_rating"),
  contains: z
    .union([z.null(), z.string(), z.array(z.string())], { errorMap: () => ({ message: "contains must be a list (may be empty)" }) })
    .transform((v) => (v == null ? [] : Array.isArray(v) ? v : v.split(/[,\s]+/)))
    .transform((arr) => arr.map(normalizeValue).filter(Boolean))
    .refine((arr) => arr.every((x) => CONTAINS_ALL.includes(x as never)), {
      message: `contains has an unknown value; allowed: ${CONTAINS_ALL.join(", ")}`,
    }),
  category: z
    .union([z.string(), z.array(z.string())], { errorMap: () => ({ message: "category is required (list of at least one)" }) })
    .transform((v) => (Array.isArray(v) ? v : v.split(/[,\s]+/)))
    .transform((arr) => arr.map(normalizeValue).filter(Boolean))
    .refine((arr) => arr.length >= 1, { message: "category needs at least one value" })
    .refine((arr) => arr.every((x) => CATEGORY_ENUM.includes(x)), {
      message: `category has an unknown value; allowed: ${CATEGORY.join(", ")}`,
    }),
  status: enumNorm(STATUS as unknown as readonly [string, ...string[]], "status"),
  title: z.string().trim().max(80).optional(),
  tagline: z.string().trim().max(140, "tagline must be ≤ 140 chars").optional(),
  demo_url: z.string().trim().url("demo_url must be a full URL").optional(),
  built_with: listOfStrings,
  models: listOfStrings,
  interface: listOfStrings,
  frameworks: listOfStrings,
  platforms: listOfStrings,
  audience: listOfStrings,
  data: listOfStrings,
  needs: listOfStrings,
  domain: listOfStrings,
  tags: listOfStrings.pipe(z.array(z.string()).max(20, "tags: at most 20")),
  images: z.array(z.string()).max(6).optional().default([]),
  maintainers: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v]))
    .transform((arr) => arr.map((x) => String(x).trim().replace(/^@/, "").toLowerCase()).filter(Boolean))
    .optional()
    .default([]),
  unlisted: z.coerce.boolean().optional().default(false),
});

const KNOWN_KEYS = new Set(Object.keys(slopSchema.shape));

export function parseSlopMd(text: string): ParseResult {
  const { yaml, body } = splitFrontmatter(text);
  const warnings: string[] = [];
  if (yaml == null) {
    return { ok: false, errors: ["no YAML frontmatter found (file must start with --- ... ---)"], warnings, body, tags: [] };
  }
  let raw: unknown;
  try {
    // People write `maintainers: [@alice]`; a bare @ is a reserved YAML indicator, so drop it in front of handles.
    const tolerant = yaml.replace(/(^|[\[,]\s*|:\s+)@(?=[A-Za-z0-9_-])/gm, "$1");
    raw = parseYaml(tolerant, { strict: false });
  } catch (e) {
    return { ok: false, errors: [`frontmatter is not valid YAML: ${(e as Error).message.split("\n")[0]}`], warnings, body, tags: [] };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["frontmatter must be a YAML mapping"], warnings, body, tags: [] };
  }
  const obj = raw as Record<string, unknown>;

  // Normalise keys: lowercase, hyphen→underscore (except x- keys), collect x- keys verbatim
  const x: Record<string, unknown> = {};
  const norm: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = k.trim().toLowerCase();
    if (key.startsWith("x-") || key.startsWith("x_")) { x[k] = v; continue; }
    const canon = key.replace(/-/g, "_");
    if (!KNOWN_KEYS.has(canon)) { warnings.push(`ignored unknown key "${k}"`); continue; }
    norm[canon] = v;
  }

  const res = slopSchema.safeParse(norm);
  if (!res.success) {
    const errors = res.error.issues.map((i) => {
      const path = i.path.join(".") || "frontmatter";
      const msg = i.message === "Required" ? `${path} is required` : i.message.includes(path) ? i.message : `${path}: ${i.message}`;
      return msg;
    });
    return { ok: false, errors: [...new Set(errors)], warnings, body, tags: [] };
  }
  const d = res.data;
  const errors: string[] = [];
  if (d.content_rating !== "everyone") errors.push(`content_rating "${d.content_rating}" is not listed; only "everyone" is`);
  const rejectedHits = d.contains.filter((c) => (CONTAINS_REJECTED as readonly string[]).includes(c));
  if (rejectedHits.length) errors.push(`contains ${rejectedHits.join(", ")}: not listed on SlopScore`);
  if (body.length > MAX_BODY) warnings.push(`body truncated to ${MAX_BODY} chars`);

  const meta: SlopMeta = { ...d, x } as SlopMeta;
  const tags = tagsFromMeta(meta, warnings);
  return { ok: errors.length === 0, errors, warnings, meta, body: body.slice(0, MAX_BODY), tags, raw: obj };
}

export function tagsFromMeta(meta: SlopMeta, warnings: string[] = []): TagRow[] {
  const rows: TagRow[] = [];
  const seen = new Set<string>();
  const push = (facet: string, value: string) => {
    const v = normalizeValue(value);
    if (!v) return;
    const key = `${facet}:${v}`;
    if (seen.has(key)) return;
    seen.add(key);
    const recognized = isRecognized(facet, v);
    if (!recognized && CONTROLLED[facet]) warnings.push(`unrecognized ${facet} value "${v}" kept as a free tag`);
    rows.push({ facet, value: v, source: "declared", recognized });
  };
  for (const facet of DECLARED_FACETS) {
    const val = (meta as unknown as Record<string, unknown>)[facet];
    if (Array.isArray(val)) val.forEach((v) => push(facet, String(v)));
    else if (typeof val === "string") push(facet, val);
  }
  return rows;
}

/** Minimal valid file, used in the instructions and tests. */
export const MINIMAL_EXAMPLE = `---
slopscore: 1
ai_generated: entirely
human_touch: light
content_rating: everyone
contains: []
category: [cli]
status: works-on-my-machine
---
`;
