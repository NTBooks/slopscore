import { describe, it, expect } from "vitest";
import { cached, markDirty, dataVersion, resetVersionMemo } from "../src/lib/cache";

/** Just enough of D1 for cache.ts: the crawl_state rows it reads, mints and bumps. */
function fakeDb() {
  const state = new Map<string, string>();
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          const keys = args.map(String);
          return {
            async all() { return { results: keys.filter((k) => state.has(k)).map((k) => ({ key: k, value: state.get(k) })) }; },
            async first() { return state.has(keys[0]) ? { value: state.get(keys[0]) } : null; },
            async run() {
              if (/INSERT OR IGNORE/.test(sql)) { if (!state.has(keys[0])) state.set(keys[0], keys[1]); }
              else state.set(keys[0], String(Number(state.get(keys[0]) ?? "0") + 1));
              return { success: true };
            },
          };
        },
      };
    },
  };
  return db as unknown as D1Database;
}

describe("read-through cache", () => {
  it("serves repeats from cache until the data version bumps", async () => {
    resetVersionMemo();
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

  it("namespaces the version per database so two environments never share an entry", async () => {
    resetVersionMemo();
    const a = await dataVersion(fakeDb());
    resetVersionMemo();
    const b = await dataVersion(fakeDb());
    expect(a).toMatch(/^[0-9a-f-]{12}\/0$/);
    expect(a).not.toBe(b);
  });
});
