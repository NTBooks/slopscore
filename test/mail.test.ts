import { describe, it, expect } from "vitest";
import { encodeHeader } from "../src/lib/mail";
import { dispatchMail, reportMd, shapeReport } from "../src/jobs/report";
import type { TrendRow } from "../src/jobs/trends";

/** What a receiver that enforces RFC 2047 will reject: any byte outside printable ASCII in a header value. */
const isHeaderSafe = (s: string) => /^[\x20-\x7E\r\n]*$/.test(s);

/** Decode the encoded-words back, so a test proves the subject still says what it said. */
function decode(header: string): string {
  return header
    .replace(/\r\n /g, "")
    .replace(/=\?UTF-8\?B\?([^?]*)\?=/g, (_m, b64: string) =>
      new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
}

describe("header encoding", () => {
  it("leaves plain ASCII alone, so a raw message stays readable", () => {
    expect(encodeHeader("[SlopScore] 3 jobs not reporting in (sweep)")).toBe("[SlopScore] 3 jobs not reporting in (sweep)");
  });

  it("encodes the punctuation this site actually writes", () => {
    // The two that bounced: a middle dot and an em dash, both in one subject.
    const out = encodeHeader("[SlopScore] The Trawl Report · 2026-W37 is up — ready to send");
    expect(isHeaderSafe(out)).toBe(true);
    expect(out).toContain("=?UTF-8?B?");
    expect(decode(out)).toBe("[SlopScore] The Trawl Report · 2026-W37 is up — ready to send");
  });

  it("survives whatever a stranger types into the contact form", () => {
    for (const s of ["Tomás here 👋", "«quoted» — from a word processor", "日本語の件名", "🇯🇵🧀💥"]) {
      const out = encodeHeader(`[SlopScore] ${s} from someone`);
      expect(isHeaderSafe(out)).toBe(true);
      expect(decode(out)).toBe(`[SlopScore] ${s} from someone`);
    }
  });

  it("never splits a multi-byte character across two encoded-words", () => {
    // Long enough to force several chunks; every one must decode cleanly rather than to a replacement char.
    const subject = "🧀".repeat(40) + "é".repeat(40);
    const out = encodeHeader(subject, 400);
    expect(decode(out)).toBe(subject);
    expect(decode(out)).not.toContain("�");
  });

  it("keeps every encoded-word inside the 75-character limit", () => {
    for (const w of encodeHeader("é".repeat(120), 400).split("\r\n ")) {
      expect(w.length).toBeLessThanOrEqual(75);
    }
  });

  it("flattens newlines, because a header with CRLF in it is header injection", () => {
    const out = encodeHeader("hello\r\nBcc: someone@example.com");
    expect(out).toBe("hello Bcc: someone@example.com");
    expect(out.split("\r\n")).toHaveLength(1);
  });

  it("handles the empty and the absent without producing a broken header", () => {
    expect(encodeHeader("")).toBe("");
    expect(encodeHeader("   ")).toBe("");
    expect(encodeHeader(undefined as unknown as string)).toBe("");
  });
});

describe("the bulletin's own subject", () => {
  it("is safe to put in a header", () => {
    const row = (o: Partial<TrendRow>): TrendRow => ({ cohort: "trawl", metric: "language", period: "", key: "x", n: 1, mean_score: null, ...o });
    const v = shapeReport("2026-W37", "2026-09-14", null, [row({ metric: "totals", key: "listed", n: 214 })], []);
    const { subject } = dispatchMail(v, reportMd(v), "https://slopscore.org", null);
    // The raw subject carries the middle dot on purpose — it is the encoder's job to make that sendable.
    expect(subject).toContain("·");
    expect(isHeaderSafe(encodeHeader(subject))).toBe(true);
  });
});
