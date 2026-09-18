// The page for courses, hackathons and student groups. Every team already gets asked what the AI did and
// what they did; the answer dies with the event. This page says: keep it with the code, and here is a page
// per event that reads it. No new machinery: a slopbucket is already a leaderboard per anything, created on
// first use, so an event is a bucket name and one line on whatever form the organiser already runs.
//
// No hackathon platform is named here. SlopScore is affiliated with none of them, and the file lives in the
// repo, not the form, which is the whole argument.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { Layout } from "../views/layout";
import { respond } from "../lib/negotiate";
import { renderMarkdown } from "../lib/markdown";
import { MINIMAL_EXAMPLE } from "../lib/slopmd";
import { HowToClip } from "../views/howto";

export const campus = new Hono<AppEnv>();

const EXAMPLE = MINIMAL_EXAMPLE
  .replace("slopbucket: [cli]            # optional: pick a bucket or invent one", "slopbucket: [your-event-2026]   # the event, course or school: one line, and the page exists\nmaintainers: [teammate1, teammate2]   # GitHub logins; everyone on the team gets owner controls");

const md = (origin: string, contact: string) => `# For courses, hackathons and student groups

Every team gets asked what the AI did and what they did. On a submission form, in a judging rubric, or out loud at the demo. Then the event ends, that answer stays wherever it was collected, and the repo goes on without it.

One of those repos is the next real product. Nobody can tell which, because they're never lined up anywhere with that answer attached.

## What listing does

The same answer, kept with the code as a six-line file: what the AI did, what the humans did, which event, who. A page for your event or course at \`${origin}/b/{your-event}\` that reads those files and shows what students actually built, next to every other event's projects, and keeps updating as the repos grow. Attribution that exists before anyone needs it.

It works whether submissions come through a hackathon platform, a form, or a repository link, because the file lives in the repo, not the form.

## How, in one paste

The short way: tell the agent that wrote the code, *"add a slopscore file per slopscore.org"*. It reads [${origin}/skill.md](${origin}/skill.md) and commits the file. The long way is the same six lines by hand, at the root of the public repo:

\`\`\`
${EXAMPLE.trim()}
\`\`\`

The crawler finds it within the hour and lists the project in the bucket. Not sure what to put? [Seven questions](${origin}/but-is-it-slop) and it drafts the file for you.

<!--howto-->

## For the organiser

1. Pick a bucket name before the event: \`hackrumble-2026\`, \`cs-3400-fall\`, \`your-school\`. Short, lowercase, hyphens. Nothing to register; the bucket exists the moment the first file names it.
2. Put one line wherever you collect submissions: *"Add a \`slopscore.md\` to your repo with \`slopbucket: [your-bucket]\`."*
3. Tell us the name and the dates, and a moderator gives the bucket a title and a blurb so the page says what it is.

That's the whole job. The school owes nothing, signs nothing, and installs nothing. If a course wants its own page and a hackathon wants another, use two bucket names; a repo can carry up to three.

## Running a contest

A contest is a bucket with a deadline. Projects that land in it before the closing date are the field; the bucket page is the standings. Ranking on this site is public and the rules behind it are [published](${origin}/method): votes from logged-in people, weighted by account trust, plus the site's own critics at half weight, which never pick winners. Organisers judge however they like on top of that; the page is the shortlist, not the verdict.

Ask about a contest and we'll set the bucket up with the dates on it and a line that says who's running it and what the prize is.

## What it costs

Nothing. No accounts for students, no forms, nothing to install. The site is open source. Delete the file and the listing goes with it on the next check.

## What stays out

Private repos (the crawler can only read public ones). Repos without a licence. Anything that fails the content gates: the [rules](${origin}/about) are public and every rejection has a public reason. Nothing here is graded by a detector; the file is the ticket in, and what it says is up to the team.

## Say hello

Running an event or teaching a course? Write to [${contact}](mailto:${contact}) with the bucket name and the dates, or use the [contact form](${origin}/contact). If you want the longer answer to "why", it's in the [manifesto](${origin}/manifesto).
`;

campus.get("/hackathons", (c) => c.redirect("/campus", 302));

campus.get("/campus", (c) => {
  const user = c.get("user"); const url = new URL(c.req.url); const origin = url.origin;
  const contact = c.env.CONTACT_EMAIL ?? "hello@slopscore.org";
  const text = md(origin, contact);
  return respond(c, { text, origin, contact }, {
    json: (d) => ({
      title: "For courses, hackathons and student groups",
      how: "commit slopscore.md with slopbucket: [your-event]; the bucket page is /b/{your-event}",
      example: EXAMPLE,
      skill: `${d.origin}/skill.md`,
      contact: d.contact,
      text: d.text.replace("<!--howto-->\n\n", ""),
    }),
    md: (d) => d.text.replace("<!--howto-->", `![Tell your agent: add a slopscore file per slopscore.org. It commits one file.](${d.origin}/media/add-to-slopscore.gif)`),
    html: (d) => (
      <Layout
        meta={{
          title: "For courses and hackathons — SlopScore",
          description: "Every team gets asked what the AI did and what they did, and the answer dies with the event. Keep it with the code: one six-line file per repo, one page per event or course, attribution that exists before anyone needs it.",
        }}
        user={user}
        url={url}
      >
        <section class="wrap narrow orphanage" style="padding:0">
          {(() => { const [before, after] = d.text.split("<!--howto-->"); return <>
            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(before) }} />
            <HowToClip />
            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(after ?? "") }} />
          </>; })()}
        </section>
      </Layout>
    ),
  });
});
