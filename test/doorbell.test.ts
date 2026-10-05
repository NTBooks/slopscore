import { describe, it, expect } from "vitest";
import { collect, subjectFor, bodyFor, type Ring } from "../src/jobs/doorbell";
import { CRON_JOBS } from "../src/lib/crawlclock";

const optIn = (full_name: string, over: Partial<{ status: string; tier: string; tagline: string | null; reject_reason: string | null; queue_reason: string | null; first_seen: number }> = {}) => ({
  full_name, owner: full_name.split("/")[0], status: "listed", tier: "found", tagline: null, reject_reason: null, queue_reason: null, first_seen: 100, ...over,
});
const log = (id: number, actor_login: string, action: string, target_label: string, created_at = 200) => ({ id, actor_login, action, target_label, note: null, created_at });
const admins = new Set(["ntbooks"]);

describe("the doorbell rings for strangers, not for the house", () => {
  it("rings for an opt-in, an owner's launch and an owner's removal, oldest first", () => {
    const rings = collect(
      [optIn("Janus5G/ChromaPress", { first_seen: 50 })],
      [log(2, "Janus5G", "remove", "Janus5G/ChromaPress", 300), log(1, "Janus5G", "submit", "Janus5G/ChromaPress", 100)],
      admins,
    );
    expect(rings.map((r) => r.kind)).toEqual(["opt-in", "submit", "remove"]);
  });

  it("stays quiet about the admins' own repos and buttons, whatever the case of the login", () => {
    const rings = collect(
      [optIn("NTBooks/Sloppycat")],
      [log(1, "NTBooks", "submit", "NTBooks/Sloppycat"), log(2, "system", "adopted", "ntbooks/thing"), log(3, "system", "takedown", "stranger/thing")],
      admins,
    );
    expect(rings.map((r) => `${r.kind} ${r.repo}`)).toEqual(["takedown stranger/thing"]);
  });

  it("says why an opt-in was turned away, since that owner is the one stuck", () => {
    const [r] = collect([optIn("a/b", { status: "rejected", reject_reason: "ai_generated is missing" })], [], admins);
    expect(r.note).toContain("rejected");
    expect(r.note).toContain("ai_generated is missing");
  });
});

describe("the mail", () => {
  const ring = (kind: Ring["kind"], repo: string): Ring => ({ kind, repo, who: repo.split("/")[0], at: 1790720564, note: null });

  it("names the repo when there is one ring, and counts by kind when there are several", () => {
    expect(subjectFor([ring("submit", "a/b")])).toBe("[SlopScore] submit: a/b");
    expect(subjectFor([ring("opt-in", "a/b"), ring("opt-in", "c/d"), ring("remove", "e/f")])).toBe("[SlopScore] 3 at the door: 2 opt-in, 1 removed");
  });

  it("links every ring to its page and caps the list, leaving the rest to /log", () => {
    const many = Array.from({ length: 45 }, (_, i) => ring("opt-in", `o/r${i}`));
    const body = bodyFor(many, "https://slopscore.org");
    expect(body).toContain("https://slopscore.org/r/o/r0");
    expect(body).not.toContain("https://slopscore.org/r/o/r44");
    expect(body).toContain("...and 5 more on https://slopscore.org/log");
  });

  it("runs on the five-minute tick, after the scan, so an opt-in rings with its verdict", () => {
    expect(CRON_JOBS["*/5 * * * *"]).toEqual(["scan", "doorbell"]);
  });
});
