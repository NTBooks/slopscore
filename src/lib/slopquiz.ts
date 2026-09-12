// "But is it slop though?" — the questionnaire behind /but-is-it-slop.
//
// Seven questions, four answers each, and every honest path lands on yes. That is the joke and it is
// also the argument: "slop" here is a declaration, not a grade. The cruellest tier is the top one,
// where somebody typed every line by hand and still cannot prove it to a stranger — which is exactly
// what the file is for.
//
// Everything in here is pure. The route renders it, and draftFile() is run through the site's own
// parseSlopMd() in test/slopquiz.test.ts, so this page can never hand somebody a file the crawler
// would turn away.
//
// House rule, same as the orphanage: mock the genre, never the maker. Every note below is about a repo.
import { AI_GENERATED, HUMAN_TOUCH, STATUS, SPEC_URL, SPEC_VERSION } from "./vocab";

export interface QuizOption {
  /** What the answer says. */
  label: string;
  /** 0 = artisanal, 3 = the trough. */
  weight: 0 | 1 | 2 | 3;
  /** The Cap'm's note in the margin, shown beside the answer on the verdict. */
  note: string;
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: [QuizOption, QuizOption, QuizOption, QuizOption];
}

export const QUESTIONS: QuizQuestion[] = [
  {
    id: "wrote",
    prompt: "Did you write any of the code yourself?",
    options: [
      { label: "Every line of it.", weight: 0, note: "Typed. By a person. In 2026. Write it down before it becomes folklore." },
      { label: "Most of it.", weight: 1, note: "“Most” is a word that does an enormous amount of work in a disclosure." },
      { label: "Some of it. The hard parts.", weight: 2, note: "You did the hard parts. Something else did the other nine tenths." },
      { label: "I wrote the prompt.", weight: 3, note: "That is authorship of a kind. It is not the kind that turns up in a diff." },
    ],
  },
  {
    id: "read",
    prompt: "Did you read it?",
    options: [
      { label: "All of it.", weight: 0, note: "Then you are one of about forty people. Say so in the file; nobody will guess." },
      { label: "The parts that broke.", weight: 1, note: "Which is to say, the parts that announced themselves." },
      { label: "The first file, then I skimmed.", weight: 2, note: "The first file is always the good one. They know that." },
      { label: "I read the summary the model wrote about the code.", weight: 3, note: "A review of the code, by the author of the code, addressed to you." },
    ],
  },
  {
    id: "language",
    prompt: "Do you know the language it's written in?",
    options: [
      { label: "I write it daily.", weight: 0, note: "Then you would have noticed. Probably." },
      { label: "Well enough to read it.", weight: 1, note: "Reading is most of the job now. That counts." },
      { label: "I could pick it out of a lineup.", weight: 2, note: "Semicolons narrow it down less than you would hope." },
      { label: "It has a language?", weight: 3, note: "It has two. One of them is YAML, and YAML is winning." },
    ],
  },
  {
    id: "broke",
    prompt: "It broke. What happened next?",
    options: [
      { label: "I opened a debugger.", weight: 0, note: "A debugger. Like an animal." },
      { label: "I pasted the error back in.", weight: 1, note: "The standard move. It works often enough to become a habit." },
      { label: "I pasted the error back in four times.", weight: 2, note: "The fourth one rewrites the file and the bug moves house." },
      { label: "I started a new chat and asked for the whole thing again.", weight: 3, note: "Arson, as a debugging strategy. Fast, though. Nobody is denying it is fast." },
    ],
  },
  {
    id: "deps",
    prompt: "Where did the dependencies come from?",
    options: [
      { label: "I chose every one.", weight: 0, note: "Then you read at least one changelog, which is rarer than reading the code." },
      { label: "Mostly me.", weight: 1, note: "Mostly." },
      { label: "I found out at install time.", weight: 2, note: "Seven hundred and forty-one packages, and a moment of silence." },
      { label: "There's a lock file. That's the model's department.", weight: 3, note: "The model does not have a department. The lock file is real, though." },
    ],
  },
  {
    id: "speed",
    prompt: "Idea to first push?",
    options: [
      { label: "Weeks.", weight: 0, note: "Weeks. You thought about it first. That used to be the normal amount." },
      { label: "A few days.", weight: 1, note: "A weekend project that took a weekend. Suspiciously honest." },
      { label: "One evening.", weight: 2, note: "Dinner, then a repo." },
      { label: "The idea and the commit have the same timestamp.", weight: 3, note: "Conceived at 11pm, pushed at 11:04. Schnitzel has a bed made up." },
    ],
  },
  {
    id: "ran",
    prompt: "Has anyone else run it?",
    options: [
      { label: "It's in production.", weight: 0, note: "Somebody is paying for this. That changes the stakes, not the answer." },
      { label: "A few people.", weight: 1, note: "A few people is a user base. Write the file before one of them asks." },
      { label: "One friend, briefly.", weight: 2, note: "They said “neat” and closed the tab. That was the launch." },
      { label: "It works on the machine where it was born.", weight: 3, note: "status: works-on-my-machine is in the spec for you specifically." },
    ],
  },
];

/** Seven questions at three points each. Nobody scores this and feels good about it, which is the point. */
export const MAX_POINTS = QUESTIONS.reduce((n, q) => n + Math.max(...q.options.map((o) => o.weight)), 0);

/** One chosen option index (0-3) per question, in QUESTIONS order. */
export type Answers = number[];

export interface Tier {
  /** Inclusive point range. The ranges tile 0..MAX_POINTS with no gaps; tierFor() relies on it. */
  min: number;
  max: number;
  name: string;
  /** The one-liner that becomes og:description on a shared verdict. */
  share: string;
  /** The verdict itself, one paragraph per entry. */
  verdict: string[];
}

export const TIERS: Tier[] = [
  {
    min: 0,
    max: 3,
    name: "Hand-typed, and nobody believes you",
    share: "Typed by a human, every line, and completely unprovable. Which is what the file is for.",
    verdict: [
      "You typed it. Near enough every line, and you will still be able to read it in six months. That is the rarest answer this page gets, and you should be smug about it for roughly one more paragraph.",
      "Here is the bad news: nobody can tell. Not a reviewer, not a hiring manager, not the person choosing between your library and a generated one at two in the morning. From the outside your repo looks exactly like the several million that say “vibe coded” in the README, because from the outside every repo looks like every other repo.",
      "The only way to say “a human wrote this” and have it mean anything is to say it on purpose, in writing, in the same six lines everybody else uses. ai_generated: none is a perfectly legal value. Almost nobody uses it. That is not a problem, that is an opening.",
    ],
  },
  {
    min: 4,
    max: 8,
    name: "Assisted, and honest about it",
    share: "A model wrote some of it, you wrote the rest, and you know which is which.",
    verdict: [
      "A model wrote some of it. You wrote the rest. You know which is which, and if somebody pointed at a function you could say where it came from. This is the modal repo of 2026 and there is nothing whatsoever wrong with it.",
      "The only thing missing is the sentence saying so. Right now that knowledge lives in your head, which is a lovely place for it and a terrible place for anybody else to look.",
      "Two lines of frontmatter and it lives in the repo instead. Same claim, same honesty, no conversation required.",
    ],
  },
  {
    min: 9,
    max: 13,
    name: "Prompt-raised",
    share: "You did not type it. You raised it. That is supervision, and supervision is a real job.",
    verdict: [
      "You did not type this. You raised it. You read the diffs, you pushed back on the stupid ones, you fixed what it broke on the way through, and at some point it stopped being a demo and started being a thing.",
      "That is supervision, and supervision is real work that nobody has a decent word for yet. “I vibe coded it” undersells what you actually did. “I wrote it” oversells it. Both are bad sentences, and everyone has been stuck picking between them.",
      "The file splits the difference on purpose: how much was generated, and how hard a human leaned on it, declared separately. Say partly and heavy and you have described your afternoon exactly.",
    ],
  },
  {
    min: 14,
    max: 18,
    name: "Certified slop",
    share: "Yes. It's slop. That is a category here, not an insult.",
    verdict: [
      "Yes. It's slop. Take a breath, because that is a category on this site and not an insult: Schnitzel is a connoisseur of the stuff, not a critic of it, and he has never once found the slop lacking.",
      "Somewhere in a pile like yours is a CLI that does one thing perfectly at 2am, and a game that is stupid in a way only a machine could manage. Nobody finds those by browsing GitHub with zero stars, so they get found here or they do not get found.",
      "The price of admission is the paperwork, not the pedigree. Declare what made it and how much of a human went in, and the repo is listable, votable, and on a good day a truffle.",
    ],
  },
  {
    min: 19,
    max: MAX_POINTS,
    name: "Grade A, prime cut, inspected slop",
    share: "You did not write software. You commissioned it. There is a leaderboard for that.",
    verdict: [
      "You did not write software. You commissioned it, at speed, from something that never once asked a clarifying question, and it exists. Which is more than can be said for the version you were going to hand-write over the next four weekends.",
      "This is not the part where the page tells you off. The whole site is built out of repos that answered the way you just did, and the one hosting this questionnaire is one of them. We are all in the trough. The gruel is fine.",
      "The one thing that separates a listing from a landfill is whether the file says so out loud. entirely and light are not confessions, they are metadata. Put the draft below in the root of the repo and you are done.",
    ],
  },
];

export function tierFor(points: number): Tier {
  return TIERS.find((t) => points >= t.min && points <= t.max) ?? TIERS[TIERS.length - 1];
}

export interface Score {
  points: number;
  max: number;
  /** 0-100, rounded, for the strip on the verdict. */
  pct: number;
  tier: Tier;
}

export function scoreAnswers(a: Answers): Score {
  const points = QUESTIONS.reduce((n, q, i) => n + q.options[a[i]].weight, 0);
  return { points, max: MAX_POINTS, pct: Math.round((points / MAX_POINTS) * 100), tier: tierFor(points) };
}

// ---- the URL ----
//
// One digit per question, in order: /but-is-it-slop?a=3120213. Short enough to paste into a reply, and
// obvious enough that somebody will edit it by hand, which is fine: it is validated on the way in and
// there is nothing behind it to break.

export function encodeAnswers(a: Answers): string {
  return a.join("");
}

/** Strict on purpose: a wrong length or a stray character means the questions again, not a clamped verdict. */
export function decodeAnswers(s: string | null | undefined): Answers | null {
  if (!s || s.length !== QUESTIONS.length) return null;
  const out: Answers = [];
  for (const ch of s) {
    const n = ch.charCodeAt(0) - 48;
    if (n < 0 || n > 3) return null;
    out.push(n);
  }
  return out;
}

/** The no-JS form submits q1..qN as radios. Returns null unless every one of them is present and sane. */
export function answersFromFields(get: (name: string) => string | undefined | null): Answers | null {
  const out: Answers = [];
  for (let i = 0; i < QUESTIONS.length; i++) {
    const raw = get(`q${i + 1}`);
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0 || n > 3) return null;
    out.push(n);
  }
  return out;
}

// ---- the draft file ----
//
// The punchline and the call to action are the same object: a slopscore.md built out of the answers
// just given. Every value comes from lib/vocab rather than a string typed here, so the draft cannot
// drift from the spec the crawler enforces.

const AI_BY_WROTE: Record<number, (typeof AI_GENERATED)[number]> = { 0: "none", 1: "partly", 2: "mostly", 3: "entirely" };
const STATUS_BY_RAN: Record<number, (typeof STATUS)[number]> = { 0: "stable", 1: "beta", 2: "prototype", 3: "works-on-my-machine" };

/** How hard a human leaned on it. Reading it and debugging it are the two places that shows. */
function humanTouch(a: Answers): (typeof HUMAN_TOUCH)[number] {
  const wrote = a[0], read = a[1], broke = a[3];
  if (wrote === 0) return "heavy";
  const effort = (3 - read) + (3 - broke);
  if (effort >= 4) return "heavy";
  if (effort >= 2) return "light";
  return "none";
}

/**
 * A valid slopscore.md, pre-filled from the answers. category and built_with are the two things this
 * page cannot know, so they stay obvious placeholders with the vocabulary beside them rather than
 * being guessed wrong and pasted into somebody's repo.
 */
export function draftFile(a: Answers): string {
  const ai = AI_BY_WROTE[a[0]];
  const touch = humanTouch(a);
  const status = STATUS_BY_RAN[a[6]];
  const lines = [
    "---",
    `slopscore: ${SPEC_VERSION}`,
    `spec: ${SPEC_URL}`,
    `ai_generated: ${ai}`,
    `human_touch: ${touch}`,
    "content_rating: everyone",
    "contains: []",
    "category: [other]         # swap in the real one: cli, web-app, game, devtools, library, bot…",
    `status: ${status}`,
  ];
  // Nobody who typed every line of it wants to be filed under vibe-coded, so that suggestion is for
  // the drafts where it is actually true.
  if (ai === "none") {
    lines.push("slopbucket: []            # optional: pick one at /b, or invent one");
  } else {
    lines.push("built_with: [other]       # claude-code, cursor, copilot, codex, chatgpt…");
    lines.push("slopbucket: [vibe-coded]  # optional: pick another at /b, or invent one");
  }
  lines.push("---", "");
  return lines.join("\n");
}
