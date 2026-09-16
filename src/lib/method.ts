// How the numbers on this site are made — frozen, versioned, and published before the numbers are.
//
// /trends and every Trawl Report are counts, and a count is worth exactly as much as the rule that decided
// what got counted. That rule lives here. The point of writing it down is not tidiness: it is that an argument
// about a chart should be an argument about a published method, which anyone can read and attack, rather than
// an argument about whether we are honest, which nobody can settle.
//
// Two rules keep it from rotting:
//
//   1. Anything the crawler already knows is read off the crawler, not retyped. The star window, the licence
//      list, the search grounds and the judge's two enums all come from lib/virtual.ts and lib/judge.ts, so
//      loosening a filter rewrites this page instead of leaving it quietly lying.
//   2. It is versioned and never edited in place. A rule change bumps METHOD_VERSION and adds a line to
//      CHANGES with the date and what changed. Reports stamp the version they were written under, so a number
//      quoted from an old report can still be read against the method that produced it.
//
// The section that matters most is "Known biases". Everything in it is a limitation we could have left out and
// nobody would have noticed for a year. It is first-class here because the first person to notice one of them
// on our behalf, in public, would be right — and would be believed over anything we said afterwards.
import { MIN_STARS, MAX_STARS, PERMISSIVE, PUSHED_WITHIN_DAYS, TRAWL_GROUNDS } from "./virtual";
import { JUDGE_CODES, JUDGE_DOMAINS } from "./judge";
import { CHART_FACETS, TRENDS_KEEP_DAYS } from "../jobs/trends";

/** Bump when a rule below changes, and add a CHANGES line in the same commit. Reports stamp this. */
export const METHOD_VERSION = 2;

/** Every version, newest first. The history is the point: a method nobody can diff is a method nobody can check. */
export const CHANGES: { version: number; date: string; what: string }[] = [
  {
    version: 2,
    date: "2026-09-16",
    what: "Two tools join the claim gate, the topic map and the built_with vocabulary: Meta's Muse Code (also written Muse Spark or Meta AI, one key: muse-code) and Roo Code (roo). A seventh search ground, Muse Bank, works the Muse phrases and topics; Roo joins Copilot Reach. Repos naming either tool were previously thrown back as having no claim, so the population widens and nothing already counted changes. Cline and Roo are both discontinued products; repos that credit them still count, because the claim is about who wrote the code, not whether the shop is still open.",
  },
  {
    version: 1,
    date: "2026-09-14",
    what: "First freeze. Writes down what the trawl was already doing: the six search grounds, the star and push windows, the licence filter, the judge's two closed questions, and the split between counted and judged numbers. No rule changed in order to publish this.",
  },
];

/** The date the current version was frozen. */
export const METHOD_FROZEN = CHANGES[0].date;

/** Codes the judge can give that mean "this is software somebody made", and so get the repo listed. */
export const LISTABLE_CODES = ["app", "game", "tool", "library", "hardware"] as const;

/** The machine-readable half. The same facts as the prose, in the shape an agent would rather have them. */
export function methodJson() {
  return {
    method_version: METHOD_VERSION,
    frozen: METHOD_FROZEN,
    population: "public GitHub repositories whose owner states in public, in the past tense, that an AI tool wrote the code",
    not_the_population: "AI-written software. Most of it carries no such statement and is invisible to this or any other method.",
    cohorts: {
      trawl: "found by our search. Nothing was selected for beyond the filters below, so within the labelled population it is close to random.",
      opted: "the owner committed a slopscore.md. Self-selected.",
    },
    trawl_filters: {
      stars: [MIN_STARS, MAX_STARS],
      pushed_within_days: PUSHED_WITHIN_DAYS,
      licenses: [...PERMISSIVE],
      excluded: ["forks", "archived", "templates", "private", "org-owned"],
      grounds: TRAWL_GROUNDS.map((g) => ({ name: g.name, looks_for: g.blurb, queries: g.queries })),
    },
    judge: {
      what: "one cheap model, two multiple-choice questions, temperature 0",
      decides_listing: "code",
      decides_nothing: "domain",
      listable_codes: [...LISTABLE_CODES],
      codes: [...JUDGE_CODES],
      domains: [...JUDGE_DOMAINS],
      may_write_prose: false,
    },
    counted: CHART_FACETS.filter((f) => f !== "domain"),
    judged: ["verdict", "use"],
    snapshot: { cadence: "daily at 00:05 UTC", kept_days: TRENDS_KEEP_DAYS, model_calls: 0 },
    known_biases: [
      "the label is the sample: we measure what people say about their code, not what wrote it",
      "tool share is query-shaped: the grounds are named after tools, so a tool whose users do not tag or describe their repos is undercounted",
      "permissive licences only",
      "the star window's two ends are our rule, not a finding",
      "the opted-in cohort is self-selected",
      "cross-sections are stock, not flow: a takedown leaves no trace in them",
    ],
    not_claimed: ["code quality", "security assessment", "any ranking of one tool's output against another's", "statistical significance"],
    corrections: "/contact",
  };
}

/** The prose half. Rendered at /method, and pointed at by every report's footer. */
export function methodMd(): string {
  const licences = [...PERMISSIVE].join(", ");
  const grounds = TRAWL_GROUNDS.map((g) => `- **${g.name}** — ${g.blurb}. Searches: ${g.queries.map((q) => `\`${q}\``).join(", ")}`);
  const thrown = JUDGE_CODES.filter((c) => !(LISTABLE_CODES as readonly string[]).includes(c));
  return [
    "# How we count", "",
    `**Method v${METHOD_VERSION}, frozen ${METHOD_FROZEN}.** Every chart on [/trends](/trends) and every number in [the Trawl Report](/report) is produced by the rules below. They were written down before the numbers, they are versioned, and they are never edited in place: a rule change bumps the version and leaves a dated line at the bottom of this page. Reports stamp the version they were written under.`, "",
    "Machine-readable: [/method.json](/method.json). The code behind every rule here is public: `src/lib/virtual.ts` picks the sample, `src/lib/judge.ts` is the judge, `src/jobs/trends.ts` does the counting, `src/jobs/report.ts` writes the weekly bulletin.", "",

    "## The one sentence that matters", "",
    "This site measures **software whose author says in public that an AI tool wrote it.** It does not measure AI-written software. Those are different populations and the gap between them is enormous and unknowable: most generated code carries no such statement, and the statement is the only thing anybody can see from outside. Every number here inherits that. If you quote one, quote it with that sentence attached.", "",

    "## Two samples, never mixed", "",
    "- **Trawled.** The Cap'm found the repo. Its owner never asked to be here and mostly did not know the site existed. Nothing was selected for beyond the filters in the next section, so *within the labelled population* this is about as close to a random sample as anyone gets.",
    "- **Opted in.** The owner committed a `slopscore.md`. That is a person choosing to file paperwork about their own work, which is self-selection with a capital S. This cohort describes people who volunteer. It is also the only cohort that can answer a question a human had to answer personally — how much of it a model wrote, how much they went back over — because nobody else knows.", "",
    "The two are counted separately and drawn in separate columns everywhere. A number that merges them is not a number from this site.", "",

    "## How the trawl picks", "",
    `${TRAWL_GROUNDS.length} search grounds, worked in rotation. Each is a handful of GitHub searches:`, "",
    ...grounds, "",
    "Every result is then filtered on facts from the search response alone, before anything is read and before any model is paid:", "",
    `- ${MIN_STARS.toLocaleString("en-US")} to ${MAX_STARS.toLocaleString("en-US")} stars`,
    `- pushed within the last ${PUSHED_WITHIN_DAYS} days`,
    "- not a fork, not archived, not a template, not private",
    `- a licence permissive enough to quote from: ${licences}`,
    "- not owned by an organisation — a repo nobody can personally claim is a repo nobody can personally take down",
    "- the description or topics carry a **past-tense** claim that a tool wrote the code. \"Built with Cursor\" counts. \"An IDE for vibe coding\" does not.", "",
    "What survives goes to the judge.", "",

    "## The judge", "",
    "One cheap model, temperature 0, two multiple-choice questions, and nothing else. It cannot write a sentence that reaches this site.", "",
    `- **code** decides whether the repo is listed. ${LISTABLE_CODES.map((c) => `\`${c}\``).join(", ")} are listed; ${thrown.map((c) => `\`${c}\``).join(", ")} are thrown back.`,
    `- **domain** decides nothing at all. It is what the software is *for*, off a closed list of ${JUDGE_DOMAINS.length}, and it is kept only to be counted.`, "",
    "Both answers are validated against those closed lists and anything else is discarded. The verdict is stored for every candidate the judge sees — the ones listed **and** the larger number thrown back. That second half is the most useful thing this site has, and it is the half a leaderboard normally throws away.", "",

    "## Counted, and judged", "",
    "Almost everything on /trends is **counted**: a `GROUP BY` over rows some earlier job already wrote. Languages, licences, stars, topics, which tool gets the credit, what the net threw back. No model is called to draw the dashboard — not one token.", "",
    "Exactly two charts are **judged**: what the software is *for*, and what kind of thing it is. Those count the model's labels rather than a maker's. They are marked as such where they appear, here, and in every report. They are the only numbers on this site that are somebody's opinion.", "",

    "## Known biases — read these before quoting a number", "",
    "1. **The label is the sample.** Restating the sentence above, because it is the one people drop. We see repos whose owners announced the tool. Announcing is a behaviour, and it varies by tool, by community, by how new the tool is, and by whether announcing is currently fashionable.",
    "2. **Tool share here is query-shaped.** The grounds above are *named after tools*. A tool with a popular `built-with-x` topic will out-count a tool whose users never tag anything, whatever people actually use. Tool share on this site measures **how loudly a tool's users say its name in public**, and nothing else. It is not market share, it is not usage, and quoting it as either is wrong.",
    "3. **Permissive licences only.** We read repos we could quote from. Anything GPL or unlicensed is invisible here, and that filters the *kind* of project as much as the licence.",
    "4. **The star window's ends are our rule.** The first and last bars of the star chart are where we stopped looking, not where the world stops.",
    "5. **The opted-in cohort is self-selected** and small. Read it as \"people who volunteer\", never as \"makers\".",
    "6. **Cross-sections are stock, not flow.** Anything without a month on it counts what is listed *tonight*. A repo taken down, delisted or archived leaves no trace in it, so the past quietly changes shape as the present does.",
    `7. **The sample is young.** Snapshots are kept for ${TRENDS_KEEP_DAYS} days and the site is younger than that. Week-over-week movement on a small n is mostly noise, and the reports say so rather than dressing it up as a trend.`, "",

    "## What this site does not claim", "",
    "- **Nothing about code quality.** Nobody here runs the code. A listing is not a review, and a score is a popularity count on a joke leaderboard.",
    "- **Nothing about security.** The dependency check on a repo page reports what a public advisory database already says about that repo's dependencies. That is not an audit.",
    "- **No ranking of one tool's output against another's.** Read bias 2 again. A repo crediting a tool is a statement its owner made, not a judgement of the tool.",
    "- **No statistical significance.** These are counts of a convenience sample. There are no p-values here and there will not be any.", "",

    "## Reproducing any of it", "",
    "- [/trends.json](/trends.json) is tonight's snapshot in full.",
    "- Every report keeps the numbers it was written from: `/report/<week>.json`.",
    "- The snapshot job runs once a night at 00:05 UTC and replaces the day rather than appending to it, so re-running it is safe and lands on the same rows.", "",

    "## Corrections", "",
    "If a number here is wrong, say so on the [contact form](/contact). Corrections are published as a line in the next report and, where the method itself was wrong, as a new version below. Nothing is quietly edited.", "",

    "## Changes to this method", "",
    ...CHANGES.map((c) => `- **v${c.version}** · ${c.date} — ${c.what}`),
  ].join("\n");
}
