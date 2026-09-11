import { describe, it, expect } from "vitest";
import { nextFire, everySeconds, untilText, parseManual, CRON_JOBS } from "../src/lib/crawlclock";

const at = (iso: string) => Date.parse(iso) / 1000;

describe("nextFire", () => {
  it("finds the next */N boundary, strictly after now", () => {
    expect(nextFire("*/15 * * * *", at("2026-09-11T10:07:30Z"))).toBe(at("2026-09-11T10:15:00Z"));
    expect(nextFire("*/15 * * * *", at("2026-09-11T10:15:00Z"))).toBe(at("2026-09-11T10:30:00Z"));
    expect(nextFire("*/30 * * * *", at("2026-09-11T23:45:00Z"))).toBe(at("2026-09-12T00:00:00Z"));
    expect(nextFire("*/5 * * * *", at("2026-09-11T10:04:59Z"))).toBe(at("2026-09-11T10:05:00Z"));
  });
  it("handles a daily cron and rolls to tomorrow", () => {
    expect(nextFire("5 0 * * *", at("2026-09-11T00:04:00Z"))).toBe(at("2026-09-11T00:05:00Z"));
    expect(nextFire("5 0 * * *", at("2026-09-11T00:06:00Z"))).toBe(at("2026-09-12T00:05:00Z"));
  });
  it("refuses what it can't compute", () => {
    expect(nextFire("0 0 1 * *", at("2026-09-11T00:00:00Z"))).toBeNull();
    expect(nextFire("garbage", at("2026-09-11T00:00:00Z"))).toBeNull();
    expect(nextFire("*/0 * * * *", at("2026-09-11T00:00:00Z"))).toBeNull();
  });
});

describe("clock helpers", () => {
  it("knows the interval of */N crons only", () => {
    expect(everySeconds("*/15 * * * *")).toBe(900);
    expect(everySeconds("5 0 * * *")).toBeNull();
  });
  it("formats the countdown", () => {
    expect(untilText(0)).toBe("due now");
    expect(untilText(42)).toBe("in 42s");
    expect(untilText(61)).toBe("in 2 min");
    expect(untilText(3 * 3600)).toBe("in 3 h");
  });
  it("parses the manual-run marker", () => {
    expect(parseManual("1757592000|NTBooks")).toEqual({ at: 1757592000, by: "NTBooks" });
    expect(parseManual("")).toBeNull();
    expect(parseManual("nope")).toBeNull();
  });
  it("maps every crawler cron wired in runCron", () => {
    expect(CRON_JOBS["*/30 * * * *"]).toEqual(["sweep", "scan", "recrawl"]);
    expect(CRON_JOBS["*/15 * * * *"]).toEqual(["sweep"]);
  });
});
