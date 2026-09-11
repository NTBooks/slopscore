import { describe, it, expect } from "vitest";
import { cached, markDirty, dataVersion } from "../src/lib/cache";

/** Just enough of D1 for cache.ts: one crawl_state row, read by first() and bumped by run(). */
function fakeDb() {
  const state = new Map<string, string>();
  const db = {
    prepare(_sql: string) {
      return {
        bind(...args: unknown[]) {
          const key = String(args[0]);
          return {
            async first() { return state.has(key) ? { value: state.get(key) } : null; },
            async run() { state.set(key, String(Number(state.get(key) ?? "0") + 1)); return { success: true }; },
          };
        },
      };
    },
  };
  return db as unknown as D1Database;
}

describe("read-through cache", () => {
  it("serves repeats from cache until the data version bumps", async () => {
    const db = fakeDb();
    const key = `test:${Date.now()}:${Math.random()}`;
    let calls = 0;
    const fn = async () => ({ n: ++calls });

    expect(await cached(db, key, fn)).toEqual({ n: 1 });
    expect(await cached(db, key, fn)).toEqual({ n: 1 }); // cache hit: fn not called again
    expect(calls).toBe(1);

    const before = await dataVersion(db);
    await markDirty(db);
    expect(await dataVersion(db)).not.toBe(before);

    expect(await cached(db, key, fn)).toEqual({ n: 2 }); // new version, new key, fresh query
    expect(calls).toBe(2);
  });

  it("keys are independent", async () => {
    const db = fakeDb();
    const stamp = Date.now();
    expect(await cached(db, `a:${stamp}`, async () => "a")).toBe("a");
    expect(await cached(db, `b:${stamp}`, async () => "b")).toBe("b");
  });
});
