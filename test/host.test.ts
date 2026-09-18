import { describe, it, expect } from "vitest";
import { homeUrl, isSecondaryHost, primaryHost, SECONDARY_REDIRECT } from "../src/lib/host";

const env = { PRIMARY_HOST: "slopscore.org" };
const to = (u: string) => homeUrl(new Request(u), env);

describe("one home, and every other domain points at it", () => {
  it("leaves home alone", () => {
    expect(to("https://slopscore.org/r/a/b")).toBeNull();
    expect(to("https://www.slopscore.org/queue")).toBeNull();   // www has its own redirect in index.ts
  });

  it("sends a marketing domain home with the path and query intact", () => {
    expect(to("https://slopscupper.com/r/a/b?sort=new")).toBe("https://slopscore.org/r/a/b?sort=new");
  });

  it("drops www in the same hop, so nobody is bounced twice", () => {
    expect(to("https://www.slopscupper.com/best")).toBe("https://slopscore.org/best");
  });

  it("redirects /auth too: the OAuth callback and its cookie exist on one hostname only", () => {
    expect(to("https://slopscupper.com/auth/github?next=/me")).toBe("https://slopscore.org/auth/github?next=/me");
  });

  it("leaves dev, preview deploys and the test environment as themselves", () => {
    expect(to("http://localhost:8787/")).toBeNull();
    expect(to("https://slopscore.workers.dev/")).toBeNull();
    expect(to("https://test.slopscore.org/")).toBeNull();
  });

  it("does nothing at all when PRIMARY_HOST is unset", () => {
    expect(homeUrl(new Request("https://slopscupper.com/x"), {})).toBeNull();
    expect(primaryHost({})).toBe("");
    expect(isSecondaryHost("slopscupper.com", "")).toBe(false);
  });

  it("is the one thing that has to change to move the site", () => {
    expect(homeUrl(new Request("https://slopscore.org/r/a/b"), { PRIMARY_HOST: "slopscupper.com" }))
      .toBe("https://slopscupper.com/r/a/b");
  });

  it("lands the label's old front door on the label, and its deeper paths home as-is", () => {
    expect(to("https://slopscore.lumpdepot.com/")).toBe("https://slopscore.org/label/fiction/");
    expect(to("https://www.slopscore.lumpdepot.com/")).toBe("https://slopscore.org/label/fiction/");
    expect(to("https://slopscore.lumpdepot.com/spec")).toBe("https://slopscore.org/spec");
  });

  it("redirects temporarily, so a swap can never strand somebody in a cached loop", () => {
    expect(SECONDARY_REDIRECT).toBe(302);
  });
});
