import type { FC, PropsWithChildren } from "hono/jsx";
import { raw } from "hono/html";
import type { SessionUser } from "../env";
import { SORTS, type Sort } from "../lib/db";
import { Wordmark } from "./art";

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
        <header class="top">
          <a class="wordmark" href="/" title={`${SITE.tagline} ${SITE.description}`}>
            <img src="/favicon.svg" alt="" class="mark" width="28" height="28" /> <Wordmark />
          </a>
          <nav class="tabs">
            {SORTS.map((s) => (
              <a href={s === "upcoming" ? "/upcoming" : `/?sort=${s}`} class={sort === s ? "on" : ""}>{s}</a>
            ))}
            <a href="/queue" class={url.pathname.startsWith("/queue") ? "on" : ""}>queue</a>
            <a href="/best" class={url.pathname.startsWith("/best") ? "on" : ""} title="truffles: what Schnitzel dug up">winners</a>
          </nav>
          <form class="search" action="/search" method="get" role="search">
            <input type="search" name="q" value={q ?? ""} placeholder="search slop… category:cli lang:python -tool:cursor" aria-label="Search" />
            <button type="submit">go</button>
          </form>
          <div class="who">
            {user ? (
              <>
                <a href={`/u/${user.login}`}><img src={user.avatar_url ?? ""} alt="" class="avatar" /> {user.login}</a>
                <a href="/me" title="everything you own or maintain here">my repos</a>
                {user.isAdmin ? <a href="/mod" class="mod">mod</a> : null}
                <form method="post" action="/auth/logout" class="inline"><input type="hidden" name="csrf" value={user.csrf} /><button class="link">logout</button></form>
              </>
            ) : (
              <a href={`/auth/github?next=${encodeURIComponent(url.pathname + url.search)}`} class="login">{raw(GITHUB_MARK)} Log in with GitHub</a>
            )}
          </div>
        </header>
        <main class="wrap">{children}</main>
        <footer class="foot">
          <p><strong>Nothing here is a secret. That's the point.</strong></p>
          <p>
            <a href="/about">about</a> · <a href="/contact">contact</a> · <a href="/scan">request a scan</a> · <a href="/spec">spec</a> · <a href="/stats">stats</a> · <a href="/log">mod log</a> · <a href="/tools">built with</a>
            · for agents: <a href="/llms.txt">llms.txt</a> · <a href="/openapi.json">openapi</a> · <a href="/mcp">mcp</a> · <a href="/api/v1/vocab">vocab</a>
            · <a href="/feed.xml">rss</a>
          </p>
          <p class="muted">Every page is also <code>.json</code> and <code>.md</code>. Votes need a GitHub login; nothing else does. Made by slopsmiths, for slopsmiths.</p>
        </footer>
        {raw(VOTE_JS)}
        {raw(INFINITE_JS)}
        <script src="/schnitzel.js" defer></script>
      </body>
    </html>
  );
};

// GitHub's octocat mark (from GitHub's brand assets; simple path, no trademark restrictions on the mark for "log in with GitHub" buttons).
const GITHUB_MARK = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;

// Infinite scroll, progressive: the pager's next link still works without it. When the link nears the viewport, fetch the
// next page's HTML and append its rows to the same list (matched by position, so /queue's two lists stay apart).
// Rows already on the page are skipped (hot ranks shift between fetches). Stops after 40 pages; the link remains.
const INFINITE_JS = `<script>
(function(){
  if(!('IntersectionObserver' in window)||!window.DOMParser) return;
  var busy=false, loaded=0, MAX=40;
  var io=new IntersectionObserver(function(es){ es.forEach(function(e){ if(e.isIntersecting) more(e.target); }); },{rootMargin:'800px 0px'});
  function hook(){ document.querySelectorAll('.pager a[rel=next]').forEach(function(a){ if(a.dataset.watch) return; a.dataset.watch='1'; io.observe(a); }); }
  async function more(a){
    if(busy||loaded>=MAX) return;
    var pager=a.closest('.pager'), list=pager&&pager.previousElementSibling;
    if(!list||!list.matches('ol.feed')) return;
    busy=true;
    var idx=[].indexOf.call(document.querySelectorAll('ol.feed'),list), label=a.textContent;
    a.textContent='digging up more slop…';
    try{
      var r=await fetch(a.href,{headers:{accept:'text/html'},credentials:'same-origin'});
      if(!r.ok) throw new Error(String(r.status));
      var doc=new DOMParser().parseFromString(await r.text(),'text/html');
      var nl=doc.querySelectorAll('ol.feed')[idx];
      if(nl) [].slice.call(nl.children).forEach(function(li){ if(!li.id||!document.getElementById(li.id)) list.appendChild(document.importNode(li,true)); });
      var np=nl&&nl.nextElementSibling, nn=np&&np.classList.contains('pager')?np.querySelector('a[rel=next]'):null;
      io.unobserve(a); delete a.dataset.watch; a.textContent=label;
      if(nn){ a.href=nn.getAttribute('href'); loaded++; hook(); }
      else { var end=document.createElement('div'); end.className='pager muted'; end.textContent='That\u2019s the bottom of the trough.'; pager.replaceWith(end); }
    }catch(_){ a.textContent=label; }
    busy=false;
  }
  hook();
})();
</script>`;

// Progressive enhancement only: forms work without it.
const VOTE_JS = `<script>
document.addEventListener('submit',async function(e){
  var f=e.target; if(!f.classList||!f.classList.contains('vote')) return;
  e.preventDefault();
  var btn=e.submitter||f.querySelector('button');
  var fd=new FormData(f); if(btn&&btn.name) fd.set(btn.name,btn.value);
  var r=await fetch(f.action,{method:'POST',body:fd,headers:{'accept':'application/json'}});
  if(r.status===401){location.href='/auth/github?next='+encodeURIComponent(location.pathname);return;}
  if(r.status===429){var jj=await r.json().catch(function(){return {}}); alert(jj.error||'slow down'); return;}
  if(!r.ok){var j=await r.json().catch(function(){return {}}); alert(j.error||('vote failed ('+r.status+')')); return;}
  var d=await r.json(); var box=f.closest('.votebox'); if(!box) return;
  if(d.crowd){ var cr=box.querySelector('.crowd'); if(cr){ var n=(d.crowd_up||0)-(d.crowd_down||0); cr.textContent=(n>0?'+'+n:n)+' crowd'; } }
  else box.querySelector('.score').textContent=d.score;
  box.querySelectorAll('button').forEach(function(b){b.classList.toggle('on', Number(b.value)===d.mine)});
});
</script>`;
