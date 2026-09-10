import { describe, it, expect } from "vitest";
import { hot, controversy, confidence } from "../src/lib/rank";

describe("rank", () => {
  it("hot: newer beats older at equal score, more votes beats fewer at equal age", () => {
    const t = 1_750_000_000;
    expect(hot(10, 0, t + 3600)).toBeGreaterThan(hot(10, 0, t));
    expect(hot(100, 0, t)).toBeGreaterThan(hot(10, 0, t));
    expect(hot(0, 10, t)).toBeLessThan(hot(0, 0, t));
  });
  it("controversy is 0 unless both sides voted, and rises with balance", () => {
    expect(controversy(10, 0)).toBe(0);
    expect(controversy(10, 10)).toBeGreaterThan(controversy(10, 2));
  });
  it("confidence orders comments sensibly", () => {
    expect(confidence(10, 0)).toBeGreaterThan(confidence(1, 0));
    expect(confidence(0, 0)).toBe(0);
  });
});
