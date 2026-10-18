// The site, shut. CLOSED="on" answers every route with one page: Schnitzel, animated, and a thank-you. The
// scheduled jobs stop too (src/index.ts), so nothing trawls, scans or mails while the doors are closed.
// Flip the var back and deploy to reopen; the database is untouched either way.
//
// It runs after `secure` (so the page carries the CSP and noindex headers) and before loadUser, so a closed
// site never touches the database on a request. Static files never reach the worker, so /mascot.svg,
// /awake.js and /schnitzel.js still serve and the pig still moves. /privacy and /terms stay open: the
// database still holds what those pages describe, and they are how somebody asks for it to go.
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../env";
import { raw } from "hono/html";
import { Mascot } from "../views/art";

const OPEN = new Set(["/privacy", "/terms", "/robots.txt"]);

export function isClosed(env: { CLOSED?: string }): boolean {
  return (env.CLOSED ?? "").trim().toLowerCase() === "on";
}

const NOTE = "Thanks for the slopsperiment.";

const STYLE = `
:root { --bg: #fdf6f7; --fg: #2a1a14; --muted: #6f5a55; --link: #8a4a2a; }
@media (prefers-color-scheme: dark) { :root { --bg: #1a1210; --fg: #f3e6e8; --muted: #a58f90; --link: #e6b08a; } }
html, body { margin: 0; height: 100%; }
body { background: var(--bg); color: var(--fg); font-family: verdana, "Segoe UI", arial, helvetica, sans-serif;
  display: flex; align-items: center; justify-content: center; text-align: center; padding: 16px; box-sizing: border-box; }
figure.mascot { margin: 0 0 12px; }
.mascot-img { display: inline-block; filter: drop-shadow(0 5px 8px rgba(0,0,0,.18)); max-width: 70vw; height: auto; }
svg.mascot-img { overflow: visible; }
h1 { font-size: 26px; margin: 0 0 10px; }
p { color: var(--muted); font-size: 13px; margin: 6px 0; }
a { color: var(--link); }
`;

export const closedGate: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!isClosed(c.env)) return next();
  const path = new URL(c.req.url).pathname;
  if (OPEN.has(path)) return next();
  // Retry-After says "temporary" to anything that reads it; a crawler that keeps finding it drops the pages anyway.
  c.header("retry-after", "86400");
  if (path.startsWith("/api/") || path === "/mcp" || path.startsWith("/mcp/")) return c.json({ closed: true, message: NOTE }, 503);
  const contact = c.env.CONTACT_EMAIL;
  return c.html(
    "<!doctype html>" +
      (
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <meta name="robots" content="noindex" />
            <title>SlopScore</title>
            <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
            <style>{raw(STYLE)}</style>
          </head>
          <body>
            <main>
              <figure class="mascot"><Mascot size={260} /></figure>
              <h1>{NOTE}</h1>
              <p>SlopScore is closed for now.</p>
              <p>
                {contact ? <><a href={`mailto:${contact}`}>{contact}</a> · </> : null}
                <a href="/privacy">privacy</a> · <a href="/terms">terms</a>
              </p>
            </main>
            <script src="/awake.js" defer></script>
            <script src="/schnitzel.js" defer></script>
          </body>
        </html>
      ).toString(),
    503,
  );
};
