// The crawler timer: when the sweep, scan tick and recrawl run next, and whether every job is still
// reporting in. Public on /queue; mods also get "run now" buttons.
//
// The health line is public for the same reason /log and /stats are: a site that publishes its moderation
// should publish when its own machinery has stopped. "All reporting in" is the normal answer and is said
// out loud, because a box that only appears when something is wrong is a box nobody learns to read.
import { raw } from "hono/html";
import { inlineScript, COUNTDOWN_JS } from "./clientjs";
import type { SessionUser } from "../env";
import { JOBS, HEALTH_LABEL, everyText, untilText, type CrawlClock, type JobClock, type Health } from "../lib/crawlclock";
import { ago, isoDateTime } from "../lib/time";

/**
 * Health as one word, in the chip colours the rest of the site already uses.
 * "not run yet" borrows the dashed outline rather than a colour: it is a state, not a fault.
 */
const HEALTH_CHIP: Record<Health, string> = { ok: "ok", failing: "bad", late: "warn", never: "unrec", unreported: "unrec", unknown: "unrec" };

const Chip = ({ j, at }: { j: JobClock; at: number }) => (
  <span class={`chip ${HEALTH_CHIP[j.health]}`} title={j.last_fail ? `${j.last_fail.why} (${ago(j.last_fail.at, at)})` : j.does}>
    {HEALTH_LABEL[j.health]}
  </span>
);

export const CrawlClockBox = ({ clock, user, back }: { clock: CrawlClock; user: SessionUser | null; back: "/queue" | "/mod" }) => (
  <div class="capacity crawler" id="crawler" data-now={clock.now}>
    <div style="grid-column:1/-1">
      <span class="label">crew</span>
      {clock.ailing.length ? (
        <strong>
          {clock.ailing.length === 1 ? "1 job is not reporting in" : `${clock.ailing.length} jobs are not reporting in`}:{" "}
          {clock.ailing.map((j, i) => <>{i ? ", " : ""}<code>{j.job}</code> ({HEALTH_LABEL[j.health]})</>)}
        </strong>
      ) : (
        <strong>All reporting in.</strong>
      )}
      <span class="muted small" style="display:block">
        Every job writes down whether it finished. A job that stops finishing shows here even when it threw
        nothing at all, which is what a killed run looks like from outside.
      </span>
    </div>
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
          {" · "}<Chip j={j} at={clock.now} />
        </span>
      </div>
    ))}
    <div style="grid-column:1/-1">
      <span class="label">once a day, at 00:05 UTC</span>
      <span class="muted small" style="display:block">
        {clock.daily.map((j, i) => (
          <>
            {i ? " · " : ""}<code>{j.job}</code>{" "}
            <Chip j={j} at={clock.now} />
            {j.last_ok ? ` ${ago(j.last_ok, clock.now)}` : ""}
          </>
        ))}
      </span>
    </div>
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
    {inlineScript(COUNTDOWN_JS)}
  </div>
);

