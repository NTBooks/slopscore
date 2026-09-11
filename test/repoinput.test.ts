import { describe, it, expect } from "vitest";
import { parseRepoInput } from "../src/lib/github";

describe("parseRepoInput", () => {
  it("accepts owner/name and GitHub URLs in every common shape", () => {
    expect(parseRepoInput("NTBooks/slopscore")).toEqual(["NTBooks", "slopscore"]);
    expect(parseRepoInput("  https://github.com/NTBooks/slopscore  ")).toEqual(["NTBooks", "slopscore"]);
    expect(parseRepoInput("http://www.github.com/NTBooks/slopscore.git")).toEqual(["NTBooks", "slopscore"]);
    expect(parseRepoInput("github.com/NTBooks/slopscore/tree/main/src")).toEqual(["NTBooks", "slopscore"]);
    expect(parseRepoInput("https://github.com/NTBooks/slopscore?tab=readme")).toEqual(["NTBooks", "slopscore"]);
    expect(parseRepoInput("git@github.com:NTBooks/slop.score.git")).toEqual(["NTBooks", "slop.score"]);
  });
  it("rejects anything that is not a repo", () => {
    expect(parseRepoInput("")).toBeNull();
    expect(parseRepoInput("slopscore")).toBeNull();
    expect(parseRepoInput("https://gitlab.com/a/b")).toBeNull();
    expect(parseRepoInput("a/..")).toBeNull();
    expect(parseRepoInput("-bad/name")).toBeNull();
    expect(parseRepoInput("a b/c")).toBeNull();
  });
});
