// The Sloptrawler's chart: a small map of the Slop Triangle in the rail, with the boat somewhere on it.
//
// Drawn here rather than generated into art/*.svg because it is a composed scene, not a picture. The
// ship has to sit in a particular group, on a particular track, with ids public/rail.js can find, and a
// whole-file SVG spliced in with string surgery could not give it any of that. The drawing itself keeps
// to the register in art/icons.py: currentColor, stroke-width 3.5 on a 64 grid, round caps and joins,
// no fills and no filters, so it takes the page's light or dark text colour and needs no palette.
//
// Without JavaScript the picture still has to agree with the caption underneath it, or the chart says
// she is on the grounds while drawing her tied up. So the server puts her at the end of whichever leg
// she is on -- the Trough or the ground, no curve maths needed -- and rail.js refines that to the exact
// point along the course. The two never contradict each other; one is just less precise.
import type { FC } from "hono/jsx";
import { DEEPS, GROUNDS, SHOALS, TROUGH, groundFor, voyage, voyageText, type Ground } from "../lib/sea";
import { TRAWL_QUERIES, groundOfQuery } from "../lib/virtual";
import { isoDateTime } from "../lib/time";
import { now } from "../lib/time";

export interface SeaData {
  last_run: number | null;
  cursor: number;
  lane: number;
  hauled: number;
  /** The day's budget is landed: she is tied up on purpose until the next UTC day. */
  spent: boolean;
  /** How many searches the cursor runs over tonight: the static list plus the registry's (crawl_state trawl:nq). */
  nq: number;
}

/** A course bowed away from the straight line, so seven tracks read as courses rather than a starburst. */
function track(g: Ground): string {
  const mx = (TROUGH.x + g.x) / 2;
  const my = (TROUGH.y + g.y) / 2;
  const dx = g.x - TROUGH.x;
  const dy = g.y - TROUGH.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = 14;
  return `M${TROUGH.x} ${TROUGH.y} Q${(mx + (-dy / len) * bow).toFixed(1)} ${(my + (dx / len) * bow).toFixed(1)} ${g.x} ${g.y}`;
}

/** The Sloptrawler, on her own 64 grid so the register's stroke width survives the placement.
 *  Hung so her waterline, not her middle, sits on the point she is placed at: she floats at a mark
 *  rather than straddling it, and the ground's name underneath stays readable while she is there. */
const Ship: FC<{ working: boolean }> = ({ working }) => (
  <g class="hull">
    <g transform="translate(-17 -33) scale(.6)">
      <path d="M10 44 h44 l-7 11 H17 z" />
      <path d="M14 44 v-6 h36 v6" />
      <path d="M25 38 V11" />
      <path d="M42 38 V16" />
      <path d="M25 14 L38 27 L25 31 z" />
      <path d="M42 19 L52 30 L42 33 z" />
      <path d="M25 11 l7 3 -7 3" />
      <g class="net" opacity={working ? 1 : 0}>
        <path d="M50 46 q11 8 7 19" />
        <path d="M52 51 l6 2 M54 57 l6 2 M55 63 l5 1" />
      </g>
    </g>
  </g>
);

/** One ground index per search, in cursor order. The cursor counts searches and the chart draws grounds,
 *  and since the net covers a dozen tools those are no longer the same number -- so the client is handed
 *  the mapping rather than left to assume it. Per render, because the registry can lengthen the list
 *  without a deploy; every index past the static searches is The New Waters. */
const groundMap = (nq: number) => Array.from({ length: Math.max(nq, TRAWL_QUERIES.length) }, (_, i) => groundOfQuery(i, Math.max(nq, TRAWL_QUERIES.length))).join(",");

export const SeaChart: FC<{ sea: SeaData }> = ({ sea }) => {
  const at = now();
  const v = voyage(at, sea.last_run);
  const g = groundFor(sea.cursor + v.rolled, sea.nq);
  const said = voyageText(v, g, sea.spent);
  // Standing out she has only just left, and tied up she is home; either way the Trough is the honest
  // static answer. On the grounds and running home, the ground is. Laid up beats all of it: the leg is
  // still computed from the phase of a voyage she never made, so it must not put her net in the water.
  // Spent is the same: the day is landed and the last voyage's phase says nothing about now.
  const idle = v.laidUp || sea.spent;
  const moored = idle || v.leg === "out" || v.leg === "moored";
  const working = !idle && v.leg === "grounds";
  return (
    <div
      class="box seachart"
      id="seachart"
      data-now={at}
      data-last={idle ? "" : sea.last_run ?? ""}
      data-cursor={sea.cursor}
      data-groundof={groundMap(sea.nq)}
    >
      <h3>The Slop Triangle <span class="muted">· <a href="/orphanage">the Cap'm</a></span></h3>
      <svg viewBox="0 0 280 180" class="chart-svg" role="img" aria-labelledby="seatitle seadesc">
        <title id="seatitle">A chart of the Slop Triangle</title>
        <desc id="seadesc">{said}</desc>
        <path class="water" d={`M${TROUGH.x} ${TROUGH.y} L${SHOALS.x} ${SHOALS.y} L${DEEPS.x} ${DEEPS.y} z`} />
        {GROUNDS.map((x) => <path class="track" id={`ss-track-${x.q}`} d={track(x)} />)}
        {GROUNDS.map((x) => (
          <g class={`ground${x.q === g.q ? " on" : ""}`} id={`ss-ground-${x.q}`}>
            <circle cx={x.x} cy={x.y} r="3" />
            {/* Under the mark, not over it: the ship is drawn centred on the ground she is working, and
                a label above would spend most of the day behind her hull. */}
            <text x={x.x} y={x.y + 12} text-anchor="middle">{x.name}</text>
          </g>
        ))}
        <g class="corner">
          <text x={TROUGH.x - 4} y={TROUGH.y + 15} text-anchor="start">{TROUGH.name}</text>
          <text x={SHOALS.x} y={SHOALS.y - 8} text-anchor="middle">{SHOALS.name}</text>
          <text x={DEEPS.x} y={DEEPS.y + 16} text-anchor="end">{DEEPS.name}</text>
        </g>
        {/* Three nested groups, three owners, and they never fight: rail.js sets the position on the
            outer one, CSS bobs the middle one, rail.js flips the inner one to face the way she is going. */}
        <g id="ss-ship" transform={`translate(${moored ? TROUGH.x : g.x} ${moored ? TROUGH.y : g.y})`}>
          <g class="bob"><Ship working={working} /></g>
        </g>
      </svg>
      <p class="say" id="ss-say">{said}</p>
      <p class="muted small">
        {/* Only the trawl advances the counter, so once she is tied up the next ground is a guess and
            the page should not state it as this hour's plan. */}
        {idle
          ? <>Her next ground when she sails: <strong>{g.name}</strong> — {g.blurb}.{" "}</>
          : <>This hour's ground: <strong>{g.name}</strong> — {g.blurb}.{" "}</>}
        {sea.last_run
          ? <>Last sailing <time datetime={isoDateTime(sea.last_run)} data-at={sea.last_run} class="ss-ago">{isoDateTime(sea.last_run)}</time>.{" "}</>
          : null}
        <a href="/queue">{sea.lane} in her lane</a>, {sea.hauled} hauled aboard so far.
      </p>
    </div>
  );
};
