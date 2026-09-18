// The manifesto. People keep asking what the site wants, and the leaderboard does not look like it wants
// anything. This is the answer in the owner's own voice: a label on every kind of AI-made media, so a
// reader can pick how much machine they are comfortable with instead of answering one binary question.
//
// It is a prose page in the /disclosure shape: a markdown string, three formats, no database. /schemas is
// the directory it points at; /disclosure and /label/fiction are the two labels that exist today.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { Layout } from "../views/layout";
import { respond } from "../lib/negotiate";
import { renderMarkdown } from "../lib/markdown";

export const manifesto = new Hono<AppEnv>();

const md = (origin: string) => `# What I actually want

People keep asking. Fair. The site is called SlopScore and it has a pig on it, so it doesn't look like it wants anything.

## I want a label on the box.

Every argument about AI-made media right now is a binary. Made with AI or not. Real or slop. In or out. That isn't a standard. It's a mob with one question, and it makes honest people lie.

Everyone who shipped the binary has already walked it back. Meta stamped "Made with AI" on real photos that had touched a retouching tool and renamed it "AI info" six weeks later. Amazon makes authors tick "AI-generated" or not, then shows the reader nothing. The music industry looked at a yes/no flag, rejected it, and wrote five fields instead, and Spotify now prints them in the credits. The Oscars didn't ban the tools. They asked for a list of what the tools did.

Food solved this decades ago. Nobody bans sugar. There's a panel on the back that says how much is in there, and you decide if you want it. Movies did it with ratings. Finance did it with disclosures. You can read a nutrition label in three seconds and you never have to trust the company that printed it, because the format doesn't leave room to be vague.

I want that panel on everything a model helped make. Code. Books. Films. Music. Podcasts. Textbooks. Legal filings. Not "AI or not." What it did, and how deep.

## Why me.

I'm not rich and I'm not famous. I'm a developer at a mid-sized company who reads the discourse at lunch. No lobby, no lab, no grant. What I have is some common-sense ideas and a domain name, and I think that's how standards actually start. Somebody prints the first label. Other people copy it because copying is easier than arguing.

There's a second thing the label does, and it's the one I care about most. Right now the only way a thing gets found is to already be inside the circle: the right timeline, the right Discord, the right three people retweeting you. A label is a handle anybody can grab. Say what your thing is and what made it, in a format a crawler can read, and you can be found by people who've never heard of you and never will hear of you from the in-group. That's what the leaderboard is. Not a prize. A shelf you can put your thing on without asking anyone's permission.

I'm running SlopScore because I want a seat at that table. If the labels get designed by regulators alone, they'll fit a compliance department and nobody else. If the platforms design them, they'll fit the platforms. I'd like one that fits a person with a weekend and a thing they made.

## Where it starts.

Software, because I know software and it's a small room. A repo either has a \`slopscore.md\` or it doesn't. Six lines: what wrote it, how much a person touched it, what's inside, who it's for. Declared, not detected. The leaderboard is the bribe that gets people to write the file. [Read the disclosure page.](${origin}/disclosure)

Then books. Before this site existed I built the AI Nutrition Label for fiction: six tiers on the back jacket, from Human-made to AI-authored, over an ingredient panel that says whether a model brainstormed, drafted, rewrote, or just fixed the spelling. It lives here now, next to the code label, because it's the same idea in a second format. No store prints it yet. It's a format looking for a shelf, and I'd rather say that than pretend. [Try it on a book.](${origin}/label/fiction/)

## Where it goes.

One panel per medium, all in one place, all free, all self-reported. Some of the ingredient lists already exist and I'm not going to rewrite them. Music has its five fields. Film has the Academy's form. The Linux kernel has a line per commit. Research has a contribution statement. What none of them have is the part a person reads in three seconds on the back of the box: the tier up top, the panel underneath. That's the piece I'm building, and I'll map each of theirs into it. [The directory is here.](${origin}/schemas)

I'm a C2PA member, for what it's worth, and I'll say the quiet part: their format proves a file wasn't altered, and most platforms strip it on upload anyway. It's for tools. It was never the words on the box.

Education and legal don't have a list yet. Was the lesson written or generated, and did anyone who knows the subject read it? Which drafts did a model touch, because a judge is going to ask anyway? I'll draft the ones I understand. For the rest I want people who work in those fields to write the first version and put it here, under a license anyone can copy.

## The rules I won't bend.

- Self-reported, always. A declaration you can check beats a detector you can't. A wrong guess in public is an accusation.
- It says what the machine did, never that it didn't. A "no AI" stamp is worth lying for, so people lie for it. A panel that says "the model fixed the spelling" isn't worth lying about. Nobody wins anything.
- Small enough to fill in. If a label needs a compliance team, it's for companies, not people.
- Specific words. "Assisted" means one thing. "Generated" means another. "Edited" is a third. One label and a lot of yelling is what we have now.
- Nobody gets shamed for using the tools. The line isn't between people who use them and people who don't. It's between people who tell you and people who don't.
- No enforcement body. Lie on your own label and the label is worthless. Nothing else breaks.
- Open. The schemas are public, the site is open source, fork the format if you want.

## What I'm asking.

- If you make things, put the label on. The file if you write code, the jacket if you write books.
- If you run a venue, a course, a publisher, a festival: ask for the label. It's one line on the entry form. [Here's the one for courses and hackathons.](${origin}/campus)
- If you work in a medium I don't, write the panel and send it. I'll host it.
- If you're a platform or a regulator drawing this up right now: there's a person here who did it the small way first, and I'd like to talk.

**tl;dr:** banning AI from anything is a fight we already lost. Labeling is the one worth winning. I want a nutrition panel on every kind of AI-made media so people can pick what they're comfortable with. Code first, because that's my kitchen. Books second, because that label already exists. The rest as fast as people who know those fields help. Self-reported, small, specific, open. That's the whole thing.

Nick Tantillo · [lumpdepot.com](https://lumpdepot.com)
`;

manifesto.get("/why", (c) => c.redirect("/manifesto", 302));

manifesto.get("/manifesto", (c) => {
  const user = c.get("user"); const url = new URL(c.req.url); const origin = url.origin;
  const text = md(origin);
  return respond(c, { text, origin }, {
    json: (d) => ({
      title: "What I actually want",
      thesis: "A label on the box: a self-reported panel on every kind of AI-made media, so a reader can pick how much machine they are comfortable with.",
      labels: { software: `${d.origin}/disclosure`, fiction: `${d.origin}/label/fiction/`, directory: `${d.origin}/schemas`, venues: `${d.origin}/campus` },
      rules: ["self-reported, always", "says what the machine did, never that it didn't", "small enough to fill in", "specific words", "nobody shamed for using the tools", "no enforcement body", "open"],
      text: d.text,
    }),
    md: (d) => d.text,
    html: (d) => (
      <Layout
        meta={{
          title: "What I actually want — SlopScore",
          description: "The manifesto. A nutrition panel on every kind of AI-made media, self-reported and small enough to fill in, so people can pick how much machine they are comfortable with. Code first, books second, the rest as the people who know those fields help.",
        }}
        user={user}
        url={url}
      >
        <section class="wrap narrow orphanage" style="padding:0">
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(d.text) }} />
        </section>
      </Layout>
    ),
  });
});
