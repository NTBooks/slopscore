import { describe, it, expect } from "vitest";
import { parseQuery, filterSql } from "../src/lib/searchquery";

describe("parseQuery", () => {
  it("splits operators from free text", () => {
    const p = parseQuery('category:cli lang:python -tool:cursor "toast" owner:Foo bar');
    expect(p.filters).toEqual([
      { facet: "category", column: undefined, value: "cli", negate: false },
      { facet: "language", column: undefined, value: "python", negate: false },
      { facet: "built_with", column: undefined, value: "cursor", negate: true },
      { facet: undefined, column: "owner", value: "foo", negate: false },
    ]);
    expect(p.match).toBe('"toast" "bar"');
  });

  it("normalizes aliases in operator values", () => {
    const p = parseQuery("tool:cc platform:mac");
    expect(p.filters.map((f) => f.value)).toEqual(["claude-code", "macos"]);
  });

  it("treats unknown operators as text", () => {
    const p = parseQuery("foo:bar hello");
    expect(p.filters).toEqual([]);
    expect(p.match).toBe('"foo bar" "hello"'); // ':' is FTS5 column syntax, so it is stripped
  });

  it("returns null match with only filters", () => {
    expect(parseQuery("status:alpha").match).toBeNull();
  });

  it("strips FTS syntax characters from free text", () => {
    expect(parseQuery('a* OR (b) "c"').match).toBe('"a" "OR" "b" "c"');
  });

  it("builds EXISTS / NOT EXISTS SQL", () => {
    const { where, params } = filterSql(parseQuery("category:cli -tool:cursor owner:me").filters);
    expect(where[0]).toMatch(/^EXISTS/);
    expect(where[1]).toMatch(/^NOT EXISTS/);
    expect(where[2]).toMatch(/lower\(r\.owner\)/);
    expect(params).toEqual(["category", "cli", "built_with", "cursor", "me"]);
  });
});
