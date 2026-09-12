// The Balcony: the critics' votes in public, the way /log puts moderation in public.
//
// Same job as the mod log — what was decided, when, and why — in the voice of two old hecklers in a
// theatre box. The critics sit up here on purpose: they can shout at the stage, they can never walk onto
// it. Every quip is a small model's sentence about a stranger's README, cleaned by criticQuip() in
// src/lib/critics.ts and escaped by this template.
import type { FC } from "hono/jsx";
import { raw } from "hono/html";
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
          {/* Decorative: the name it belongs to is the next line, so a second reading of it would be noise. */}
          <img class="mug" src={s.critic.face} alt="" width="160" height="160" loading="lazy" />
          <div class="seatbody">
            <a class="seatname" href={here ? "/balcony" : `/balcony?critic=${s.critic.login}`}>{criticShortName(s.critic)}</a>
            <span class="muted small"> · <a href={`/u/${s.critic.login}`}>{s.critic.login}</a></span>
            <div class="tally">
              <strong>{s.upvoted}</strong> clapped of <strong>{s.reviewed}</strong> heard
              {s.last_at ? <span class="muted"> · last {ago(s.last_at)}</span> : <span class="muted"> · hasn't spoken yet</span>}
            </div>
            <p class="muted small rubric">{s.critic.rubric}</p>
          </div>
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
export interface CastMember {
  name: string;
  /** The job, not the name again: it is the second line on the plate. */
  role: string;
  /** A framed bust from art/plate-*.png, or a crop of the group painting for the one with no plate. */
  art: string;
  alt: string;
  /** True when the name is engraved in the picture itself, so the page must not caption it twice. */
  plated: boolean;
  what: string;
}

export const LORE: CastMember[] = [
  {
    name: "Cap'm Slop",
    role: "Master of the Sloptrawler",
    art: "/cast/plate-capm.webp",
    alt: "Cap'm Slop: a grizzled boar in a battered bicorn hat and salt-stained navy coat, chipped tusks, clay pipe in his teeth.",
    plated: true,
    what: "Master of the Sloptrawler and proprietor of the house. He hauls orphans in and he reads the paperwork before he reads the code. Claps for a README that says plainly what the thing does, how to run it, and which model wrote it. Has never been impressed by a pitch and never will be.",
  },
  {
    name: "Schnitzel",
    role: "The intrepid scientist",
    art: "/cast/plate-schnitzel.webp",
    alt: "Schnitzel, the intrepid scientist: a delighted pink pig in a stained lab coat and striped sailor shirt, brass goggles on his forehead, a test tube of gruel in one hoof.",
    plated: true,
    what: "The pig who runs the trough, and the only one here who is genuinely pleased to see you. Claps for things that are fun, weird, playful or delightful: games, toys, art, silly bots, anything with a screenshot that makes you smile. Polish bores him. He is very thorough about the paperwork and he has never once been thanked for it.",
  },
  {
    name: "Princess",
    role: "The Gruel Mistress",
    art: "/cast/plate-princess.webp",
    alt: "Princess, the Gruel Mistress: a composed sow in a headscarf and gravy-spattered apron, holding an enormous brass ladle upright like a sceptre.",
    plated: true,
    what: "Fair, not warm. She decides what is fit to serve, which means she wants a demo, run instructions, a licence, and a declared status past 'idea'. If it looks abandoned, or it wants secrets you would have to trust it with, it does not get a ladle.",
  },
  {
    name: "Crusoe",
    role: "The Inspector",
    art: "/cast/plate-crusoe.webp",
    alt: "Crusoe, the Inspector: a tall grey heron in a peaked cap and buttoned coat, brass lantern and pipe wrench to hand, eyes half closed.",
    plated: true,
    what: "Checks the plumbing while everyone else is eating. Dependency advisories, where the data goes, how many credentials the thing asks for before it does anything. Says almost nothing. When he claps, it means the pipes are sound, which is rarer than it ought to be.",
  },
  {
    name: "The Sloptrawler",
    role: "His ship, and her net",
    art: "/cast/sloptrawler.jpg",
    alt: "A weather-beaten two-masted trawler at anchor in a turquoise lagoon, her wide net hanging wet from the davits.",
    plated: false,
    what: "His ship. She drags a wide net through public water for repos whose owners have already said, in their own words, that a machine made them. She is slow, she is indiscriminate about tonnage, and anything hauled aboard by mistake can be put back over the side from its own page without so much as an account.",
  },
];

/**
 * The cast: four framed busts, the ship, and the group painting they were all cut out of.
 *
 * The four plates carry their own engraved names (art/plate-*.png), so nothing here captions them a second
 * time — which is exactly why each one needs real alt text rather than an empty one. The ship has no plate of
 * her own and gets an HTML one. The wide shot goes on top because it is the only place the lagoon is legible,
 * and everything is lazy: this sits at the bottom of the page, under every verdict.
 *
 * The closing paragraph is the part that matters and it is not decoration — everyone here is a row in a table
 * with no GitHub account behind it, and saying so under the oil paintings is what keeps the paintings honest.
 */
export const Lore: FC = () => (
  <section class="lore">
    <h3>Who is up there</h3>
    <img
      class="crew"
      src="/cast/crew.jpg"
      alt="The four critics shoulder to shoulder on a tropical beach — the Cap'm, Princess with her ladle, Schnitzel in his goggles and Crusoe the heron — with the Sloptrawler anchored behind them."
      width="1400"
      height="467"
      loading="lazy"
    />
    <ul class="cast">
      {LORE.map((l) => (
        <li class={`member${l.plated ? " plated" : ""}`}>
          {l.plated ? (
            // --art is the same file as the <img>: the overlays use its alpha as their mask, so the foil and
            // the glare stay inside the locket instead of squaring off over the page.
            <div class="locket" style={`--art:url('${l.art}')`}>
              <div class="stack">
                <img class="portrait" src={l.art} alt={l.alt} width="600" height="900" loading="lazy" />
                <span class="foil" aria-hidden="true"></span>
                <span class="glare" aria-hidden="true"></span>
              </div>
            </div>
          ) : (
            <>
              <img class="portrait" src={l.art} alt={l.alt} width="480" height="600" loading="lazy" />
              <div class="plate"><strong>{l.name}</strong><span>{l.role}</span></div>
            </>
          )}
          <p>{l.what}</p>
        </li>
      ))}
    </ul>
    {raw(RELIEF_FILTER)}
    <p class="muted small">
      All five are rows in a table on this site and nothing else. None of them has a GitHub account, none of them
      ever will, and a critic's login contains a dot, which a GitHub login cannot — so one can never be mistaken
      for a person. They upvote at half weight, never downvote, never comment on a repo, and are subtracted
      before an award is counted. The quips are a small model's own sentences, with links and handles stripped.
      That is the whole of the cast and the whole of what it can do.
    </p>
  </section>
);

/**
 * The bump map: /lockets.js moves the point light, CSS turns the filter on only while a locket is hovered.
 *
 * The height field is the picture's own luminance (luminanceToAlpha, then blurred so paint texture does not
 * read as gravel), so the ornate frame, the rope, the wheel and the engraved letters all catch the light as
 * relief while the flat sky and sea stay flat. The specular pass is clipped to the locket's alpha and added
 * back over it, which keeps the transparent paper transparent.
 */
const RELIEF_FILTER = `<svg class="locketdefs" aria-hidden="true" focusable="false" width="0" height="0">
  <filter id="locketRelief" color-interpolation-filters="sRGB">
    <feColorMatrix in="SourceGraphic" type="luminanceToAlpha" result="h"/>
    <feGaussianBlur in="h" stdDeviation="1.1" result="bump"/>
    <feSpecularLighting in="bump" surfaceScale="2.1" specularConstant="0.55" specularExponent="30" lighting-color="#fff4d6" result="spec">
      <fePointLight id="locketLight" x="150" y="120" z="110"/>
    </feSpecularLighting>
    <feComposite in="spec" in2="SourceGraphic" operator="in" result="lit"/>
    <feComposite in="lit" in2="SourceGraphic" operator="arithmetic" k1="0" k2="1" k3="1" k4="0"/>
  </filter>
</svg>`;

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
