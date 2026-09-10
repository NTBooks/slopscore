import { describe, it, expect } from "vitest";
import { parseSlopMd, MINIMAL_EXAMPLE } from "../src/lib/slopmd";

const good = (extra = "") => `---
slopscore: 1
ai_generated: entirely
human_touch: light
content_rating: everyone
contains: []
category: [cli, devtools]
status: works-on-my-machine
${extra}---
The pitch.`;

describe("parseSlopMd", () => {
  it("accepts the minimal example", () => {
    const r = parseSlopMd(MINIMAL_EXAMPLE);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.meta?.category).toEqual(["cli"]);
  });

  it("parses body and tags", () => {
    const r = parseSlopMd(good("built_with: [cc, Cursor]\ntags: [toast, Toast, home-automation]\n"));
    expect(r.ok).toBe(true);
    expect(r.body).toBe("The pitch.");
    expect(r.meta?.built_with).toEqual(["claude-code", "cursor"]);
    expect(r.tags.find((t) => t.facet === "built_with" && t.value === "claude-code")).toBeTruthy();
    expect(r.tags.filter((t) => t.facet === "tags").map((t) => t.value)).toEqual(["toast", "home-automation"]);
  });

  it("rejects when frontmatter is missing", () => {
    const r = parseSlopMd("# just a readme");
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/frontmatter/);
  });

  it("rejects missing disclosure fields with field-level reasons", () => {
    const r = parseSlopMd("---\nslopscore: 1\nai_generated: entirely\n---\n");
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/human_touch/);
    expect(r.errors.join(" ")).toMatch(/category/);
    expect(r.errors.join(" ")).toMatch(/status/);
  });

  it("rejects bad enum values and wrong spec version", () => {
    expect(parseSlopMd(good().replace("human_touch: light", "human_touch: a-bit")).errors.join(" ")).toMatch(/human_touch must be one of/);
    expect(parseSlopMd(good().replace("slopscore: 1", "slopscore: 2")).errors.join(" ")).toMatch(/spec version/);
  });

  it("rejects mature content ratings and rejected-set contains values", () => {
    expect(parseSlopMd(good().replace("everyone", "adult")).errors.join(" ")).toMatch(/content_rating/);
    const r = parseSlopMd(good().replace("contains: []", "contains: [nudity, crypto]"));
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/nudity/);
  });

  it("lists disclosed-and-listed contains values", () => {
    const r = parseSlopMd(good().replace("contains: []", "contains: [crypto, scraping]"));
    expect(r.ok).toBe(true);
    expect(r.meta?.contains).toEqual(["crypto", "scraping"]);
  });

  it("rejects unknown category values but keeps unknown optional facet values as unrecognized tags", () => {
    expect(parseSlopMd(good().replace("[cli, devtools]", "[cli, spaceship]")).ok).toBe(false);
    const r = parseSlopMd(good("built_with: [my-own-llm]\nplatforms: [amiga]\n"));
    expect(r.ok).toBe(true);
    const t = r.tags.find((x) => x.facet === "platforms" && x.value === "amiga");
    expect(t?.recognized).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/unrecognized platforms/);
  });

  it("normalizes aliases and case", () => {
    const r = parseSlopMd(good("frameworks: [Next.js, k8s]\nplatforms: [Mac, Win]\n"));
    expect(r.meta?.frameworks).toEqual(["nextjs", "kubernetes"]);
    expect(r.meta?.platforms).toEqual(["macos", "windows"]);
  });

  it("round-trips x- keys, ignores unknown keys with a warning", () => {
    const r = parseSlopMd(good("x-team: red\nfavourite_colour: blue\n"));
    expect(r.ok).toBe(true);
    expect(r.meta?.x["x-team"]).toBe("red");
    expect(r.warnings.join(" ")).toMatch(/favourite_colour/);
  });

  it("caps tags at 20 and tagline at 140", () => {
    const many = Array.from({ length: 21 }, (_, i) => `t${i}`).join(", ");
    expect(parseSlopMd(good(`tags: [${many}]\n`)).errors.join(" ")).toMatch(/at most 20/);
    expect(parseSlopMd(good(`tagline: ${"x".repeat(141)}\n`)).errors.join(" ")).toMatch(/140/);
  });

  it("parses maintainers and unlisted", () => {
    const r = parseSlopMd(good("maintainers: [@Alice, bob]\nunlisted: true\n"));
    expect(r.meta?.maintainers).toEqual(["alice", "bob"]);
    expect(r.meta?.unlisted).toBe(true);
  });

  it("handles CRLF and a BOM", () => {
    const r = parseSlopMd("﻿" + MINIMAL_EXAMPLE.replace(/\n/g, "\r\n"));
    expect(r.ok).toBe(true);
  });
});

describe("slopbucket", () => {
  it("parses up to three buckets, normalized, with aliases for the key", () => {
    const r = parseSlopMd(`---
slopscore: 1
ai_generated: entirely
human_touch: light
content_rating: everyone
contains: []
category: [mcp-server]
status: alpha
buckets: [CLI, "Weekend Project", vibe-coded]
---
`);
    expect(r.ok).toBe(true);
    expect(r.meta?.slopbucket).toEqual(["cli", "weekend-project", "vibe-coded"]);
    expect(r.meta?.category).toEqual(["mcp-server"]);
    expect(r.tags.filter((t) => t.facet === "slopbucket").length).toBe(3);
  });
});
