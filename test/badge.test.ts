import { describe, it, expect } from "vitest";
import { badgeValue } from "../src/lib/badge";

describe("the badge never reads as a bad review", () => {
  const listed = (score: number) => ({ status: "listed", score });
  it("drops the number when nobody has voted yet, or the votes went the wrong way", () => {
    expect(badgeValue(listed(0), null)).toBe("certified slop");
    expect(badgeValue(listed(-2), null)).toBe("certified slop");
  });
  it("keeps the number once there is something to brag about", () => {
    expect(badgeValue(listed(3), null)).toBe("certified slop · 3");
  });
  it("leads with the award, in words a stranger can read", () => {
    expect(badgeValue(listed(0), { kind: "day", period: "2026-09-28", rank: 1 })).toBe("#1 slop of the day · 2026-09-28");
    expect(badgeValue(listed(5), { kind: "upcoming-week", period: "2026-W37", rank: 2 })).toBe("#2 most promising · 2026-W37");
  });
  it("says plainly when there is no listing", () => {
    expect(badgeValue(null, null)).toBe("not listed");
    expect(badgeValue({ status: "quarantined", score: 0 }, null)).toBe("quarantined");
  });
});
