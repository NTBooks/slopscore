// The Slop Triangle: where the Sloptrawler is, drawn as a chart in the rail.
//
// The fiction is thin on purpose, because a made-up map of made-up water would be decoration and this
// is meant to say something true. The grounds ARE the trawl's own grounds -- TRAWL_GROUNDS in
// src/lib/virtual.ts, imported rather than retyped -- and trawl:cursor really is where she starts
// tonight. All this file adds is where each one sits on the chart. Nothing here can drift from the net,
// because there is nothing here to drift: rename a ground over there and the chart renames itself.
//
// The triangle is the shape of the work: a home port, the four topic: queries at one corner, the two
// in:description queries at another. The voyage is the shape of the clock: the trawl fires once a day
// at 00:05 UTC, so a day is one round trip, and where she is in it is what time it is.
//
// Everything here is pure. What the browser does with it is public/rail.js, which mirrors LEGS and
// nothing else: all the arithmetic that could be wrong lives in this file, where it is tested.
import { TRAWL_GROUNDS, groundOfQuery } from "./virtual";

/** One fishing ground: a TRAWL_GROUNDS entry with a place on the 280x180 chart. */
export interface Ground {
  /** Index into TRAWL_GROUNDS, which is what groundOfQuery returns. */
  q: number;
  name: string;
  /** Which searches this ground is, in words, so the joke can be checked against the code. */
  blurb: string;
  x: number;
  y: number;
}

/** Where she lands what she catches, and the two corners she works between. */
export const TROUGH = { x: 38, y: 150, name: "The Trough" };
export const SHOALS = { x: 148, y: 26, name: "Topic Shoals" };
export const DEEPS = { x: 248, y: 142, name: "Description Deeps" };

/** Where each ground sits. One entry per TRAWL_GROUNDS entry, in the same order; a ground added over
 *  there without a berth here falls back to the middle of the water rather than off the chart. */
const BERTHS: { x: number; y: number }[] = [
  { x: 84, y: 96 }, { x: 116, y: 54 }, { x: 178, y: 46 },
  { x: 216, y: 74 }, { x: 238, y: 116 }, { x: 166, y: 132 },
];

export const GROUNDS: Ground[] = TRAWL_GROUNDS.map((g, i) => ({
  q: i, name: g.name, blurb: g.blurb, ...(BERTHS[i] ?? { x: 150, y: 92 }),
}));

/**
 * Tonight's ground, from trawl:cursor.
 *
 * The cursor indexes the flattened query list, not the grounds, because that is what autoTrawl walks and
 * advances. groundOfQuery does the mapping, and it wraps, so a counter that only ever goes up still lands.
 */
export function groundFor(cursor: number): Ground {
  return GROUNDS[groundOfQuery(cursor)] ?? GROUNDS[0];
}

/** One trawl to the next: the cron is `5 0 * * *`. */
export const VOYAGE_PERIOD = 86400;

/**
 * Where the legs end, as a fraction of the day. Standing out takes a while, the grounds take most of
 * it, running home is quicker than going, and she lies at the Trough overnight being emptied.
 * public/rail.js carries a copy of these four numbers; this is the one that is tested.
 */
export const LEGS = { out: 0.15, grounds: 0.6, home: 0.8 } as const;

export type Leg = "out" | "grounds" | "home" | "moored";

export interface Voyage {
  leg: Leg;
  /** 0..1 along the current leg. */
  t: number;
  /** 0..1 through the day. */
  phase: number;
  /** Whole voyages since `last`: how far the facts the chart was drawn from have drifted. */
  rolled: number;
  /** She has missed two sailings. Either the expedition is over (TRAWL_STOP_AT) or something is wrong. */
  laidUp: boolean;
}

const MOORED: Voyage = { leg: "moored", t: 0, phase: 0, rolled: 0, laidUp: true };

/**
 * Where she is now, given when she last sailed.
 *
 * `last` comes out of crawl_state and can be a day or a week stale, so the drift is measured rather
 * than ignored: `rolled` says how many whole voyages have been missed, and the phase is taken from
 * the remainder. Without that a stale row would have her sailing a week's worth of the leg in one
 * day, off the end of the chart. A clock running behind the server's is clamped rather than allowed
 * to sail backwards, and no `last` at all means she has never been out.
 */
export function voyage(now: number, last: number | null, period = VOYAGE_PERIOD): Voyage {
  if (last == null || !Number.isFinite(last) || last <= 0) return MOORED;
  const span = period > 0 ? period : VOYAGE_PERIOD;
  const since = now - last;
  if (!Number.isFinite(since) || since < 0) return { leg: "out", t: 0, phase: 0, rolled: 0, laidUp: false };
  const rolled = Math.floor(since / span);
  const phase = (since % span) / span;
  const laidUp = rolled >= 2;
  const [leg, lo, hi]: [Leg, number, number] =
    phase < LEGS.out ? ["out", 0, LEGS.out]
    : phase < LEGS.grounds ? ["grounds", LEGS.out, LEGS.grounds]
    : phase < LEGS.home ? ["home", LEGS.grounds, LEGS.home]
    : ["moored", LEGS.home, 1];
  return { leg, t: (phase - lo) / (hi - lo), phase, rolled, laidUp };
}

/**
 * The cursor tonight, corrected for how stale the facts are.
 *
 * autoTrawl and trawl each advance trawl:cursor by exactly one per daily run, so a cached page can
 * work out where the counter has got to rather than showing yesterday's ground. It is only right if
 * she actually sailed on each of those days; if TRAWL_STOP_AT stopped her the counter did not move and
 * this is one ground out for a day, which is why laidUp exists and why the caption stops naming a
 * ground once it is set.
 */
export const rolledCursor = (cursor: number, v: Voyage): number => Math.floor(Number(cursor) || 0) + v.rolled;

/** What the chart says she is doing. Never claims she is fishing when she is tied up. */
export function voyageText(v: Voyage, g: Ground): string {
  // laidUp needs two missed voyages, so rolled === 0 alongside it can only be the never-sailed case.
  // Worth separating: a local dev database and an expedition that has ended are not the same news.
  if (v.laidUp && v.rolled === 0) return "The Sloptrawler is moored at the Trough. She has not sailed yet.";
  if (v.laidUp) return "The Sloptrawler is laid up at the Trough. She has not been out in days.";
  switch (v.leg) {
    case "out": return `The Sloptrawler is standing out from the Trough, bound for ${g.name}.`;
    case "grounds": return `The Sloptrawler is on the grounds off ${g.name}, net down.`;
    case "home": return "The Sloptrawler is running home with what she caught.";
    default: return "The Sloptrawler is tied up at the Trough, and her hold is being emptied.";
  }
}
