// Every inline script the site serves, as bare bodies with no <script> wrapper.
//
// They live here, apart from the markup, for one reason: the Content-Security-Policy admits inline script
// only by SHA-256 hash, and lib/csp.ts hashes exactly these strings at runtime. Emit them through
// inlineScript() and the hash can never drift from what the browser is asked to run — edit a script and the
// next request hashes the new text. Markup a stranger smuggled onto a page has no matching hash and does
// not run.
//
// So: no inline event handlers (onclick=, onsubmit=) anywhere in the views. CSP can only hash an attribute
// under 'unsafe-hashes', which reopens the hole for injected markup. Use a data- attribute and delegate here.
import { raw } from "hono/html";

/** Wrap an inline script body for the page. The hash in lib/csp.ts is taken over the body alone. */
export const inlineScript = (js: string) => raw(`<script>${js}</script>`);

// Progressive enhancement only: the feed, the vote forms and the badge box all work without any of this.
export const INFINITE_JS = `(function(){
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
})();`;

export const VOTE_JS = `document.addEventListener('submit',async function(e){
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
});`;

// Copy-to-clipboard for the badge box, and select-all on the field beside it. No clipboard permission
// prompt is raised: the write happens inside a real user gesture.
export const CLIP_JS = `(function(){
  document.addEventListener('click',function(e){
    if(!e.target.closest) return;
    var i=e.target.closest('input[data-selectall]');
    if(i){ i.select(); return; }
    var b=e.target.closest('button[data-copy]');
    if(!b) return;
    var f=b.previousElementSibling, t=b.textContent;
    if(!f||!f.select) return;
    f.select();
    navigator.clipboard.writeText(f.value).then(function(){},function(){document.execCommand('copy')});
    b.textContent='copied';
    setTimeout(function(){b.textContent=t},1500);
  });
})();`;

// Ticks each countdown every second against the server clock; a */N cron rolls over to its next fire once it has passed.
export const COUNTDOWN_JS = `(function(){
  var box=document.getElementById('crawler'); if(!box) return;
  var off=Number(box.dataset.now)-Date.now()/1000;
  function tick(){
    var now=Date.now()/1000+off;
    box.querySelectorAll('time.countdown').forEach(function(t){
      var at=Number(t.dataset.at), every=Number(t.dataset.every)||0, s=Math.round(at-now);
      while(every&&s<=-90){at+=every;s+=every;t.dataset.at=at;}
      if(s<=0){t.textContent=s>-90?'running now':'due now';return;}
      var m=Math.floor(s/60), x=s%60;
      t.textContent='in '+(m>=10?m+'m':(m?m+'m ':'')+x+'s');
    });
  }
  tick(); setInterval(tick,1000);
})();`;

// The "are you sure?" on destructive owner and moderator buttons. The message is per-form and lives in
// data-confirm, because a CSP hash cannot cover an attribute whose text changes per page.
export const CONFIRM_JS = `(function(){
  document.addEventListener('submit',function(e){
    var f=e.target;
    if(!f||!f.getAttribute) return;
    var m=f.getAttribute('data-confirm');
    if(m&&!confirm(m)) e.preventDefault();
  });
})();`;

/** The hash set lib/csp.ts publishes. A script missing from this list is blocked by the browser. */
export const INLINE_SCRIPTS = [INFINITE_JS, VOTE_JS, CLIP_JS, CONFIRM_JS, COUNTDOWN_JS];
