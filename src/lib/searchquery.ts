// Reddit-style search query parser: `category:cli lang:python -tool:cursor "toast" owner:foo`
import { SEARCH_OPERATORS, normalizeValue } from "./vocab";

export interface Filter { facet?: string; column?: string; value: string; negate: boolean }
export interface ParsedQuery {
  /** FTS5 MATCH expression, or null when there are no free-text terms. */
  match: string | null;
  filters: Filter[];
  /** Human-readable echo of what was parsed, for the search page. */
  terms: string[];
}

const TOKEN = /"([^"]*)"|(\S+)/g;

export function parseQuery(q: string): ParsedQuery {
  const filters: Filter[] = [];
  const terms: string[] = [];
  const text: string[] = [];
  for (const m of (q ?? "").matchAll(TOKEN)) {
    const quoted = m[1];
    const bare = m[2];
    if (quoted !== undefined) {
      if (quoted.trim()) { text.push(`"${ftsEscape(quoted)}"`); terms.push(`"${quoted}"`); }
      continue;
    }
    let tok = bare;
    let negate = false;
    if (tok.startsWith("-") && tok.length > 1) { negate = true; tok = tok.slice(1); }
    const colon = tok.indexOf(":");
    if (colon > 0) {
      const op = tok.slice(0, colon).toLowerCase();
      const val = tok.slice(colon + 1);
      const spec = SEARCH_OPERATORS[op];
      if (spec && val) {
        const value = spec.column === "owner" ? val.toLowerCase() : normalizeValue(val);
        filters.push({ facet: spec.facet, column: spec.column, value, negate });
        terms.push(`${negate ? "-" : ""}${op}:${value}`);
        continue;
      }
    }
    // unknown operator or plain word: full-text (negation on free text is dropped for simplicity)
    const clean = ftsEscape(tok);
    if (clean) { text.push(`"${clean}"`); terms.push(tok); }
  }
  return { match: text.length ? text.join(" ") : null, filters, terms };
}

function ftsEscape(s: string): string {
  return s.replace(/"/g, "").replace(/[^\p{L}\p{N}\s._+#-]/gu, " ").trim();
}

/** Builds SQL fragments for the filters. Returns WHERE clauses and bound params. */
export function filterSql(filters: Filter[], alias = "r"): { where: string[]; params: unknown[] } {
  const where: string[] = [];
  const params: unknown[] = [];
  for (const f of filters) {
    if (f.column === "owner") {
      where.push(`${f.negate ? "NOT " : ""}(lower(${alias}.owner) = ?)`);
      params.push(f.value);
    } else if (f.column === "tier") {
      where.push(`${f.negate ? "NOT " : ""}(${alias}.tier = ?)`);
      params.push(f.value);
    } else if (f.facet) {
      where.push(
        `${f.negate ? "NOT " : ""}EXISTS (SELECT 1 FROM repo_tags rt WHERE rt.repo_id = ${alias}.id AND rt.facet = ? AND rt.value = ?)`,
      );
      params.push(f.facet, f.value);
    }
  }
  return { where, params };
}
