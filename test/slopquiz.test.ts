import { describe, it, expect } from "vitest";
import { QUESTIONS, MAX_POINTS, TIERS, tierFor, scoreAnswers, encodeAnswers, decodeAnswers, answersFromFields, draftFile } from "../src/lib/slopquiz";
import { parseSlopMd } from "../src/lib/slopmd";
import { AI_GENERATED, HUMAN_TOUCH, STATUS } from "../src/lib/vocab";

/** Every one of the 4^7 ways through the questionnaire. */
function everyAnswer(): number[][] {
  let rows: number[][] = [[]];
  for (let i = 0; i < QUESTIONS.length; i++) rows = rows.flatMap((r) => [0, 1, 2, 3].map((n) => [...r, n]));
  return rows;
}

describe("the questions", () => {
  it("is seven questions of four options, each scored 0-3", () => {
    expect(QUESTIONS).toHaveLength(7);
    for (const q of QUESTIONS) {
      expect(q.options).toHaveLength(4);
      expect(q.options.map((o) => o.weight)).toEqual([0, 1, 2, 3]);
      for (const o of q.options) expect(o.note.length).toBeGreaterThan(0);
    }
    expect(MAX_POINTS).toBe(21);
  });

  it("has unique question ids", () => {
    expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length);
  });
});

describe("tiers", () => {
  it("tiles 0..MAX_POINTS with no gap and no overlap", () => {
    expect(TIERS[0].min).toBe(0);
    expect(TIERS[TIERS.length - 1].max).toBe(MAX_POINTS);
    for (let i = 1; i < TIERS.length; i++) expect(TIERS[i].min).toBe(TIERS[i - 1].max + 1);
    for (let p = 0; p <= MAX_POINTS; p++) {
      expect(TIERS.filter((t) => p >= t.min && p <= t.max)).toHaveLength(1);
    }
  });

  it("puts the boundary scores in the tier the copy promises", () => {
    const name = (p: number) => tierFor(p).name;
    expect(name(3)).toBe("Hand-typed, and nobody believes you");
    expect(name(4)).toBe("Assisted, and honest about it");
    expect(name(8)).toBe("Assisted, and honest about it");
    expect(name(9)).toBe("Prompt-raised");
    expect(name(13)).toBe("Prompt-raised");
    expect(name(14)).toBe("Certified slop");
    expect(name(18)).toBe("Certified slop");
    expect(name(19)).toBe("Grade A, prime cut, inspected slop");
  });

  it("is reachable, every one of them, by answering the questions", () => {
    const hit = new Set(everyAnswer().map((a) => scoreAnswers(a).tier.name));
    expect(hit.size).toBe(TIERS.length);
  });
});

describe("scoring", () => {
  it("scores the two extremes", () => {
    expect(scoreAnswers([0, 0, 0, 0, 0, 0, 0])).toMatchObject({ points: 0, pct: 0 });
    expect(scoreAnswers([3, 3, 3, 3, 3, 3, 3])).toMatchObject({ points: 21, pct: 100 });
  });

  it("adds the weight of each chosen option", () => {
    expect(scoreAnswers([3, 1, 2, 0, 0, 1, 1]).points).toBe(8);
  });
});

describe("the URL", () => {
  it("round-trips every answer set", () => {
    for (const a of everyAnswer()) expect(decodeAnswers(encodeAnswers(a))).toEqual(a);
  });

  it("refuses junk rather than clamping it", () => {
    for (const bad of ["", null, undefined, "123", "31202134", "312021a", "3120-13", "３１２０２１３", " 312021"]) {
      expect(decodeAnswers(bad)).toBeNull();
    }
    expect(decodeAnswers("3120214")).toBeNull(); // 4 is not an option
  });
});

describe("the no-JS form", () => {
  const complete: Record<string, string> = { q1: "3", q2: "1", q3: "2", q4: "0", q5: "0", q6: "1", q7: "1" };

  it("reads q1..q7", () => {
    expect(answersFromFields((n) => complete[n])).toEqual([3, 1, 2, 0, 0, 1, 1]);
  });

  it("returns null on a partial or out-of-range submission", () => {
    expect(answersFromFields((n) => (n === "q4" ? undefined : complete[n]))).toBeNull();
    expect(answersFromFields((n) => (n === "q4" ? "" : complete[n]))).toBeNull();
    expect(answersFromFields((n) => (n === "q4" ? "9" : complete[n]))).toBeNull();
    expect(answersFromFields((n) => (n === "q4" ? "-1" : complete[n]))).toBeNull();
    expect(answersFromFields((n) => (n === "q4" ? "1.5" : complete[n]))).toBeNull();
    expect(answersFromFields((n) => (n === "q4" ? "two" : complete[n]))).toBeNull();
  });
});

describe("the draft slopscore.md", () => {
  // The one that matters: the page must never hand somebody a file its own crawler would turn away.
  it("parses clean for every route through the questionnaire", () => {
    for (const a of everyAnswer()) {
      const res = parseSlopMd(draftFile(a));
      expect(res.errors, `answers ${a.join("")}`).toEqual([]);
      expect(res.ok, `answers ${a.join("")}`).toBe(true);
      expect(res.warnings, `answers ${a.join("")}`).toEqual([]);
      expect(AI_GENERATED).toContain(res.meta!.ai_generated);
      expect(HUMAN_TOUCH).toContain(res.meta!.human_touch);
      expect(STATUS).toContain(res.meta!.status);
    }
  });

  it("declares what the first answer said about who typed it", () => {
    const ai = (wrote: number) => parseSlopMd(draftFile([wrote, 1, 1, 1, 1, 1, 1])).meta!.ai_generated;
    expect(ai(0)).toBe("none");
    expect(ai(1)).toBe("partly");
    expect(ai(2)).toBe("mostly");
    expect(ai(3)).toBe("entirely");
  });

  it("leaves built_with off the hand-typed draft and on every other one", () => {
    expect(draftFile([0, 0, 0, 0, 0, 0, 0])).not.toContain("built_with");
    expect(draftFile([1, 0, 0, 0, 0, 0, 0])).toContain("built_with");
  });

  it("does not file somebody who typed every line under vibe-coded", () => {
    expect(draftFile([0, 0, 0, 0, 0, 0, 0])).not.toContain("vibe-coded");
    expect(draftFile([1, 0, 0, 0, 0, 0, 0])).toContain("slopbucket: [vibe-coded]");
  });

  it("carries the last answer into status", () => {
    const status = (ran: number) => parseSlopMd(draftFile([2, 1, 1, 1, 1, 1, ran])).meta!.status;
    expect(status(0)).toBe("stable");
    expect(status(3)).toBe("works-on-my-machine");
  });
});
