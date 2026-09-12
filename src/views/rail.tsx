import type { FC } from "hono/jsx";
import { MINIMAL_EXAMPLE, SAMPLE_BUCKETS } from "../lib/slopmd";
import { Mascot, StepIcon } from "./art";
import type { ChatLine, ChatWindow } from "../lib/critics";
import { BalconyChat, QuietBalcony } from "./balconychat";
import { SeaChart } from "./sea";
import { flagOn } from "../lib/flags";
import { SITE } from "./layout";

export interface RailData {
  stats: { listed: number; queued: number; users: number; votes: number; comments: number };
  tools: { value: string; n: number; mean: number }[];
  tags: { slug: string; title: string; blurb: string | null; n: number }[];
  /** A pool, not a screenful: each reader's window is sliced out of it at render time. Empty with -chatter. */
  chat?: ChatLine[];
  /** The Sloptrawler's log, or null with -chart. */
  sea?: { last_run: number | null; cursor: number; lane: number; hauled: number } | null;
}

/** `chat` is the reader's own window into data.chat, sliced per request by the route (chatFor). */
export const Rail: FC<{ data: RailData; chat?: ChatWindow | null }> = ({ data, chat }) => (
  <aside class="rail">
    <div class="box">
      <figure class="mascot"><Mascot size={180} /><figcaption>Schnitzel · b. 2026-09-10</figcaption></figure>
      <h3>Three steps to get your slop graded</h3>
      <ol class="steps">
        <li><StepIcon n={1} /><span>Commit a <code>slopscore.md</code> to the root of a public GitHub repo.</span></li>
        <li><StepIcon n={2} /><span>Get sniffed out. The crawler finds it, checks the paperwork, and lists it. Votes count from day one.</span></li>
        <li><StepIcon n={3} /><span><em>Optional.</em> Log in and press <strong>Submit</strong> on your repo page to launch it and compete for Slop of the Day.</span></li>
      </ol>
      <pre>{MINIMAL_EXAMPLE.trim()}</pre>
      <p class="muted">That's the whole file. Everything else comes from GitHub. <a href="/spec">Full spec</a> · impatient? <code>curl /ping/you/repo</code></p>
      <p class="muted">Slopbuckets to pick from: {SAMPLE_BUCKETS.map((b) => <a href={`/b/${b}`} class="chip">{b}</a>)} <a href="/b">or invent one</a>.</p>
    </div>
    <div class="box">
      <h3>For agents</h3>
      <ul>
        <li><a href="/llms.txt">llms.txt</a> — how this site works</li>
        <li><a href="/openapi.json">openapi.json</a> · <a href="/api/v1/repos">/api/v1</a></li>
        <li><a href="/mcp">MCP server</a> at <code>/mcp</code></li>
        <li>Append <code>.json</code> or <code>.md</code> to any page</li>
        <li>Write access for agents: <a href="/auth/device">device login</a> → bearer token</li>
      </ul>
    </div>
    {data.tools.length ? (
      <div class="box">
        <h3>Built with <a href="/tools" class="muted">(all)</a></h3>
        <table class="stats">
          {data.tools.slice(0, 5).map((t) => (
            <tr><td><a href={`/f/built_with/${t.value}`}>{t.value}</a></td><td>{t.n} · avg {t.mean.toFixed(1)}</td></tr>
          ))}
        </table>
      </div>
    ) : null}
    <div class="box">
      <h3>Numbers</h3>
      <table class="stats">
        <tr><td>listed slop</td><td>{data.stats.listed}</td></tr>
        <tr><td><a href="/queue">in the trough</a></td><td>{data.stats.queued}</td></tr>
        <tr><td>slopsmiths</td><td>{data.stats.users}</td></tr>
        <tr><td>votes</td><td>{data.stats.votes}</td></tr>
        <tr><td>comments</td><td>{data.stats.comments}</td></tr>
      </table>
      <p class="muted"><a href="/stats">more stats</a> · <a href="/log">mod log</a> · <a href="/balcony">balcony</a></p>
    </div>
    {/* Atmosphere, so it sits under the numbers rather than over them. Both boxes are behind their own
        flag; with one retracted the other still stands on its own. */}
    {flagOn("chatter") ? (chat?.lines.length ? <BalconyChat chat={chat} /> : <QuietBalcony />) : null}
    {flagOn("chart") && data.sea ? <SeaChart sea={data.sea} /> : null}
    <div class="box manifesto">
      <h3>Why public?</h3>
      <p>{SITE.manifesto}</p>
    </div>
  </aside>
);
