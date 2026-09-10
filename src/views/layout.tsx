import type { FC, PropsWithChildren } from "hono/jsx";
import { raw } from "hono/html";
import type { SessionUser } from "../env";
import { SORTS, type Sort } from "../lib/db";

export interface PageMeta {
  title: string;
  description?: string;
  image?: string;
  canonical?: string;
  noindex?: boolean;
}

export const SITE = {
  name: "SlopScore",
  tagline: "Give me your slop!",
  slogan: "I love slop, slop slop slop, eat it up yum.",
  description: "Peer review for code nobody wrote.",
  manifesto: "Any agent can rebuild your app from a screenshot by lunch. Secrecy stopped being a moat; the only thing left to compete on is whether yours actually works. So push it, add the file, and let the trough decide.",
};

export const Layout: FC<PropsWithChildren<{ meta: PageMeta; user: SessionUser | null; url: URL; sort?: Sort; q?: string }>> = ({ meta, user, url, sort, q, children }) => {
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
        {meta.noindex ? <meta name="robots" content="noindex" /> : null}
      </head>
      <body>
        <header class="top">
          <a class="wordmark" href="/" title={`${SITE.tagline} ${SITE.description}`}>
            <span class="mark">🐷</span> SlopScore<sup>™</sup>
          </a>
          <nav class="tabs">
            {SORTS.map((s) => (
              <a href={s === "upcoming" ? "/upcoming" : `/?sort=${s}`} class={sort === s ? "on" : ""}>{s}</a>
            ))}
            <a href="/queue" class={url.pathname.startsWith("/queue") ? "on" : ""}>queue</a>
            <a href="/best" class={url.pathname.startsWith("/best") ? "on" : ""}>winners</a>
          </nav>
          <form class="search" action="/search" method="get" role="search">
            <input type="search" name="q" value={q ?? ""} placeholder="search slop… category:cli lang:python -tool:cursor" aria-label="Search" />
            <button type="submit">go</button>
          </form>
          <div class="who">
            {user ? (
              <>
                <a href={`/u/${user.login}`}><img src={user.avatar_url ?? ""} alt="" class="avatar" /> {user.login}</a>
                {user.isAdmin ? <a href="/mod" class="mod">mod</a> : null}
                <form method="post" action="/auth/logout" class="inline"><input type="hidden" name="csrf" value={user.csrf} /><button class="link">logout</button></form>
              </>
            ) : (
              <a href={`/auth/github?next=${encodeURIComponent(url.pathname + url.search)}`} class="login">log in with GitHub</a>
            )}
          </div>
        </header>
        <main class="wrap">{children}</main>
        <footer class="foot">
          <p><strong>Nothing here is a secret. That's the point.</strong></p>
          <p>
            <a href="/about">about</a> · <a href="/spec">spec</a> · <a href="/stats">stats</a> · <a href="/log">mod log</a> · <a href="/tools">built with</a>
            · for agents: <a href="/llms.txt">llms.txt</a> · <a href="/openapi.json">openapi</a> · <a href="/mcp">mcp</a> · <a href="/api/v1/vocab">vocab</a>
            · <a href="/feed.xml">rss</a>
          </p>
          <p class="muted">Every page is also <code>.json</code> and <code>.md</code>. Votes need a GitHub login; nothing else does.</p>
        </footer>
        {raw(VOTE_JS)}
      </body>
    </html>
  );
};

// Progressive enhancement only: forms work without it.
const VOTE_JS = `<script>
document.addEventListener('submit',async function(e){
  var f=e.target; if(!f.classList||!f.classList.contains('vote')) return;
  e.preventDefault();
  var btn=e.submitter||f.querySelector('button');
  var fd=new FormData(f); if(btn&&btn.name) fd.set(btn.name,btn.value);
  var r=await fetch(f.action,{method:'POST',body:fd,headers:{'accept':'application/json'}});
  if(r.status===401){location.href='/auth/github?next='+encodeURIComponent(location.pathname);return;}
  if(!r.ok){var j=await r.json().catch(function(){return {}}); alert(j.error||('vote failed ('+r.status+')')); return;}
  var d=await r.json(); var box=f.closest('.votebox'); if(!box) return;
  box.querySelector('.score').textContent=d.score;
  box.querySelectorAll('button').forEach(function(b){b.classList.toggle('on', Number(b.value)===d.mine)});
});
</script>`;
