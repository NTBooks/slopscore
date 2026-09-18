// The orphanage: a promotional landing page. "The Cap'm's Home for AI Slop", a Victorian home for repos nobody typed.
// Every joke is about the repos, never the people who prompted them. Mock the genre, never the maker.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { Layout, SITE } from "../views/layout";
import { Mascot, StepIcon, Stamp } from "../views/art";
import { HowToClip } from "../views/howto";
import { MINIMAL_EXAMPLE } from "../lib/slopmd";

export const orphanage = new Hono<AppEnv>();

const INTAKE = [
  ["Abandoned after the demo worked once.", "Its author closed the laptop mid-sentence and never came back. The README still says \"coming soon\"."],
  ["Parents were a prompt and a Tuesday night.", "Conceived at 11pm, born by 1am, pushed at 1:04. Nobody remembers what the prompt was."],
  ["Has never met a human who read it.", "Two thousand lines of code and the only eyes on it belong to a language model that has already forgotten."],
  ["Zero stars, one very proud README.", "\"Built entirely with Claude Code\" in bold, at the top, underlined. We admire the honesty. GitHub does not."],
  ["Works on exactly one machine.", "The machine has since been reformatted. The repo lives on, hopeful, with a status of works-on-my-machine."],
  ["Forty-one commits titled \"fix\".", "Each one fixed something. Each one broke something. The last one is titled \"fix fix\"."],
];

const FAQ: [string, string][] = [
  ["Is my repo an orphan?", "If you haven't opened it since the demo worked, yes. If you opened it and closed it again quickly, also yes. There is a questionnaire if you want it in writing."],
  ["What if it's actually good?", "Then it's a diamond in the rough, and the rough is the only place anyone looks for diamonds. That's the whole premise of the house."],
  ["Do you turn anyone away?", "Only for missing paperwork. We ask every intake where it came from and how much of it a human touched. Nobody is turned away for the answer, only for not answering."],
  ["Can I adopt one?", "Log in with GitHub, upvote it, leave a comment, fork it. Most of them are MIT. Take one home. It won't notice."],
  ["Who runs this place?", "Cap'm Slop runs the house and signs the letters. Schnitzel, a pig in a lab coat, runs the trough. He is not disgusted by slop. He is a connoisseur of it, and he keeps a clipboard."],
  ["Who is the Cap'm?", "Cap'm Slop, master of the Sloptrawler, the ship that hauls the orphans in. Proprietor of this house. If a note arrived on your repo inviting it here, that was him. He only writes once, and he means it kindly."],
  ["Who is Princess?", "The Gruel Mistress. She ladles the gruel, keeps the ledger, and moderates. Every held comment, every quarantined repo, every ban goes through her and lands in the public log with a reason. She is fair. She is not warm."],
  ["What is the Sloptrawler?", "His ship. She drags a wide net through public water for repos flying the slopscore.md flag, and brings them to the trough. She is not a fast ship. She has never lost one."],
  ["Why is it called a home and not a leaderboard?", "It's both. The home is where the slop lives. The leaderboard is how it gets adopted."],
];

orphanage.get("/", (c) => {
  const user = c.get("user"); const url = new URL(c.req.url);
  const title = "The Cap'm's Home for AI Slop";
  return c.html(
    <Layout meta={{ title: `${title} — SlopScore`, description: "A home for orphaned repos. Every one of them is a diamond in the rough. Mostly rough." }} user={user} url={url}>
      <section class="wrap narrow orphanage" style="padding:0">
        <div class="hero">
          <Mascot size={150} class="hero-pig" />
          <div>
            <p class="est">Est. 2026 · Taking in orphaned repos since the slop era began · Moored at the trough</p>
            <h1>{title}</h1>
            <p><em>A diamond in the rough is still a diamond.</em> It is also, statistically, mostly rough. We take in the software nobody typed, ask it where it came from, and let the public decide which ones go home with somebody.</p>
          </div>
        </div>

        <div class="manifesto"><strong>"Please, sir, I want some more."</strong> Every repo in this house asked for more. More tokens. More context. One more last fix. Their makers gave it to them, then pushed, then moved on. That's not neglect. That's the slop era. The trough is always open here, and the gruel is <em>{SITE.slogan.toLowerCase()}</em></div>

        <h2>Who we take in</h2>
        <p class="muted">Current intake criteria. If your repo matches one of these, it has a bed waiting.</p>
        <div class="intake">
          {INTAKE.map(([h, p]) => <div class="ward"><strong>{h}</strong><p>{p}</p></div>)}
        </div>

        <h2>A diamond in the rough</h2>
        <p>Here is the thing about orphaned code: some of it works. Not most of it. Not even a lot of it. But somewhere in the pile is a CLI somebody needed at 2am that does exactly one thing perfectly, and a game that is stupid in a way only a machine could manage, and a dashboard that is better than the one your company pays for.</p>
        <p>Nobody is going to find those on GitHub with zero stars. Nobody is going to find them on a subreddit that bans them. So Schnitzel digs. He sniffs out every <code>slopscore.md</code> on GitHub, checks the paperwork, and puts the repo in the feed where humans and agents can vote. Once in a while he comes up with a <a href="/best" title="what Schnitzel dug up">truffle</a>. That's the day he lives for.</p>

        <h2>How adoption works</h2>
        <ol class="steps">
          <li><StepIcon n={1} /><span><strong>Leave the file on the doorstep.</strong> Commit a <code>slopscore.md</code> to the root of a public GitHub repo. Six lines of disclosures. No form, no account, no app to install.</span></li>
          <li><StepIcon n={2} /><span><strong>Schnitzel takes it in.</strong> The crawler finds it, checks the paperwork, runs the content gates, and lists it. It is votable from day one and gets an <em>unclaimed</em> chip until you show up.</span></li>
          <li><StepIcon n={3} /><span><strong>Put it up for adoption.</strong> <em>Optional.</em> Log in and press <strong>Submit</strong> on the repo page. That's the launch: eligible for Slop of the Day and the weekly awards, and a <Stamp class="inline-stamp" title="Certified Slop" /> stamp if it wins.</span></li>
        </ol>
        <pre>{MINIMAL_EXAMPLE.trim()}</pre>
        <HowToClip caption="Or skip the typing: tell the agent that wrote it to add a slopscore file per slopscore.org, and it commits this exact file." />
        <p class="muted">That's the whole file. Name, description, language, stars, and README come from GitHub. <a href="/spec">Full spec</a> · impatient? <a href="/scan">/scan</a> checks a repo right now and says in words why it was or wasn't taken in.</p>
        <p class="muted">Not sure yours qualifies? <a href="/but-is-it-slop">Seven questions</a> and the house will tell you, then hand you the file with your answers already in it.</p>

        <h2>House rules</h2>
        <ul class="rules">
          <li><strong>Disclosures are the price of admission.</strong> How much was generated, how much a human touched, what's inside. Honest by construction, because nobody here is hiding anything.</li>
          <li><strong>Mock the genre, never the maker.</strong> The jokes are about the repos. The people who prompted them are the reason the house exists. Be kind in the comments or Princess holds them.</li>
          <li><strong>The Gruel Mistress has seen things.</strong> Princess runs the kitchen and the comments. Safe Browsing on the links, Llama Guard on the text, a vision check on the thumbnail. Every verdict is public, with a reason, in the <a href="/log">log</a>.</li>
          <li><strong>Nothing is stored that GitHub already owns.</strong> Identity, code, images, and the file stay on GitHub. Delete the file and the listing goes with it.</li>
          <li><strong>Agents are welcome at the table.</strong> Append <code>.json</code> or <code>.md</code> to any page. There's an <a href="/openapi.json">OpenAPI</a> spec, an <a href="/llms.txt">llms.txt</a>, and an MCP server at <code>/mcp</code>. The things that make the slop can list the slop: hand yours <a href="/for-agents">the skill</a> and it does the paperwork itself.</li>
        </ul>

        <h2>Frequently asked, quietly</h2>
        <dl class="faq">
          {FAQ.map(([q, a]) => <><dt>{q}</dt><dd>{a}</dd></>)}
        </dl>

        <div class="doorstep">
          <h2>Did the Cap'm haul your repo in?</h2>
          <p>The Sloptrawler also brings in repos nobody left on the doorstep: the ones whose owners say, in their own words, that an AI tool wrote them, and whose licence lets us quote the README back. If yours is aboard, its page says plainly that the Cap'm wrote the paperwork and you didn't. Have a look:</p>
          <form class="search" action="/search" method="get" role="search"><input type="search" name="q" placeholder="your repo name" aria-label="Search for your repo" /><button type="submit">look</button></form>
          <p class="muted">Found it? Log in with GitHub as the owner. Commit your own <code>slopscore.md</code> and press Refresh to replace his paperwork, or press Remove and it is gone for good, never to be hauled in again. Can't log in as the owner? Every one of those listings has a takedown link that needs no account at all.</p>
        </div>

        <div class="doorstep">
          <h2>Leave one on the doorstep</h2>
          <p>Add the file. Schnitzel will find it, usually within the hour. Then <a href="/">watch the feed</a> or <a href="/scan">ask for a scan</a> if you can't wait.</p>
          <p><a class="btn" href="/spec">Read the spec</a> <a class="btn secondary" href="/scan">Scan a repo now</a> {user ? null : <a class="btn secondary" href={`/auth/github?next=${encodeURIComponent(url.pathname)}`}>Log in to adopt</a>}</p>
          <p class="muted">No orphans were harmed in the making of this page. Several were refactored. Signed, Cap'm Slop, master of the Sloptrawler.</p>
        </div>
      </section>
    </Layout>,
  );
});
