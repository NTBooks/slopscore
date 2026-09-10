// Content negotiation: every HTML route can also answer as JSON or Markdown.
// The fetch handler strips a trailing .json/.md from the path and stores the wanted format in a header.
import type { Context } from "hono";

export type Format = "html" | "json" | "md";
export const FORMAT_HEADER = "x-ss-format";

/** Rewrites /r/o/r.json -> /r/o/r and records the format. Called before routing. */
export function rewriteFormat(request: Request): Request {
  const url = new URL(request.url);
  const m = /^(.*?)\.(json|md)$/.exec(url.pathname);
  // don't touch static assets or feeds that legitimately end in those extensions
  if (m && !url.pathname.startsWith("/public/") && url.pathname !== "/openapi.json") {
    url.pathname = m[1] || "/";
    const req = new Request(url.toString(), request);
    req.headers.set(FORMAT_HEADER, m[2]);
    return req;
  }
  return request;
}

export function wantedFormat(c: Context): Format {
  const forced = c.req.header(FORMAT_HEADER);
  if (forced === "json" || forced === "md") return forced;
  const q = c.req.query("format");
  if (q === "json" || q === "md") return q;
  const accept = (c.req.header("accept") ?? "").toLowerCase();
  if (accept.includes("application/json") && !accept.includes("text/html")) return "json";
  if (accept.includes("text/markdown")) return "md";
  return "html";
}

export interface Renderers<T> {
  html: (data: T) => string | Promise<string>;
  md: (data: T) => string;
  json?: (data: T) => unknown;
}

/** One handler, three renderers. Adds Link: rel=alternate headers on every response. */
export async function respond<T>(c: Context, data: T, r: Renderers<T>, status = 200): Promise<Response> {
  const fmt = wantedFormat(c);
  const url = new URL(c.req.url);
  const base = url.pathname.replace(/\/$/, "") || "";
  const qs = url.search;
  const alt = [
    `<${base || "/"}${qs}>; rel="alternate"; type="text/html"`,
    `<${base}.json${qs}>; rel="alternate"; type="application/json"`,
    `<${base}.md${qs}>; rel="alternate"; type="text/markdown"`,
  ].join(", ");
  c.header("Link", alt);
  c.header("Vary", "Accept, Cookie");
  if (fmt === "json") {
    return c.json((r.json ? r.json(data) : data) as object, status as 200);
  }
  if (fmt === "md") {
    return c.body(r.md(data), status as 200, { "content-type": "text/markdown; charset=utf-8" });
  }
  return c.html(await r.html(data), status as 200);
}
