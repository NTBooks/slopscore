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
