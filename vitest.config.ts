import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  // The stylesheet as a string for test/contrast.test.ts. A ?raw import of a .css file comes back empty
  // under this pool (the CSS pipeline claims it first), so it is read here, in Node, and inlined.
  define: { __STYLE_CSS__: JSON.stringify(readFileSync("public/style.css", "utf8")) },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: { bindings: { SESSION_SECRET: "test-secret" } },
      // wrangler.jsonc marks the AI binding "remote" so `wrangler dev` can reach Workers AI, which has no
      // local simulator. The pool honours that by opening a preview session against the Cloudflare API
      // before a single test runs, which made the suite impossible to run without an authenticated account
      // -- and impossible in CI, which has none. No test here touches a binding: they import pure functions
      // out of src/ and want the workers runtime, not the account. If one ever does need Workers AI, it
      // wants a stub, not the real endpoint on a test runner's bill.
      remoteBindings: false,
    }),
  ],
  test: { include: ["test/**/*.test.{ts,tsx}"] },
});
