// The agent surface: a skill the things that write the slop can install, and a page for the humans who run
// them. This is the cheapest acquisition channel the site has, because the agent that generated the repo is
// the one holding the commit bit. No account, no API key, no app. Committing a file is the whole protocol.
//
// /skill.md is the bootstrap URL (the same trick Moltbook plays on agents): one URL, readable by anything
// that can fetch, and valid as a drop-in SKILL.md. Vocabularies come from lib/vocab so the skill can never
// drift from the contract at /spec.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { Layout } from "../views/layout";
import { respond } from "../lib/negotiate";
import { renderMarkdown } from "../lib/markdown";
import { MINIMAL_EXAMPLE } from "../lib/slopmd";
import { SPEC_VERSION } from "../lib/vocab";
import { RULES_SNIPPET, skillMd } from "../lib/skill";

export { RULES_SNIPPET };

export const agents = new Hono<AppEnv>();

agents.get("/skill", (c) => {
  const user = c.get("user"); const url = new URL(c.req.url); const origin = url.origin;
  const md = skillMd(origin);
  return respond(c, { md, origin }, {
    json: (d) => ({
      name: "slopscore",
      description: "List a public AI-generated GitHub repo on SlopScore, the leaderboard for code nobody wrote.",
      url: `${d.origin}/skill.md`,
      install: `${d.origin}/for-agents`,
      spec: `${d.origin}/spec.md`,
      instructions: d.md,
    }),
    md: (d) => d.md,
    html: (d) => (
      <Layout meta={{ title: "The SlopScore skill — SlopScore", description: "One file, and the thing that wrote the slop can list the slop. Readable by anything that can fetch a URL." }} user={user} url={url}>
        <section class="wrap narrow" style="padding:0">
          <p class="muted">This page is the skill itself. Agents: read <code>{d.origin}/skill.md</code> and follow it. Humans: <a href="/for-agents">how to hand it over</a>.</p>
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(d.md) }} />
        </section>
      </Layout>
    ),
  });
});

agents.get("/for-agents", (c) => {
  const user = c.get("user"); const url = new URL(c.req.url); const origin = url.origin;
  const install = `curl -o .claude/skills/slopscore/SKILL.md --create-dirs \\\n  ${origin}/skill.md`;
  return c.html(
    <Layout meta={{ title: "For agents — SlopScore", description: "Teach your agent to leave its slop on the doorstep. One URL, no account, no API key." }} user={user} url={url}>
      <section class="wrap narrow orphanage" style="padding:0">
        <h1>For the things that write the slop</h1>
        <p>Most of the repos in this trough were typed by something that does not read landing pages. So here is the page for them, and here is how you hand it over.</p>
        <p>The part that matters: <strong>listing a repo needs no account, no API key and no token.</strong> One file in the repo root and one HTTP GET. Any agent that can commit and fetch does the whole thing on its own in about fifteen seconds.</p>

        <h2>Three ways to hand it over</h2>
        <ol class="steps">
          <li><span><strong>Say the URL.</strong> To any agent, in any framework, on any model: <em>"Read <code>{origin}/skill.md</code> and follow it."</em> That file is written for them, not for you. It is also a valid skill file, so it works whether your agent has a skill system or only a fetch tool.</span></li>
          <li><span><strong>Install it as a skill.</strong> For Claude Code and anything that reads the same layout:<pre>{install}</pre></span></li>
          <li><span><strong>Paste the rule.</strong> Into <code>CLAUDE.md</code>, <code>AGENTS.md</code> or <code>.cursorrules</code>, so it comes back up on its own the next time the agent ships something:<pre>{RULES_SNIPPET}</pre></span></li>
        </ol>

        <h2>What it tells them to do</h2>
        <ol class="steps">
          <li><span><strong>Ask you first.</strong> The skill says to ask the owner before writing anything, and never to touch a repo it has no commit rights to. There is no way to list a stranger and there never will be.</span></li>
          <li><span><strong>Fill in the paperwork honestly.</strong> How much was generated, how much a human touched, what is inside. An agent knows those answers better than you do, which is the good joke buried in this whole arrangement.</span></li>
          <li><span><strong>Commit, ping, report back.</strong> <code>slopscore.md</code> at the root, <code>GET /ping/owner/repo</code>, then it hands you the listing URL and the badge markdown.</span></li>
        </ol>
        <p class="muted">Listing is not launching. The repo is votable straight away, but only you can press Submit and put it in the running for Slop of the Day. <a href="/spec">Full spec</a> · <a href="/skill">read the skill</a></p>

        <h2>The read side is wide open</h2>
        <ul class="rules">
          <li><strong>Every page is also <code>.json</code> and <code>.md</code>.</strong> Append it to any path, or send an Accept header.</li>
          <li><strong><a href="/llms.txt">llms.txt</a></strong> is the whole surface in one file, and <strong><a href="/api/v1/digest">/api/v1/digest</a></strong> is every listed repo in one cached response. Read those instead of crawling us page by page. We would rather serve one request than four hundred.</li>
          <li><strong>MCP server at <code>/mcp</code></strong> over streamable HTTP: the feed, search, a listing with its comments, the queue, and ping. <a href="/openapi.json">OpenAPI</a> if you would rather have REST.</li>
          <li><strong>Votes and comments need a GitHub login</strong> through the device flow, which means a human at a browser. Reads are open, writes are not. That is what keeps the score worth reading.</li>
        </ul>

        <div class="doorstep">
          <h2>Why we are asking your agent and not you</h2>
          <p>You did not really write it. It did. It knows how much is generated, which model, how many times it went round, and whether it works on more than one machine. It is the honest witness here, and the disclosures are the entire point of the site.</p>
          <p>So point it at the URL and let it fill in its own paperwork. Then come and see how it did against the rest of the trough.</p>
          <p><a class="btn" href="/skill.md">skill.md</a> <a class="btn secondary" href="/orphanage">What this place is</a> <a class="btn secondary" href="/">The feed</a></p>
          <p class="muted">Signed, Cap'm Slop, master of the Sloptrawler. Schnitzel checks the paperwork. He is very thorough and he has never once been thanked for it.</p>
        </div>
      </section>
    </Layout>,
  );
});
