// The Balcony: the critics' votes in public, the way /log puts moderation in public.
//
// Same job as the mod log — what was decided, when, and why — in the voice of two old hecklers in a
// theatre box. The critics sit up here on purpose: they can shout at the stage, they can never walk onto
// it. Every quip is a small model's sentence about a stranger's README, cleaned by criticQuip() in
// src/lib/critics.ts and escaped by this template.
import type { FC } from "hono/jsx";
import { criticById, criticQuip, criticShortName, type Critic } from "../lib/critics";
import { ago, isoDateTime } from "../lib/time";

export interface Heckle {
  critic_id: number;
  upvote: number;
  reason: string | null;
  created_at: number;
  full_name: string;
  title: string | null;
}

export interface Seat {
  critic: Critic;
  reviewed: number;
  upvoted: number;
  last_at: number | null;
}

/** The verdict in the critics' own terms: they only ever clap or sit on their hands. */
export const verdictText = (upvote: number) => (upvote ? "clapped for" : "sat on its hands for");

/** The box seats: who is up there, what each is listening for, and how often they've clapped. */
export const BoxSeats: FC<{ seats: Seat[]; on: string | null }> = ({ seats, on }) => (
  <div class="boxseats">
    {seats.map((s) => {
      const here = on === s.critic.login;
      return (
        <div class={`seat${here ? " on" : ""}`}>
          <a class="seatname" href={here ? "/balcony" : `/balcony?critic=${s.critic.login}`}>{criticShortName(s.critic)}</a>
          <span class="muted small"> · <a href={`/u/${s.critic.login}`}>{s.critic.login}</a></span>
          <div class="tally">
            <strong>{s.upvoted}</strong> clapped of <strong>{s.reviewed}</strong> heard
            {s.last_at ? <span class="muted"> · last {ago(s.last_at)}</span> : <span class="muted"> · hasn't spoken yet</span>}
          </div>
          <p class="muted small rubric">{s.critic.rubric}</p>
        </div>
      );
    })}
  </div>
);

/** One heckle per review, newest first. A quip the cleaner swallowed shows as no comment, not as nothing. */
export interface RepoVerdict { critic_id: number; upvote: number; reason: string | null; created_at: number }

/**
 * The critics' verdicts on one repo, on that repo's page.
 *
 * Deliberately not comments. A comment count is a trust signal and these are not people, so they get their own
 * block above the thread and are never counted in it. Claps are quoted; a pass is disclosed by name but its
 * sentence is not reproduced here. Nothing is hidden by that — every reason, including every pass, is on
 * /balcony, one link away — but a small model's sentence about why it declined somebody's project does not
 * need to sit under that project. Rendering nothing at all when no critic has read the repo yet.
 */
export const FromTheBalcony: FC<{ rows: RepoVerdict[] }> = ({ rows }) => {
  if (!rows.length) return null;
  const clapped = rows.filter((v) => v.upvote === 1);
  const passed = rows.filter((v) => v.upvote !== 1).map((v) => criticById(v.critic_id)).filter((c): c is Critic => Boolean(c));
  const names = passed.map(criticShortName);
  const passLine = names.length === 1 ? `${names[0]} read it and passed`
    : names.length ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} read it and passed` : "";
  return (
    <section class="balconybox">
      <h3>From the balcony <span class="muted">· {clapped.length} of {rows.length} clapped</span></h3>
      <ol class="heckles">
        {clapped.map((v) => {
          const c = criticById(v.critic_id);
          const quip = criticQuip(v.reason);
          if (!c) return null;
          return (
            <li class="heckle up">
              <div class="heckleline">
                <a class="heckler" href={`/balcony?critic=${c.login}`} title={c.rubric}>{criticShortName(c)}</a>
                <span class="verdict">clapped</span>
                <time class="muted small when" datetime={isoDateTime(v.created_at)} title={isoDateTime(v.created_at)}>{ago(v.created_at)}</time>
              </div>
              {quip ? <blockquote class="quip">{quip}</blockquote> : <blockquote class="quip muted">no comment on the record</blockquote>}
            </li>
          );
        })}
      </ol>
      {passLine ? <p class="muted small">{passLine}. <a href="/balcony">Their reasons are on the balcony</a>, with every other verdict.</p> : null}
      <p class="muted small">Critics are accounts on this site with no GitHub account behind them. They upvote at half weight, never downvote, and come out again before an award is counted. <a href="/balcony">Who they are</a>.</p>
    </section>
  );
};

/**
 * Who the voices in the box actually are. It sits at the bottom of /balcony on purpose: the verdicts come
 * first and the story comes after, so nobody has to read a cast list to use the page. The last line is the
 * part that matters, and it is not decoration — everyone here is a row in a table with no GitHub account
 * behind it, and saying so next to the flavour is what keeps the flavour honest.
 */
export const LORE: { name: string; what: string }[] = [
  {
    name: "Cap'm Slop",
    what: "Master of the Sloptrawler and proprietor of the house. He hauls orphans in and he reads the paperwork before he reads the code. Claps for a README that says plainly what the thing does, how to run it, and which model wrote it. Has never been impressed by a pitch and never will be.",
  },
  {
    name: "The Sloptrawler",
    what: "His ship. She drags a wide net through public water for repos whose owners have already said, in their own words, that a machine made them. She is slow, she is indiscriminate about tonnage, and anything hauled aboard by mistake can be put back over the side from its own page without so much as an account.",
  },
  {
    name: "Schnitzel",
    what: "The pig who runs the trough, and the only one here who is genuinely pleased to see you. Claps for things that are fun, weird, playful or delightful: games, toys, art, silly bots, anything with a screenshot that makes you smile. Polish bores him. He is very thorough about the paperwork and he has never once been thanked for it.",
  },
  {
    name: "Princess, the Gruel Mistress",
    what: "Fair, not warm. She decides what is fit to serve, which means she wants a demo, run instructions, a licence, and a declared status past 'idea'. If it looks abandoned, or it wants secrets you would have to trust it with, it does not get a ladle.",
  },
  {
    name: "The Inspector",
    what: "Checks the plumbing while everyone else is eating. Dependency advisories, where the data goes, how many credentials the thing asks for before it does anything. Says almost nothing. When he claps, it means the pipes are sound, which is rarer than it ought to be.",
  },
];

export const Lore: FC = () => (
  <section class="lore">
    <h3>Who is up there</h3>
    <ul class="rules">
      {LORE.map((l) => <li><strong>{l.name}.</strong> {l.what}</li>)}
    </ul>
    <p class="muted small">
      All five are rows in a table on this site and nothing else. None of them has a GitHub account, none of them
      ever will, and a critic's login contains a dot, which a GitHub login cannot — so one can never be mistaken
      for a person. They upvote at half weight, never downvote, never comment on a repo, and are subtracted
      before an award is counted. The quips are a small model's own sentences, with links and handles stripped.
      That is the whole of the cast and the whole of what it can do.
    </p>
  </section>
);

export const Heckles: FC<{ rows: Heckle[] }> = ({ rows }) => (
  <ol class="heckles">
    {rows.map((h) => {
      const c = criticById(h.critic_id);
      const quip = criticQuip(h.reason);
      return (
        <li class={`heckle ${h.upvote ? "up" : "pass"}`}>
          <div class="heckleline">
            <a class="heckler" href={`/balcony?critic=${c?.login ?? ""}`}>{c ? criticShortName(c) : `critic ${h.critic_id}`}</a>
            <span class="verdict">{verdictText(h.upvote)}</span>
            <a class="subject" href={`/r/${h.full_name}`}>{h.full_name}</a>
            <time class="muted small when" datetime={isoDateTime(h.created_at)} title={isoDateTime(h.created_at)}>{ago(h.created_at)}</time>
          </div>
          {quip
            ? <blockquote class="quip">{quip}</blockquote>
            : <blockquote class="quip muted">no comment on the record</blockquote>}
        </li>
      );
    })}
  </ol>
);
