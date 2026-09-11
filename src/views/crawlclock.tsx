// The crawler timer: when the sweep, scan tick and recrawl run next. Public on /queue; mods also get "run now" buttons.
import { raw } from "hono/html";
import type { SessionUser } from "../env";
import { JOBS, everyText, untilText, type CrawlClock } from "../lib/crawlclock";
import { ago, isoDateTime } from "../lib/time";

export const CrawlClockBox = ({ clock, user, back }: { clock: CrawlClock; user: SessionUser | null; back: "/queue" | "/mod" }) => (
  <div class="capacity crawler" id="crawler" data-now={clock.now}>
    {clock.jobs.map((j) => (
      <div>
        <span class="label">{j.label}</span>
        <strong>
          {j.next_run
            ? <time class="countdown" datetime={isoDateTime(j.next_run)} data-at={j.next_run} data-every={j.every ?? ""} title={`${isoDateTime(j.next_run)} (${everyText(j.cron ?? "")})`}>{untilText(j.next_run - clock.now)}</time>
            : "not scheduled yet"}
        </strong>
        <span class="muted"> · {j.does}</span>
        <span class="muted small" style="display:block">
          last ran {j.last_run ? ago(j.last_run, clock.now) : "never"}
          {j.job === "sweep" && clock.sweep_found != null ? ` · found ${clock.sweep_found} new` : ""}
          {j.cron ? ` · ${everyText(j.cron)}` : ""}
          {j.manual && clock.now - j.manual.at < 86400 ? ` · run by hand by ${j.manual.by} ${ago(j.manual.at, clock.now)}` : ""}
        </span>
      </div>
    ))}
    {user?.isAdmin ? (
      <div style="grid-column:1/-1" class="actions">
        <span class="label">mod · run now (lands in the public log)</span>
        {[...JOBS, "all" as const].map((job) => (
          <form method="post" action="/mod/crawl" class="inline">
            <input type="hidden" name="csrf" value={user.csrf} />
            <input type="hidden" name="back" value={back} />
            <button class="btn secondary" name="action" value={job} title={job === "scan" || job === "all" ? "Scans call the AI checks; this can take half a minute." : undefined}>
              {job === "all" ? "sweep + scan + recrawl" : `${job} now`}
            </button>
          </form>
        ))}
      </div>
    ) : null}
    <p class="muted small">
      {clock.jobs.some((j) => j.cron)
        ? "A new repo needs the sweep to find it, then a scan tick to inspect it. "
        : "The schedule shows up after the first cron tick on this deploy. "}
      The sweep only sees what GitHub's code search has indexed, which can trail a push. <a href="/scan">Request a scan</a> to skip the wait.
    </p>
    {raw(COUNTDOWN_JS)}
  </div>
);

// Ticks each countdown every second against the server clock; a */N cron rolls over to its next fire once it has passed.
const COUNTDOWN_JS = `<script>
(function(){
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
})();
</script>`;
