// The directory of labels. One row per medium: the disclosure format that already exists in that field,
// the SlopScore panel for it, and how far along the panel is. Directory first, authoring second: music,
// film and research already wrote their ingredient lists, and this page maps them into the shape a reader
// gets in three seconds (a tier up top, the panel underneath) rather than proposing a rival standard.
//
// Two labels exist today: slopscore.md for software and the AI Nutrition Label for fiction. Everything
// else here is either a mapping onto those shapes or an open invitation.
import { Hono } from "hono";
import type { AppEnv } from "../env";
import { Layout } from "../views/layout";
import { respond } from "../lib/negotiate";
import { renderMarkdown } from "../lib/markdown";
import { SPEC_VERSION } from "../lib/vocab";
import { FICTION_LABEL_VERSION, FICTION_INGREDIENTS, FICTION_TIERS } from "../lib/vocab-fiction";

export const schemas = new Hono<AppEnv>();

type Status = "live" | "drafting" | "mapping" | "open" | "note";

interface Row { medium: string; exists: string; panel: string; status: Status; }

const STATUS_WORDS: Record<Status, string> = {
  live: "live", drafting: "drafting", mapping: "mapping drafted", open: "open: send a panel", note: "note only",
};

const rows = (origin: string): Row[] => [
  {
    medium: "Software, per repo",
    exists: "The Linux kernel's [`Assisted-by:` trailer](https://docs.kernel.org/process/coding-assistants.html), one line per commit naming the agent and model; a [directory of project policies](https://github.com/melissawm/open-source-ai-contribution-policies) from outright bans to disclose-and-welcome.",
    panel: `[\`slopscore.md\` v${SPEC_VERSION}](${origin}/disclosure): six required fields at the root of the repo. [Spec](${origin}/spec) · [vocab](${origin}/api/v1/vocab)`,
    status: "live",
  },
  {
    medium: "Fiction",
    exists: "The Authors Guild's [Human Authored](https://authorsguild.org/human-authored/faq/) mark: yes/no, a registry, ten dollars a title. Amazon KDP's checkbox, which tells Amazon and never the reader.",
    panel: `[AI Nutrition Label v${FICTION_LABEL_VERSION}](${origin}/label/fiction/): ${FICTION_TIERS.length} tiers over ${FICTION_INGREDIENTS.length} ingredients at four levels. [Vocab](${origin}/api/v1/vocab/fiction)`,
    status: "live",
  },
  {
    medium: "Non-fiction",
    exists: "Same as fiction.",
    panel: "AI Nutrition Label, non-fiction edition. Same tiers; the ingredient list swaps story bible and dialog for sourcing, quotation and fact-checking.",
    status: "drafting",
  },
  {
    medium: "Music",
    exists: "[DDEX's AI disclosure](https://dynamoi.com/learn/ai-music-distribution/spotify-ddex-ai-disclosure) in release metadata: vocals, instrumentation, composition, lyrics, post-production, each declared separately. Spotify reads it and prints it in Song Credits.",
    panel: "A mapping of the five DDEX fields onto tier + panel. See below.",
    status: "mapping",
  },
  {
    medium: "Film",
    exists: "The Academy's [rules for the 99th Awards](https://www.hollywoodreporter.com/movies/movie-news/oscars-rules-2027-ai-actors-screenplays-international-1236581862/): a detailed account of generative AI used in script, visual effects and sound, judged by how far a human was at the heart of the authorship.",
    panel: "A mapping of the three areas onto tier + panel. See below.",
    status: "mapping",
  },
  {
    medium: "Research",
    exists: "Contribution statements in the CRediT style: the [AID Framework](https://aidframework.org/), [AI Usage Cards](https://ai-cards.org/), [DAISY](https://arxiv.org/abs/2604.02760). Every major publisher now asks; these are the forms that answer once.",
    panel: "A mapping of a contribution statement onto tier + panel. See below.",
    status: "mapping",
  },
  {
    medium: "Education",
    exists: "Nothing consumer-facing found. Institutions have policies for students; nothing tells a learner what wrote the lesson.",
    panel: "Open. Was the lesson written or generated, and did anyone who knows the subject read it before it shipped?",
    status: "open",
  },
  {
    medium: "Legal",
    exists: "Court standing orders on AI-drafted filings, one court at a time. Nothing a client reads.",
    panel: "Open. Which drafts a model touched, and who checked the citations.",
    status: "open",
  },
  {
    medium: "Provenance, any file",
    exists: "[C2PA Content Credentials](https://c2pa.org): a signed manifest with an actions list and a generative-AI assertion. Proves a file was not altered since signing. Most upload pipelines strip it.",
    panel: "Not a panel. The panel can ride inside a manifest as an assertion: C2PA proves, the panel explains.",
    status: "note",
  },
];

const md = (origin: string) => {
  const r = rows(origin);
  return `# The labels

One panel per medium: a tier a reader gets in three seconds, an ingredient list underneath for anyone who wants the detail. Self-reported, small enough to fill in, and free to copy. [Why](${origin}/manifesto).

Most media already have a disclosure format written by the people who work in them. This page lists those first, then says what the SlopScore panel for that medium is and how far along it is. Where a field has already written its ingredient list, the panel is a mapping onto it, not a replacement.

${r.map((x) => `## ${x.medium}

- **What exists:** ${x.exists}
- **The panel:** ${x.panel}
- **Status:** ${STATUS_WORDS[x.status]}`).join("\n\n")}

## The mappings

Each mapping takes the fields a medium already declares and places them on the two shapes every panel here shares: a **level** per ingredient (none, advisory, applied, generated) and a **tier** from the weighted sum. The weights are the medium's to argue about; the shape is the point.

### Music, from DDEX

| DDEX declares | Panel row | Level it becomes |
|---|---|---|
| AI vocals | Vocal performance | generated |
| AI instrumentation | Instrumental performance | generated |
| AI composition | Melody and harmony | generated |
| AI lyrics | Lyrics | generated |
| AI post-production | Mix and master | applied |

A track with AI mix and master alone lands in the Polished tier. A track with AI vocals and lyrics lands in Co-written or above. That is the same distinction DDEX draws; the panel only makes it legible on a screen.

### Film, from the Academy's account

| The Academy asks about | Panel rows | Levels |
|---|---|---|
| Scriptwriting | Premise and outline · Dialogue · Scene prose | advisory, applied or generated per row |
| Visual effects | Rotoscope and cleanup · Generated shots · Generated performers | applied for tools, generated for shots or performers |
| Sound | Noise reduction and mix · Generated score · Synthetic voice | applied for tools, generated for score or voice |

The Academy's test, how far a human was at the heart of the authorship, is the tier. A film with generated cleanup and a human everything else is Polished. A film with a generated performer is not eligible for their award, and here it is simply AI-authored in that row.

### Research, from a contribution statement

| Statement says AI was used for | Panel row | Level |
|---|---|---|
| Literature search and screening | Research assistance | advisory or applied |
| Coding, annotation, extraction | Analysis | applied |
| Drafting text | Prose | generated |
| Editing and language | Line and copy edit | applied |
| Figures | Figures | generated |

A paper with AI language editing is Polished. A paper with AI-drafted sections is AI-assisted or Co-written, which is exactly what a reader wants to know before deciding how to read the methods.

## License

The panels, vocabularies and mappings on this page are [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Copy them, fork them, put them on your own form. The site's code is MIT.

If you work in a medium that isn't here, or the mapping for yours is wrong, [write in](${origin}/contact). The first version from somebody who does the work beats the tenth from somebody who doesn't.
`;
};

schemas.get("/schemas", (c) => {
  const user = c.get("user"); const url = new URL(c.req.url); const origin = url.origin;
  const r = rows(origin);
  const text = md(origin);
  return respond(c, { text, rows: r, origin }, {
    json: (d) => ({
      title: "The labels",
      license: "CC-BY-4.0",
      manifesto: `${d.origin}/manifesto`,
      media: d.rows.map((x) => ({ medium: x.medium, exists: x.exists, panel: x.panel, status: x.status })),
      vocab: { software: `${d.origin}/api/v1/vocab`, fiction: `${d.origin}/api/v1/vocab/fiction` },
      text: d.text,
    }),
    md: (d) => d.text,
    html: (d) => (
      <Layout
        meta={{
          title: "The labels — SlopScore",
          description: "One disclosure panel per medium: what already exists in software, books, music, film and research, what the SlopScore panel for each is, and how far along it is. Self-reported, small, CC BY.",
        }}
        user={user}
        url={url}
      >
        <section class="wrap narrow orphanage" style="padding:0">
          <h2>The labels</h2>
          <p>One panel per medium: a tier a reader gets in three seconds, an ingredient list underneath for anyone who wants the detail. Self-reported, small enough to fill in, and free to copy. <a href="/manifesto">Why</a>.</p>
          <p>Most media already have a disclosure format written by the people who work in them. This table lists those first, then says what the SlopScore panel for that medium is and how far along it is. Where a field has already written its ingredient list, the panel is a mapping onto it, not a replacement.</p>
          <table class="list schemas">
            <tr><th>medium</th><th>what exists</th><th>the panel</th><th>status</th></tr>
            {d.rows.map((x) => (
              <tr>
                <td><strong>{x.medium}</strong></td>
                <td dangerouslySetInnerHTML={{ __html: renderMarkdown(x.exists).replace(/^<p>|<\/p>$/g, "") }} />
                <td dangerouslySetInnerHTML={{ __html: renderMarkdown(x.panel).replace(/^<p>|<\/p>$/g, "") }} />
                <td><span class={`chip status-${x.status}`}>{STATUS_WORDS[x.status]}</span></td>
              </tr>
            ))}
          </table>
          <div dangerouslySetInnerHTML={{ __html: renderMarkdown(d.text.slice(d.text.indexOf("## The mappings"))).replace(/<p>\|([\s\S]*?)<\/p>/g, (_m, body: string) => mdTable(body)) }} />
        </section>
      </Layout>
    ),
  });
});

/**
 * The site's markdown renderer has no table syntax (comments do not need one), so a pipe table arrives as a
 * paragraph with its rows joined by spaces. This turns that paragraph back into a table: the first row is
 * the header, the `|---|` row is dropped. Cell text has already been through the inline renderer.
 */
function mdTable(body: string): string {
  const rowsText = ("|" + body).split(/\s*\|\s*(?=[^|]*\|)/).filter(Boolean);
  // Split on row boundaries: a row ends with " |" followed by " |" of the next row's first cell.
  const cells: string[][] = [];
  let cur: string[] = [];
  for (const raw of ("|" + body).split("|").map((s) => s.trim())) {
    if (raw === "" ) { if (cur.length) { cells.push(cur); cur = []; } continue; }
    cur.push(raw);
  }
  if (cur.length) cells.push(cur);
  void rowsText;
  const clean = cells.filter((r) => !r.every((c) => /^-+$/.test(c)));
  if (clean.length < 2) return `<p>${body}</p>`;
  const [head, ...rest] = clean;
  return `<table class="list"><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr>${rest.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`;
}
