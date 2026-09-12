import type { FC, PropsWithChildren } from "hono/jsx";
import { raw } from "hono/html";
import type { SessionUser } from "../env";
import { visibleSorts, type Sort } from "../lib/db";
import { Wordmark, Icon } from "./art";
import { inlineScript, INFINITE_JS, VOTE_JS, CLIP_JS, CONFIRM_JS } from "./clientjs";

export interface PageMeta {
  title: string;
  description?: string;
  image?: string;
  canonical?: string;
  noindex?: boolean;
  /** Schema.org JSON-LD for this page: one object, or several. Rendered verbatim in the head. */
  jsonLd?: unknown | unknown[];
}

export const SITE = {
  name: "SlopScore",
  tagline: "Give me your slop!",
  slogan: "I love slop, slop slop slop, eat it up yum.",
  description: "Peer review for code nobody wrote.",
  manifesto: "Any agent can rebuild your app from a screenshot by lunch. Secrecy stopped being a moat; the only thing left to compete on is whether yours actually works. So push it, add the file, and let the trough decide.",
};

/** Every page carries the site node so search engines can attach a name, a logo and the search box to the domain. */
function jsonLd(meta: PageMeta, url: URL) {
  const site = {
    "@type": "WebSite",
    "@id": `${url.origin}/#website`,
    name: SITE.name,
    url: `${url.origin}/`,
    description: `${SITE.tagline} ${SITE.description}`,
    inLanguage: "en",
    publisher: { "@type": "Organization", "@id": `${url.origin}/#org`, name: SITE.name, url: `${url.origin}/`, logo: `${url.origin}/favicon.svg` },
    potentialAction: {
      "@type": "SearchAction",
      target: { "@type": "EntryPoint", urlTemplate: `${url.origin}/search?q={search_term_string}` },
      "query-input": "required name=search_term_string",
    },
  };
  const extra = meta.jsonLd ? (Array.isArray(meta.jsonLd) ? meta.jsonLd : [meta.jsonLd]) : [];
  const graph = { "@context": "https://schema.org", "@graph": [site, ...extra] };
  return <script type="application/ld+json">{raw(JSON.stringify(graph).replace(/</g, "\\u003c"))}</script>;
}

export const Layout: FC<PropsWithChildren<{ meta: PageMeta; user: SessionUser | null; url: URL; sort?: Sort; q?: string; tags?: { slug: string; title: string }[] }>> = ({ meta, user, url, sort, q, tags, children }) => {
  const image = meta.image ?? `${url.origin}/hero.png`;
  const canonical = meta.canonical ?? `${url.origin}${url.pathname}${url.search}`;
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{meta.title}</title>
        <meta name="description" content={meta.description ?? `${SITE.tagline} ${SITE.description}`} />
        <link rel="canonical" href={canonical} />
        <link rel="stylesheet" href="/style.css" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <link rel="alternate" type="application/rss+xml" title="New slop" href="/feed.xml" />
        <meta property="og:site_name" content={SITE.name} />
        <meta property="og:type" content="website" />
        <meta property="og:title" content={meta.title} />
        <meta property="og:description" content={meta.description ?? SITE.tagline} />
        <meta property="og:image" content={image} />
        <meta property="og:url" content={canonical} />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={meta.title} />
        <meta name="twitter:description" content={meta.description ?? SITE.tagline} />
        <meta name="twitter:image" content={image} />
        {meta.noindex ? <meta name="robots" content="noindex, follow" /> : null}
        {jsonLd(meta, url)}
      </head>
      <body>
        {tags?.length ? (
          <div class="tagbar">
            <span class="muted">b/</span>{tags.slice(0, 18).map((t) => <a href={`/b/${t.slug}`} class={url.pathname === `/b/${t.slug}` ? "on" : ""} title={t.title}>{t.slug}</a>)}
            <a href="/b" class="more">all slopbuckets »</a>
          </div>
        ) : null}
        {/* .searching: on a phone the search box is hidden and reached by the tab-bar magnifier, except here, where it is the page. */}
        <header class={`top${url.pathname === "/search" ? " searching" : ""}`}>
          <a class="wordmark" href="/" title={`${SITE.tagline} ${SITE.description}`}>
            <img src="/favicon.svg" alt="" class="mark" width="28" height="28" /> <Wordmark />
          </a>
          <nav class="tabs">
            {visibleSorts().map((s) => (
              <a href={s === "upcoming" ? "/upcoming" : `/?sort=${s}`} class={sort === s ? "on" : ""}>{s}</a>
            ))}
            {user ? <a href="/upvoted" class={url.pathname.startsWith("/upvoted") ? "on" : ""} title="everything you upvoted, newest first">upvoted</a> : null}
            <a href="/queue" class={url.pathname.startsWith("/queue") ? "on" : ""}>queue</a>
            <a href="/best" class={url.pathname.startsWith("/best") ? "on" : ""} title="truffles: what Schnitzel dug up">winners</a>
            {user ? <a href="/me" class={`onphone${url.pathname === "/me" ? " on" : ""}`}>my repos</a> : null}
          </nav>
          <form class="search" action="/search" method="get" role="search">
            <input type="search" name="q" value={q ?? ""} placeholder="search slop… category:cli lang:python -tool:cursor" aria-label="Search" />
            <button type="submit">go</button>
          </form>
          <div class="who">
            {/* The phone's search: the box below is hidden there, so this opens the page that keeps one. */}
            <a href="/search" class="onphone mag" aria-label="Search"><Icon name="search" /></a>
            {user ? (
              <>
                <a href={`/u/${user.login}`}><img src={user.avatar_url ?? ""} alt="" class="avatar" /> {user.login}</a>
                <a href="/me" class="ondesk" title="everything you own or maintain here">my repos</a>
                {user.isAdmin ? <a href="/mod" class="mod">mod</a> : null}
                <form method="post" action="/auth/logout" class="inline"><input type="hidden" name="csrf" value={user.csrf} /><button class="link">logout</button></form>
              </>
            ) : (
              <a href={`/auth/github?next=${encodeURIComponent(url.pathname + url.search)}`} class="login">{raw(GITHUB_MARK)} Log in with GitHub</a>
            )}
          </div>
        </header>
        <aside class="agentbar" aria-label="For coding agents">
          <span class="tag">for agents</span>
          <span>Read <a href="/skill.md"><code>{url.origin}/skill.md</code></a> and leave the repo on the doorstep.</span>
          <a class="more" href="/for-agents">how to hand it over »</a>
        </aside>
        <main class="wrap">{children}</main>
        {/* Sticky: the feed scrolls for ever (see INFINITE_JS), so the bottom of the document is a place nobody arrives at. */}
        <footer class="foot">
          <p class="footlinks">
            <strong>Nothing here is a secret. That's the point.</strong>
            <a href="/about">about</a> · <a href="/contact">contact</a> · <a href="/scan">request a scan</a> · <a href="/spec">spec</a> · <a href="/disclosure">disclosure</a> · <a href="/trends">trends</a> · <a href="/stats">stats</a> · <a href="/log">mod log</a> · <a href="/balcony">the balcony</a> · <a href="/tools">built with</a>
            · <a href="/for-agents">for agents</a>: <a href="/skill.md">skill.md</a> · <a href="/llms.txt">llms.txt</a> · <a href="/openapi.json">openapi</a> · <a href="/mcp">mcp</a> · <a href="/api/v1/vocab">vocab</a>
            · <a href="/feed.xml">rss</a> · <a href="/trawl.xml" title="the trawl's own feed: what the Cap'm dragged in">the hauls</a>
          </p>
          <p class="muted">Every page is also <code>.json</code> and <code>.md</code>. Votes need a GitHub login; nothing else does. Made by slopsmiths, for slopsmiths.</p>
        </footer>
        {inlineScript(VOTE_JS)}
        {inlineScript(INFINITE_JS)}
        {inlineScript(CLIP_JS)}
        {inlineScript(CONFIRM_JS)}
        <script src="/schnitzel.js" defer></script>
        {/* The cast lockets on /balcony. It finds nothing to do on every other page and stops. */}
        <script src="/lockets.js" defer></script>
      </body>
    </html>
  );
};

// GitHub's octocat mark (from GitHub's brand assets; simple path, no trademark restrictions on the mark for "log in with GitHub" buttons).
const GITHUB_MARK = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;

// Infinite scroll, progressive: the pager's next link still works without it. When the link nears the viewport, fetch the
// next page's HTML and append its rows to the same list (matched by position, so /queue's two lists stay apart).
// Rows already on the page are skipped (hot ranks shift between fetches). Stops after 40 pages; the link remains.

