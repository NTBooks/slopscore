// The disclosure angle. Everything else on this site is a leaderboard with a joke on top; this page is the
// serious reading of the same file. `slopscore.md` is an AI-provenance disclosure: the author's own statement
// about what wrote the code, how much a human touched it, and what is inside. The leaderboard is what makes
// anybody bother to write one.
//
// Why it has its own page: "where do I post my vibe-coded repo" is a question with six answers already, and
// "how do I declare that AI wrote this" has none that a person with a weekend project will actually do. That
// second question is the one an agent gets asked, so it is the one worth ranking for.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { Layout } from "../views/layout";
import { respond } from "../lib/negotiate";
import { renderMarkdown } from "../lib/markdown";
import { MINIMAL_EXAMPLE } from "../lib/slopmd";
import { SPEC_VERSION } from "../lib/vocab";

export const disclosure = new Hono<AppEnv>();

const REQUIRED: [string, string][] = [
  ["ai_generated", "entirely, mostly, partly or none. How much of this code came out of a model."],
  ["human_touch", "none, light or heavy. How much a person edited what came out."],
  ["content_rating", "everyone. Anything above that is not listed here."],
  ["contains", "the things a reader should know are in the box before they run it: crypto, financial, medical, legal, scraping, security-research, gambling-sim. May be empty, never omitted."],
  ["category", "what kind of software this is, from a fixed list of about thirty."],
  ["status", "idea, prototype, works-on-my-machine, alpha, beta, stable, maintained, abandoned. The honest one is usually the third."],
];

const OPTIONAL: [string, string][] = [
  ["built_with", "the tool that wrote it: claude-code, cursor, copilot, codex, gemini-cli, windsurf, aider, cline, chatgpt, lovable, bolt, v0, replit."],
  ["models", "the model, if you know it. Free text, because the list changes monthly."],
  ["data", "none, local-only, sends-telemetry, needs-api-key, stores-pii, scrapes. What it does with data that is not yours."],
  ["needs", "the external accounts and keys somebody has to bring."],
];

const md = (origin: string) => `# AI disclosure, in six lines

Software should say when a machine wrote it. Nearly everybody agrees on that now. The disagreement is about
paperwork.

The standards that exist are built for organisations. CycloneDX and SPDX can both carry AI metadata in a bill
of materials. [C2PA](https://c2pa.org) has an AI disclosure assertion and the cryptography to make it
tamper-evident. The [EU AI Act's Article 50](https://artificialintelligenceact.eu) and California's SB 942 both
want disclosure of AI-generated content in a form a machine can read. All of that is real, and all of it
assumes a build pipeline, a signing key and somebody whose job is compliance.

None of it is a thing one person with a weekend project is ever going to do.

So most AI-generated software says nothing at all. Not because the author is hiding it. Because the smallest
available way to say it was still too big.

## The file

\`slopscore.md\`, at the root of the repo, on the default branch:

\`\`\`yaml
${MINIMAL_EXAMPLE.trim()}
\`\`\`

That is the whole thing. Name, description, topics, language, licence, stars and the README come from
GitHub's API, so the file never repeats them. It holds only what GitHub cannot tell anyone.

## What it declares

${REQUIRED.map(([k, v]) => `- **\`${k}\`** — ${v}`).join("\n")}

Optional, and worth adding:

${OPTIONAL.map(([k, v]) => `- **\`${k}\`** — ${v}`).join("\n")}

Full contract at [${origin}/spec.md](${origin}/spec.md), spec version ${SPEC_VERSION}. The controlled
vocabularies are machine-readable at [${origin}/api/v1/vocab](${origin}/api/v1/vocab). The parser is MIT and
lives in the repo, so nothing here needs our permission or our uptime.

## Declared, not detected

This is the author's own statement. It is not a detector and it will never be one.

Detectors guess, and they guess badly in both directions. The published attempts at measuring how much of
open source is agent-written disagree with each other by more than an order of magnitude, because commit
trailers, bot accounts and config files each catch a different slice and miss the rest. A wrong guess in
public is an accusation, and an accusation about somebody's work is the one thing this site refuses to make.

A declaration has the opposite failure mode. If somebody lies in their own \`slopscore.md\`, the file is
worthless and nothing else breaks. If somebody tells the truth, it is the only reliable provenance signal a
repository can carry, because the person who ran the model is the only one who actually knows.

The other reason it works: for a great many of these repos, the thing filling in the form is the same thing
that wrote the code. It knows the answers better than the human does.

## You can use it without us

The file is a file. It does something useful sitting in a repo that nobody ever crawls: it tells the next
person who opens the project what they are looking at, in a shape their tools can read.

If you also want the leaderboard, we find the file on our own and list the repo. If you stop wanting it,
delete the file and the listing goes with it on the next check. There is no account in between.

- [${origin}/spec](${origin}/spec) — the full contract
- [${origin}/skill.md](${origin}/skill.md) — hand this to the agent that wrote the code and it does the rest
- [${origin}/scan](${origin}/scan) — check a repo now and get told in words what is wrong with the paperwork
`;

disclosure.get("/disclosure", (c) => {
  const user = c.get("user"); const url = new URL(c.req.url); const origin = url.origin;
  const text = md(origin);
  return respond(c, { text, origin }, {
    json: (d) => ({
      title: "AI disclosure, in six lines",
      file: "slopscore.md",
      spec_version: SPEC_VERSION,
      spec: `${d.origin}/spec.md`,
      vocab: `${d.origin}/api/v1/vocab`,
      required: Object.fromEntries(REQUIRED),
      optional: Object.fromEntries(OPTIONAL),
      declared_not_detected: true,
      text: d.text,
    }),
    md: (d) => d.text,
    html: (d) => (
      <Layout
        meta={{
          title: "AI disclosure, in six lines — SlopScupper",
          description: "slopscore.md is an AI-provenance disclosure small enough that one person with a weekend project will actually commit it. What wrote the code, how much a human touched it, what is inside.",
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
