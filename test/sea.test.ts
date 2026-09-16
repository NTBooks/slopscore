import { describe, it, expect } from "vitest";
import { GROUNDS, LEGS, TROUGH, VOYAGE_PERIOD, groundFor, rolledCursor, voyage, voyageText, type Leg } from "../src/lib/sea";
import { TRAWL_GROUNDS, TRAWL_QUERIES, groundOfQuery } from "../src/lib/virtual";

const SAILED = Date.parse("2026-09-12T00:05:00Z") / 1000;
const into = (frac: number) => SAILED + Math.round(frac * VOYAGE_PERIOD);

describe("the Slop Triangle is the water the Cap'm actually works", () => {
  it("draws exactly the grounds the trawl has, and no invented ones", () => {
    // The chart claims each ground is real water. If these drift apart it is decoration, or worse, a lie.
    expect(GROUNDS.map((g) => g.name)).toEqual(TRAWL_GROUNDS.map((g) => g.name));
  });
  it("keeps every ground at its own index", () => {
    GROUNDS.forEach((g, i) => expect(g.q).toBe(i));
  });
  it("puts every single search in exactly one ground", () => {
    // The cursor indexes searches, the chart draws grounds; a search in no ground is water she works
    // while the chart shows her somewhere else.
    expect(TRAWL_GROUNDS.flatMap((g) => g.queries)).toEqual(TRAWL_QUERIES);
    for (let i = 0; i < TRAWL_QUERIES.length; i++) {
      expect(groundOfQuery(i)).toBeGreaterThanOrEqual(0);
      expect(groundOfQuery(i)).toBeLessThan(GROUNDS.length);
    }
    expect(new Set(TRAWL_QUERIES).size).toBe(TRAWL_QUERIES.length);
  });
  it("leaves no ground with nothing to fish in it", () => {
    for (const g of TRAWL_GROUNDS) expect(g.queries.length).toBeGreaterThan(0);
  });
  it("gives every ground a name of its own and a blurb saying which query it is", () => {
    expect(new Set(GROUNDS.map((g) => g.name)).size).toBe(GROUNDS.length);
    for (const g of GROUNDS) expect(g.blurb.length).toBeGreaterThan(20);
  });
  it("wraps the cursor onto a ground in either direction", () => {
    const n = TRAWL_QUERIES.length;
    expect(groundFor(0)).toBe(groundFor(n));
    expect(groundFor(-1)).toBe(GROUNDS[GROUNDS.length - 1]);
    expect(groundFor(NaN)).toBe(GROUNDS[0]);
    for (let i = -n; i < 3 * n; i++) expect(GROUNDS).toContain(groundFor(i));
  });
  it("walks every ground as the cursor counts up through a full cycle", () => {
    const visited = new Set<string>();
    for (let i = 0; i < TRAWL_QUERIES.length; i++) visited.add(groundFor(i).name);
    expect(visited.size).toBe(GROUNDS.length);
  });
  it("keeps every ground on the chart", () => {
    for (const g of GROUNDS) {
      expect(g.x).toBeGreaterThan(0);
      expect(g.x).toBeLessThan(280);
      expect(g.y).toBeGreaterThan(0);
      expect(g.y).toBeLessThan(180);
    }
  });
});

describe("the voyage is an hour long and the ship is always somewhere real", () => {
  it("sails once an hour, in step with the trawl's cron", () => {
    expect(VOYAGE_PERIOD).toBe(3600);
  });
  it("puts her at the mooring the moment the trawl fires, and home again before the next one", () => {
    expect(voyage(SAILED, SAILED).leg).toBe("out");
    expect(voyage(SAILED, SAILED).t).toBe(0);
    expect(voyage(into(0.99), SAILED).leg).toBe("moored");
  });
  it("walks the legs in order as the day goes by, and never backwards", () => {
    const order: Leg[] = ["out", "grounds", "home", "moored"];
    let seen = -1;
    for (let f = 0; f < 1; f += 0.005) {
      const i = order.indexOf(voyage(into(f), SAILED).leg);
      expect(i).toBeGreaterThanOrEqual(seen);
      seen = i;
    }
    expect(seen).toBe(3);
  });
  it("never leaves a leg, and never reports a position off the line", () => {
    for (let i = 0; i < 2000; i++) {
      const v = voyage(SAILED + i * 43, SAILED);
      expect(["out", "grounds", "home", "moored"]).toContain(v.leg);
      expect(v.t).toBeGreaterThanOrEqual(0);
      expect(v.t).toBeLessThanOrEqual(1);
      expect(v.phase).toBeGreaterThanOrEqual(0);
      expect(v.phase).toBeLessThan(1);
    }
  });
  it("rolls a stale last_run forward instead of sailing a week in one day", () => {
    const fresh = voyage(into(0.3), SAILED);
    const stale = voyage(into(0.3) + 3 * VOYAGE_PERIOD, SAILED);
    expect(stale.phase).toBeCloseTo(fresh.phase, 10);
    expect(stale.leg).toBe(fresh.leg);
    expect(stale.rolled).toBe(3);
    expect(fresh.rolled).toBe(0);
  });
  it("ties her up once two sailings have been missed", () => {
    expect(voyage(into(0.5), SAILED).laidUp).toBe(false);
    expect(voyage(into(0.5) + VOYAGE_PERIOD, SAILED).laidUp).toBe(false);
    expect(voyage(into(0.5) + 2 * VOYAGE_PERIOD, SAILED).laidUp).toBe(true);
  });
  it("moors her rather than dividing by zero when the trawl has never run", () => {
    for (const last of [null, 0, -1, NaN]) {
      const v = voyage(SAILED, last as number | null);
      expect(v.leg).toBe("moored");
      expect(Number.isFinite(v.t)).toBe(true);
      expect(Number.isFinite(v.phase)).toBe(true);
    }
  });
  it("does not sail backwards when the reader's clock is behind the server's", () => {
    const v = voyage(SAILED - 600, SAILED);
    expect(v.phase).toBe(0);
    expect(v.t).toBe(0);
    expect(v.rolled).toBe(0);
  });
  it("carries the counter forward by one search for every voyage missed", () => {
    expect(rolledCursor(4, voyage(into(0.2), SAILED))).toBe(4);
    expect(rolledCursor(4, voyage(into(0.2) + 3 * VOYAGE_PERIOD, SAILED))).toBe(7);
    expect(groundFor(7)).toBe(GROUNDS[groundOfQuery(7)]);
  });
});

describe("the chart's caption says only what is true", () => {
  it("names the ground only while she is working it", () => {
    const g = GROUNDS[1];
    expect(voyageText(voyage(into(0.3), SAILED), g)).toContain(g.name);
    expect(voyageText(voyage(into(0.7), SAILED), g)).not.toContain(g.name);
    expect(voyageText(voyage(into(0.9), SAILED), g)).not.toContain(g.name);
  });
  it("says she is laid up rather than fishing once the expedition is over", () => {
    const text = voyageText(voyage(into(0.3) + 5 * VOYAGE_PERIOD, SAILED), GROUNDS[1]);
    expect(text).toMatch(/laid up/);
    expect(text).not.toContain(GROUNDS[1].name);
  });
  it("says the day is landed rather than that something is wrong, once the budget is spent", () => {
    const g = GROUNDS[1];
    const text = voyageText(voyage(into(0.3), SAILED), g, true);
    expect(text).toMatch(/tied up/);
    expect(text).toMatch(/landed/);
    expect(text).not.toMatch(/laid up/);
    expect(text).not.toContain(g.name);
    // Never sailed still wins: a fresh database is not a spent day.
    expect(voyageText(voyage(SAILED, null), g, true)).toMatch(/has not sailed yet/);
  });
  it("says she has never sailed rather than that she is overdue", () => {
    // A fresh database and an expedition that has ended both leave her at the Trough. They are not the
    // same news, and the chart should not report one as the other.
    const never = voyageText(voyage(SAILED, null), GROUNDS[0]);
    expect(never).toContain("Trough");
    expect(never).toMatch(/has not sailed yet/);
    expect(never).not.toMatch(/laid up/);
    expect(never).not.toContain(GROUNDS[0].name);
  });
  it("has a leg boundary for every leg, in order", () => {
    expect(LEGS.out).toBeLessThan(LEGS.grounds);
    expect(LEGS.grounds).toBeLessThan(LEGS.home);
    expect(LEGS.home).toBeLessThan(1);
  });
});
