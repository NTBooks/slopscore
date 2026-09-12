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

// The flags this feature hides behind. They ship off; turning one on is a deploy of the var, on purpose.
describe("the rail's atmosphere ships dark", () => {
  const NEW: Flag[] = ["frenzy", "chatter", "chart"];

  it("names all three in the flag list, so /mod can show them", () => {
    for (const f of NEW) expect(ALL_FLAGS).toContain(f);
  });
  it("has every deployed environment shipping them off", () => {
    expect(SHIPPED.length).toBe(3);   // local dev, test, production
    for (const spec of SHIPPED) {
      const on = parseFlags(spec);
      for (const f of NEW) expect(on.has(f)).toBe(false);
    }
  });
  it("leaves every flag that was already on still on", () => {
    const untouched = ALL_FLAGS.filter((f) => !NEW.includes(f) && !["rising", "controversial", "updated", "upcoming"].includes(f));
    for (const spec of SHIPPED) {
      const on = parseFlags(spec);
      for (const f of untouched) expect(on.has(f)).toBe(true);
    }
  });
});
