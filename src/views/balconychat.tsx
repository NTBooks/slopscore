// The balcony, as a chat in the rail.
//
// A different job from /balcony. That page is the record: every verdict, in order, including the ones
// with nothing quotable in them, because a record with gaps is not one. This is the front door, so it
// carries only lines worth reading and shows each reader ones they have not been shown before.
//
// It is not a live feed and never pretends to be. Every bubble carries the real time its verdict was
// written, and if they were dripped in as though they were landing now the timestamps would give the
// lie away within seconds. What makes it feel alive is that there is genuinely something new in it:
// several hundred verdicts nobody has read, a cast that writes another every quarter of an hour, and a
// window (unseenWindow, src/lib/critics.ts) that walks each reader through them a few at a time.
//
// The one part that is live is the countdown, and it is live because it is knowable: the rota is
// deterministic and the cron is fixed, so the page can say who reads next and when without asking.
import type { FC } from "hono/jsx";
import { CRITIC_SLOT, CRITICS, criticForSlot, criticShortName, inFrenzy, nextSlot, type ChatWindow } from "../lib/critics";
import { ago, isoDateTime, now } from "../lib/time";

/** Who is up next, in words, from facts the page already has. */
function upNext(at: number): { who: string; when: number } {
  const when = nextSlot(at, CRITIC_SLOT);
  return { who: inFrenzy(when) ? "The whole box" : criticShortName(criticForSlot(when, CRITIC_SLOT)), when };
}

export const BalconyChat: FC<{ chat: ChatWindow }> = ({ chat }) => {
  const at = now();
  const next = upNext(at);
  return (
    <div
      class="box balconychat"
      id="balconychat"
      data-now={at}
      data-every={CRITIC_SLOT}
      data-caught={chat.caughtUp ? "1" : ""}
      data-roster={CRITICS.map((c) => c.login).join(",")}
    >
      <h3>The balcony <span class="muted">· <a href="/balcony">all of it</a></span></h3>
      {chat.lines.length ? (
        <ol class="thread">
          {chat.lines.map((l) => (
            <li class={`msg ${l.upvote ? "up" : "pass"}`} data-at={l.at}>
              {/* Decorative: the critic's name is the next element, so reading the face out is noise. */}
              <img class="mug" src={l.face} alt="" width="32" height="32" loading="lazy" />
              <div class="said">
                <a class="who" href={`/balcony?critic=${l.login}`}>{l.short}</a>
                <span class="verdict muted"> {l.upvote ? "clapped" : "passed"}</span>
                <blockquote class="bubble">{l.quip}</blockquote>
                <a class="re" href={`/r/${l.full_name}`}>{l.full_name}</a>
                <time class="when muted" datetime={isoDateTime(l.at)} data-at={l.at} title={isoDateTime(l.at)}>{ago(l.at, at)}</time>
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      <div class="typing" id="ss-typing" data-at={next.when}>
        <i /><i /><i />
        <span class="muted small">
          {chat.caughtUp ? "You have heard the whole box. " : ""}
          {next.who} {next.who === "The whole box" ? "reads" : "reads"} next,{" "}
          <time datetime={isoDateTime(next.when)} data-at={next.when} class="ss-until">{isoDateTime(next.when)}</time>.
        </span>
      </div>
    </div>
  );
};

/** Nothing has been said yet. Better than hiding the box: it tells you when it will fill. */
export const QuietBalcony: FC = () => {
  const next = upNext(now());
  return (
    <div class="box balconychat" id="balconychat">
      <h3>The balcony <span class="muted">· <a href="/balcony">who is up there</a></span></h3>
      <div class="typing">
        <i /><i /><i />
        <span class="muted small">
          The box is quiet. {next.who} takes the stand at{" "}
          <time datetime={isoDateTime(next.when)}>{isoDateTime(next.when)}</time>.
        </span>
      </div>
    </div>
  );
};
