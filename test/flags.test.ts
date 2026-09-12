import { describe, it, expect } from "vitest";
import { ALL_FLAGS, parseFlags, type Flag } from "../src/lib/flags";
import wranglerJsonc from "../wrangler.jsonc?raw";

/** Every MOD_FLAGS string the deployed config actually ships, read out of wrangler.jsonc itself.
 *  Reading the real file is the point: a test against a copied-out constant cannot catch the config
 *  drifting from the code, which is the only way this feature ships live by accident. */
const SHIPPED: string[] = [...wranglerJsonc.matchAll(/"MOD_FLAGS":\s*"([^"]*)"/g)].map((m) => m[1]);

describe("parseFlags reads the list the way the header comment promises", () => {
  it("turns everything on when the var is missing or blank", () => {
    for (const spec of [undefined, "", "   "]) expect(parseFlags(spec).size).toBe(ALL_FLAGS.length);
  });
  it("starts from all when it is given nothing but negations", () => {
    const on = parseFlags("-fuzz");
    expect(on.has("fuzz")).toBe(false);
    expect(on.has("weight")).toBe(true);
  });
  it("starts from nothing when it is given a name", () => {
    const on = parseFlags("fuzz");
    expect([...on]).toEqual(["fuzz"]);
  });
  it("ignores a name that is not a flag, rather than inventing one", () => {
    expect(parseFlags("all,-nosuchflag").size).toBe(ALL_FLAGS.length);
  });
});

// The rail's atmosphere was shipped dark and then turned on deliberately. What is worth pinning now is
// not that it is on -- that is one edit away and should be -- but that the three environments say the
// same thing. Production and test drifting apart is how a box gets debugged on a site where it was never
// enabled, and nothing else in the build would notice.
describe("every environment ships the same flags", () => {
  const RAIL: Flag[] = ["frenzy", "chatter", "chart"];

  it("names all three in the flag list, so /mod can show them", () => {
    for (const f of RAIL) expect(ALL_FLAGS).toContain(f);
  });
  it("has local dev, test and production agreeing on every flag", () => {
    expect(SHIPPED.length).toBe(3);
    const [first, ...rest] = SHIPPED.map((spec) => [...parseFlags(spec)].sort().join(","));
    for (const other of rest) expect(other).toBe(first);
  });
  it("mentions no flag that does not exist", () => {
    // A typo in a negation is silent: parseFlags ignores the name and the flag stays on.
    const named = SHIPPED.flatMap((spec) => spec.split(/[,\s]+/))
      .map((p) => p.replace(/^-/, "").trim().toLowerCase())
      .filter((p) => p && p !== "all" && p !== "none");
    for (const n of named) expect(ALL_FLAGS).toContain(n as Flag);
  });
  it("has the rail's two boxes and the cadence on together", () => {
    // chatter without frenzy is a chat fed by one batch a night, which is the thing this replaced.
    for (const spec of SHIPPED) {
      const on = parseFlags(spec);
      if (on.has("chatter")) expect(on.has("frenzy")).toBe(true);
    }
  });
});
