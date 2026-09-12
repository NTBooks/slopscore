import { describe, it, expect } from "vitest";
import { onPrimaryHost, isSecondaryHost, primaryHost } from "../src/lib/host";

const env = { PRIMARY_HOST: "slopscore.org" };
const at = (u: string) => new URL(onPrimaryHost(new Request(u), env).url);

describe("two domains, one canonical host", () => {
  it("leaves the primary host alone", () => {
    expect(at("https://slopscore.org/r/a/b").href).toBe("https://slopscore.org/r/a/b");
    expect(at("https://www.slopscore.org/queue").href).toBe("https://www.slopscore.org/queue");
  });

  it("speaks about a secondary host as the primary one, path and query intact", () => {
    expect(at("https://slopscupper.com/r/a/b?sort=new").href).toBe("https://slopscore.org/r/a/b?sort=new");
  });

  it("keeps the www prefix so the existing www redirect still fires", () => {
    expect(at("https://www.slopscupper.com/best").href).toBe("https://www.slopscore.org/best");
  });

  it("never touches /auth: the OAuth callback and its state cookie live on one host", () => {
    expect(at("https://slopscupper.com/auth/github?next=/me").href).toBe("https://slopscupper.com/auth/github?next=/me");
    expect(at("https://slopscupper.com/auth/callback?code=x").href).toBe("https://slopscupper.com/auth/callback?code=x");
  });

  it("leaves dev, preview deploys and the test environment as themselves", () => {
    expect(at("http://localhost:8787/").href).toBe("http://localhost:8787/");
    expect(at("https://slopscore.workers.dev/").href).toBe("https://slopscore.workers.dev/");
    expect(at("https://test.slopscore.org/").href).toBe("https://test.slopscore.org/");
  });

  it("does nothing at all when PRIMARY_HOST is unset", () => {
    const r = onPrimaryHost(new Request("https://slopscupper.com/x"), {});
    expect(new URL(r.url).hostname).toBe("slopscupper.com");
    expect(primaryHost({})).toBe("");
    expect(isSecondaryHost("slopscupper.com", "")).toBe(false);
  });

  it("is the one thing that has to change to move the site", () => {
    const moved = new URL(onPrimaryHost(new Request("https://slopscore.org/r/a/b"), { PRIMARY_HOST: "slopscupper.com" }).url);
    expect(moved.href).toBe("https://slopscupper.com/r/a/b");
  });
});
