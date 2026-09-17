// What every word on the Trawl Report means, in one line each.
//
// The bulletin prints keys, not sentences: "tool-for-ai-coding", "claude", "a licence we cannot quote from". Each
// one is a rule somewhere else in this codebase — the judge's prompt, the trawl's filters, the built_with
// vocabulary — and a reader should not have to find that file to know what the bar is measuring. So this is
// one flat dictionary from the key as printed to what it means, read by the page through a small "?" beside
// every key and criterion. It explains; it never changes what was counted.
//
// Frozen bulletins print the label that was current when they were written, so a label that has since been
// reworded keeps its old spelling here too: the old week still gets its explanation.
import { JUDGE_CODES } from "./judge";
import { BUILT_WITH } from "./vocab";
import { MAX_STARS, MIN_STARS, PUSHED_WITHIN_DAYS } from "./virtual";

const LISTABLE = "One of the five verdicts that gets a repo listed.";
const THROWN = "A verdict that throws the candidate back.";

/** The judge's codes: what the small model said the repo *is*. */
const VERDICTS: Record<(typeof JUDGE_CODES)[number], string> = {
  app: `The judge's verdict: an application somebody made for a purpose. ${LISTABLE}`,
  game: `The judge's verdict: a game. ${LISTABLE}`,
  tool: `The judge's verdict: a tool, a utility, a script somebody made to do a job. ${LISTABLE}`,
  library: `The judge's verdict: a library or package for other code to use. ${LISTABLE}`,
  hardware: `The judge's verdict: software with hardware attached, such as firmware or a device. ${LISTABLE}`,
  "tool-for-ai-coding": `${THROWN} Its users are people coding with AI: agent frameworks, rules and prompt packs, skills, editor add-ons, MCP servers for coding agents, usage dashboards. A tool for vibe coders is not vibe-coded software.`,
  "list-or-template": `${THROWN} An awesome list, guide, tutorial, course, template, boilerplate, starter kit or dotfiles. Not software somebody made.`,
  "needs-disclosure": `${THROWN} It involves crypto or trading, financial, medical or legal advice, scraping personal data, security or exploit tooling, weapons, gambling, adult content or strong language, and the Cap'm's paperwork cannot make those disclosures on an owner's behalf.`,
  "low-effort": `${THROWN} A stub, a placeholder or a homework dump with no real README.`,
  "not-ai-made": `${THROWN} The AI claim the trawl found was not about how this project's code was written.`,
  unclear: `${THROWN} The judge could not tell, or the repo tried to instruct it. It fails closed.`,
};

/** The built_with vocabulary: which tool the owner credited. */
const TOOLS: Record<(typeof BUILT_WITH)[number], string> = {
  "claude-code": "Anthropic's Claude Code, the terminal agent. Counted apart from plain Claude.",
  claude: "Claude used through the app, the API or an editor, where the owner did not say Claude Code.",
  cursor: "Cursor, the AI editor.",
  copilot: "GitHub Copilot, in any of its modes.",
  codex: "OpenAI's Codex coding agent.",
  "gemini-cli": "Google's Gemini CLI.",
  windsurf: "Windsurf, the AI editor.",
  aider: "Aider, the open-source terminal pair programmer.",
  cline: "Cline, the open-source editor agent. Discontinued; repos that credit it still count, because the claim is about who wrote the code.",
  roo: "Roo Code, a fork of Cline. Discontinued; repos that credit it still count.",
  chatgpt: "ChatGPT: code written in a chat and pasted in, rather than by an agent working in the repo.",
  lovable: "Lovable, the prompt-to-app builder.",
  bolt: "Bolt, StackBlitz's prompt-to-app builder.",
  v0: "v0, Vercel's prompt-to-UI builder.",
  replit: "Replit's agent.",
  "muse-code": "Meta's Muse Code, also written Muse Spark or Meta AI.",
  other: "A tool the owner named that is not on the built_with list.",
};

/** The net's buckets: the first rule a trawled candidate failed, in the words jobs/trends.ts prints. */
const NET: Record<string, string> = {
  "a licence we cannot quote from": "The licence is not on the permissive list (MIT, Apache-2.0, BSD, ISC, 0BSD, Unlicense, CC0), or there is none. The Cap'm's paperwork quotes the README, so the trawl lists only what it is allowed to quote.",
  "never claims a model wrote it": "Nothing in the description or README says, in the past tense, that an AI tool wrote this. That claim is the whole population; without it the repo is not in it.",
  "owned by an org, so nobody could claim or remove it": "The owner is an organisation, not a person. Claiming, editing and removing a trawled listing all work by logging in as the repo's owner, and nobody can log in as an org.",
  "owned by an org, so nobody can claim it": "The owner is an organisation, not a person. Claiming, editing and removing a trawled listing all work by logging in as the repo's owner, and nobody can log in as an org.",
  "writing about vibe coding, not vibe-coded": "By its own name or description, a list, guide or prompt pack about vibe coding, or a tool for vibe coding. Not software somebody vibe coded.",
  "a tool for people coding with AI": VERDICTS["tool-for-ai-coding"],
  "a list, guide or template": VERDICTS["list-or-template"],
  "needs disclosures it does not make": VERDICTS["needs-disclosure"],
  "a stub with no real README": VERDICTS["low-effort"],
  "the claim was not about this code": VERDICTS["not-ai-made"],
  "the judge could not tell": VERDICTS.unclear,
  "tripped the denylist": "Matched the site's denylist of prohibited terms or links. Recorded, so the trawl never looks at it again.",
  "outside the star window": `Fewer than ${MIN_STARS} or more than ${MAX_STARS} stars. Both ends are our rule, not a finding: the window is where nobody has heard of a repo yet and nobody has already written it up.`,
  "not touched in 90 days": `No push in the last ${PUSHED_WITHIN_DAYS} days. The trawl samples what people are making now, not what they made once.`,
  "no description to quote": "The repo has no description. The Cap'm's paperwork quotes it, so an empty one leaves nothing to say.",
  "already known here": "Already listed, queued, rejected or removed here, so the trawl did not look twice.",
  "something else": "A reason too rare to earn a bucket of its own.",
};

/** The criteria: the words the masthead, the captions and the section headings count in. */
const CRITERIA: Record<string, string> = {
  listed: "Every repo on the site right now, trawled and opted in together.",
  trawled: "Found by the Cap'm's search of public GitHub. Nobody submitted these: the owner said in public that a model wrote the code, and the trawl took them at their word. Within that label it is close to a random sample.",
  "opted in": "The owner committed a slopscore.md to the repo and asked to be counted. Self-selected, so a fact about volunteers.",
  "the judge has seen": "Everything the trawl paid a small model to sort: what it let through and what it threw back, one population. A model's label from a closed list, and the only judged number in the bulletin.",
  "candidates judged": "Everything the trawl paid a small model to sort: what it let through and what it threw back, one population. A model's label from a closed list, and the only judged number in the bulletin.",
  "software somebody made": "The five listable verdicts together, app, game, tool, library and hardware, as a share of everything the judge saw.",
  "thrown back": "Everything the judge looked at and did not let through, every reason folded together.",
  credits: "A credit is one repo naming one tool. A repo that names two tools gives two credits, so shares here are of credits, not of repos.",
  "language credits": "GitHub lists every language a repo uses, up to eight here, and each one is a credit. Shares are of credits, not of repos, so one repo can count more than once.",
  "candidates thrown back in 30 days": "Everything the trawl looked at in the last 30 days and did not list, by the first rule it failed. The window rolls, so week-to-week movement is the mix of reasons shifting, not one week's intake.",
  "share points": "The gap between this week's share and last week's, in percentage points. A section that grew moves every count; share points show who gained ground and who gave it up.",
};

export const GLOSSARY: Readonly<Record<string, string>> = { ...VERDICTS, ...TOOLS, ...NET, ...CRITERIA };

/** What a key means, or null when the page has nothing to add. Keys are matched as printed, case-insensitively. */
export function explain(key: string): string | null {
  return GLOSSARY[key] ?? GLOSSARY[key.trim().toLowerCase()] ?? null;
}
