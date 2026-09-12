import { describe, it, expect } from "vitest";
import { nextFire, everySeconds, untilText, parseManual, parseFail, intervalOf, healthOf, CRON_JOBS, DAILY_JOBS } from "../src/lib/crawlclock";

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
  it("gives the daily round its own schedule", () => {
    expect(CRON_JOBS["5 0 * * *"]).toEqual([...DAILY_JOBS]);
  });
  it("parses the failure marker, message and all", () => {
    expect(parseFail("1757592000|openrouter 429: slow down")).toEqual({ at: 1757592000, why: "openrouter 429: slow down" });
    expect(parseFail("1757592000|")).toEqual({ at: 1757592000, why: "" });
    expect(parseFail("")).toBeNull();
    expect(parseFail("nope|whatever")).toBeNull();
  });
});

describe("intervalOf", () => {
  it("reads */N the same as everySeconds", () => {
    expect(intervalOf("*/15 * * * *")).toBe(900);
    expect(intervalOf("*/5 * * * *")).toBe(300);
  });
  it("calls a fixed daily time a day, which everySeconds will not", () => {
    expect(everySeconds("5 0 * * *")).toBeNull();
    expect(intervalOf("5 0 * * *")).toBe(86400);
  });
  it("refuses anything it cannot reduce to one number", () => {
    expect(intervalOf("0 0 1 * *")).toBeNull();
    expect(intervalOf("garbage")).toBeNull();
  });
});

describe("healthOf", () => {
  const day = 86400;
  const t = 1_800_000_000;
  const daily = "5 0 * * *";

  it("distinguishes a job that never ran from one that ran before the heartbeat existed", () => {
    expect(healthOf({ cron: daily, last_ok: null, last_fail: null, last_run: t - 3600 }, t)).toBe("unreported");
  });

  it("is unknown until a tick records the schedule", () => {
    expect(healthOf({ cron: null, last_ok: t, last_fail: null, last_run: null }, t)).toBe("unknown");
  });

  // The bug this whole file exists to prevent: /trends shipped after the day's tick and read as broken.
  it("calls a job that has never had its turn 'never', not a failure", () => {
    expect(healthOf({ cron: daily, last_ok: null, last_fail: null, last_run: null }, t)).toBe("never");
  });

  it("is ok inside one interval plus grace", () => {
    expect(healthOf({ cron: daily, last_ok: t - 3600, last_fail: null, last_run: null }, t)).toBe("ok");
    expect(healthOf({ cron: "*/15 * * * *", last_ok: t - 60, last_fail: null, last_run: null }, t)).toBe("ok");
  });

  it("goes late once a whole interval has passed with no success", () => {
    expect(healthOf({ cron: daily, last_ok: t - day - 600, last_fail: null, last_run: null }, t)).toBe("late");
    expect(healthOf({ cron: "*/15 * * * *", last_ok: t - 1500, last_fail: null, last_run: null }, t)).toBe("late");
  });

  it("does not call a job late for being a few minutes behind itself", () => {
    expect(healthOf({ cron: "*/15 * * * *", last_ok: t - 1000, last_fail: null, last_run: null }, t)).toBe("ok");
  });

  it("is failing when the newest thing that happened was a failure", () => {
    expect(healthOf({ cron: daily, last_ok: t - 2 * day, last_fail: { at: t - 60, why: "boom" }, last_run: null }, t)).toBe("failing");
    expect(healthOf({ cron: daily, last_ok: null, last_fail: { at: t - 60, why: "boom" }, last_run: null }, t)).toBe("failing");
  });

  it("clears once a later run succeeds", () => {
    expect(healthOf({ cron: daily, last_ok: t - 60, last_fail: { at: t - 3600, why: "boom" }, last_run: null }, t)).toBe("ok");
  });
});
