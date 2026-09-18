// The trends dashboard. Everything is drawn server-side out of one snapshot: inline SVG for the marks, HTML for
// every word and number (views/charts.tsx), no script tag, no chart library, no fetch. It prints, it works with
// JS off, and it costs one D1 query.
import type { FC } from "hono/jsx";
import { COHORTS, COHORT_LABEL, FACET_TITLE, TEMPLATED_ON_TRAWL, pickGrain, type Bar, type Cohort, type FacetChart, type JudgedChart, type SeaView, type ToolMonth, type TrendsView } from "../jobs/trends";
import { LISTABLE_CODES } from "../lib/method";
import { MIN_STARS, MAX_STARS, PUSHED_WITHIN_DAYS } from "../lib/virtual";
import { Columns, Donut, Fig, Kpi, Kpis, Legend, OTHER_CLASS, donutSlices, pct, slotClass, type ColumnSpec, type Slice } from "./charts";

/** The trawl's own window, spelled out for the reader. Read off the constants the trawl actually filters on
 *  (../lib/virtual), so loosening the floor to one star rewrites the page instead of leaving it lying. */
const STAR_WINDOW = `${MIN_STARS.toLocaleString("en-US")} to ${MAX_STARS.toLocaleString("en-US")}`;

/** What each cohort is, in four words, wherever its column is headed. */
const COHORT_SUB: Record<Cohort, string> = { trawl: "the net's sample", opted: "they filed the paperwork" };

/** One horizontal bar chart. `of` is the denominator the share is quoted against, when there is a sensible one;
 *  `tone` is the cohort the bars belong to, so a trawled column is always pink and an opted-in one always purple. */
export const Bars: FC<{ rows: Bar[]; of?: number; limit?: number; empty?: string; wide?: boolean; counts?: boolean; tone?: Cohort | "seen" }> = ({ rows, of, limit = 10, empty, wide, counts, tone }) => {
  if (!rows.length) return <p class="muted small">{empty ?? "Nothing here yet."}</p>;
  return (
    <div class={`bars${wide ? " wide" : ""}${counts ? " withn" : ""}${tone ? ` ${tone}` : ""}`}>
      {rows.slice(0, limit).map((r) => (
        <div class="barrow" title={[of ? `${r.key}: ${r.n} of ${of} (${pct(r.n / of)})` : `${r.key}: ${r.n}`, r.mean == null ? "" : `mean score ${Math.round(r.mean)}`].filter(Boolean).join(" · ")}>
          <span class="barkey">{r.key}</span>
          <span class="bartrack"><i style={`width:${pct(Math.max(r.share, 0.015))}`}></i></span>
          {/* On a small sample the count is the honest number and the share is the decoration, so both show. */}
          <span class="barn">{counts ? <>{r.n}{of ? <span class="muted"> {pct(r.n / of)}</span> : null}</> : of ? pct(r.n / of) : r.n}</span>
        </div>
      ))}
    </div>
  );
};

/**
 * The tag cloud: GitHub topics, size by frequency, every term a link to that facet's feed. Sorted alphabetically
 * on purpose — sorting by size would just be the bar chart again, and the point of a cloud is the tail.
 */
const TagCloud: FC<{ rows: Bar[]; of?: number }> = ({ rows, of }) => {
  if (!rows.length) return <p class="muted small">No topics yet.</p>;
  const max = rows[0]?.n ?? 1;
  const terms = [...rows].sort((a, b) => a.key.localeCompare(b.key));
  return (
    <p class="cloud">
      {terms.map((r) => {
        // sqrt, not linear: one runaway term would otherwise flatten everything else into the same small type.
        const k = Math.sqrt(r.n / max);
        return (
          <a href={`/f/topic/${encodeURIComponent(r.key)}`} style={`font-size:${(11 + k * 15).toFixed(1)}px;opacity:${(0.55 + k * 0.45).toFixed(2)}`}
            title={`${r.key}: ${r.n}${of ? ` of ${of} (${pct(r.n / of)})` : ""} — see them`}>{r.key}</a>
        );
      })}
    </p>
  );
};

/** A judged metric: the whole sample first, then the two sides of the decision, with the n always in view. */
const Judged: FC<{ c: JudgedChart; limit?: number }> = ({ c, limit = 12 }) => {
  const total = c.n_listed + c.n_thrown_back;
  return (
    <>
      <Bars rows={c.all} of={total} limit={limit} counts wide empty="The judge has not seen anything yet." />
      {c.n_listed && c.n_thrown_back ? (
        <div class="cohorts">
          <div>
            <div class="cohead">listed <span class="muted">· n={c.n_listed}</span></div>
            <Bars rows={c.listed} limit={limit} />
          </div>
          <div>
            <div class="cohead">thrown back <span class="muted">· n={c.n_thrown_back}</span></div>
            <Bars rows={c.thrown_back} limit={limit} />
          </div>
        </div>
      ) : null}
    </>
  );
};

/**
 * The verdict as a ring: the five listable codes in their own colours, everything the judge threw back folded
 * into one grey slice, and the share that was software in the middle. Colour follows the code, not its rank,
 * so "app" is the same pink on every snapshot however the order shifts.
 */
function verdictSlices(c: JudgedChart): Slice[] {
  const listable = c.all.filter((b) => (LISTABLE_CODES as readonly string[]).includes(b.key)).map((b) => ({ key: b.key, n: b.n, cls: slotClass(LISTABLE_CODES.indexOf(b.key as (typeof LISTABLE_CODES)[number])) }));
  const thrown = c.all.filter((b) => !(LISTABLE_CODES as readonly string[]).includes(b.key)).reduce((s, b) => s + b.n, 0);
  return thrown ? [...listable, { key: "thrown back", n: thrown, cls: OTHER_CLASS }] : listable;
}

/**
 * The same question asked of both cohorts, side by side. The gap between the columns is the actual finding —
 * so when one cohort is empty (a site that has never run the trawl) the chart drops to one column rather than
 * spending half its width saying "nothing here yet" fifteen times.
 */
const Pair: FC<{ id?: string; title: string; sub?: string; note?: string; trawl: Bar[]; opted: Bar[]; totals: Record<Cohort, Record<string, number>>; limit?: number }> = ({ id, title, sub, note, trawl, opted, totals, limit }) => {
  const show: Cohort[] = COHORTS.filter((c) => (totals[c]?.listed ?? 0) > 0);
  const cols = show.length ? show : ["opted" as Cohort];
  return (
    <div class="chart" id={id}>
      <h3>{title} {sub ? <span class="muted">· {sub}</span> : null}</h3>
      {note ? <p class="muted small">{note}</p> : null}
      <div class={cols.length > 1 ? "cohorts" : ""}>
        {cols.map((c) => (
          <div>
            <div class="cohead"><i class={`swatch ${c}`}></i> {COHORT_LABEL[c]} <span class="muted">· {COHORT_SUB[c]}</span></div>
            <Bars rows={c === "trawl" ? trawl : opted} of={totals[c]?.listed} limit={limit} tone={c} empty="Nothing declared here yet." />
          </div>
        ))}
      </div>
    </div>
  );
};

const FacetPair: FC<{ chart: FacetChart; totals: Record<Cohort, Record<string, number>> }> = ({ chart, totals }) => (
  <Pair id={chart.facet} title={FACET_TITLE[chart.facet]} sub={chart.facet} trawl={chart.trawl} opted={chart.opted} totals={totals} />
);

/** A facet the trawl cannot answer: one column, and the caveat is carried by the section it sits in. */
const SoloChart: FC<{ chart: FacetChart; of?: number }> = ({ chart, of }) => (
  <div>
    <div class="cohead">{FACET_TITLE[chart.facet]} <span class="muted">· {chart.facet}</span></div>
    <Bars rows={chart.opted} of={of} limit={8} tone="opted" />
  </div>
);

/**
 * The sea: everything the searches return before the trawl's rules touch it, counted from the search
 * response alone (method v4). Drawn in its own colour and never beside a cohort column: its denominator is
 * every sighting, not every listing, and a bar here is not comparable to the same bar in the trough.
 */
const Sea: FC<{ s: SeaView }> = ({ s }) => {
  const n = s.totals.seen ?? 0;
  const share = (k: string) => pct(n ? (s.totals[k] ?? 0) / n : 0);
  const bornTotal = s.born_w.reduce((a, w) => a + w.n, 0);
  const Half: FC<{ title: string; sub?: string; rows: Bar[]; limit?: number; empty?: string }> = ({ title, sub, rows, limit, empty }) => (
    <div>
      <div class="cohead">{title}{sub ? <span class="muted"> · {sub}</span> : null}</div>
      <Bars rows={rows} of={n} limit={limit} tone="seen" empty={empty} />
    </div>
  );
  return (
    <>
      <h3 id="sea">The sea: everything the searches return</h3>
      <p class="muted small">Every repo the trawl's searches returned in the last {PUSHED_WITHIN_DAYS} days, <strong>before any of the trawl's rules</strong>: no star floor, no licence filter, no owner filter. Counted from GitHub's search response and nothing else. No README is read, no model is asked, nothing here is listed, and nothing here is named. It is the water the trawled column is drawn from, and the one place the trawl's own filters are measured rather than assumed (<a href="/method">method v4</a>).</p>
      <Kpis>
        <Kpi label="seen in 90 days" value={n} sub={`${(s.totals.owners ?? 0).toLocaleString()} owners · ${(s.totals.new_30d ?? 0).toLocaleString()} first seen in the last 30`} />
        <Kpi label="no stars at all" value={share("unstarred")} sub={`${(s.totals.unstarred ?? 0).toLocaleString()} repos`} />
        <Kpi label="no licence" value={share("unlicensed")} sub={`${(s.totals.unlicensed ?? 0).toLocaleString()} repos`} />
        <Kpi label="would reach the judge" value={share("candidates")} sub="under the trawl's rules as they stood that day" />
      </Kpis>
      {bornTotal ? (
        <Fig caption={<>Repos created per week, over everything seen. A flow of the world rather than of our walk: complete for every week inside the {PUSHED_WITHIN_DAYS}-day push window, since a repo created in it was pushed in it.</>}>
          <Columns cols={s.born_w.map((w): ColumnSpec => ({ period: w.period, total: w.n, parts: [{ key: "created", n: w.n, cls: "seen" }] }))} />
        </Fig>
      ) : null}
      <div class="cohorts">
        <Half title="stars" rows={s.stars} limit={7} />
        <Half title="licence" rows={s.licence} />
      </div>
      <div class="cohorts">
        <Half title="what the trawl's rules would do" sub="the first rule that stops it" rows={s.sieve} />
        <Half title="how long it lived" sub="created to last push" rows={s.life} />
      </div>
      <div class="cohorts">
        <Half title="languages" rows={s.language} />
        <Half title="size" rows={s.size} />
      </div>
      <div class="cohorts">
        <Half title="which tool the description credits" sub="weaker than a README's sentence" rows={s.tool} empty="No description names a tool yet." />
        <Half title="which water it came up in" rows={s.ground} />
      </div>
      <div class="cohorts">
        <Half title="the shape of the claim" rows={s.signal} />
        <Half title="owner" rows={s.owner} />
      </div>
    </>
  );
};

/** The colour a tool wears, by its place in the key order; the fold bucket is always grey. */
const toolClass = (keys: string[], key: string) => (key === "other" ? OTHER_CLASS : slotClass(keys.indexOf(key)));

/** Share of the credit, period by period: each column is one period at 100%, stacked by tool. */
const ToolShare: FC<{ keys: string[]; months: ToolMonth[] }> = ({ keys, months }) => (
  <>
    <Columns share tall cols={months.map((m): ColumnSpec => ({ period: m.period, total: m.total, parts: m.parts.map((p) => ({ key: p.key, n: p.n, cls: toolClass(keys, p.key) })) }))} />
    <Legend keys={keys.map((k) => ({ key: k, cls: toolClass(keys, k) }))} />
  </>
);

/** The whole run of a tool series added up, for the ring beside it. */
function toolTotals(keys: string[], months: ToolMonth[]): Slice[] {
  const sum = new Map<string, number>();
  for (const m of months) for (const p of m.parts) sum.set(p.key, (sum.get(p.key) ?? 0) + p.n);
  return keys.map((key) => ({ key, n: sum.get(key) ?? 0, cls: toolClass(keys, key) })).filter((s) => s.n > 0);
}

export const Trends: FC<{ d: TrendsView }> = ({ d }) => {
  const t = d.totals.trawl ?? {};
  const o = d.totals.opted ?? {};
  const listedTotal = (t.listed ?? 0) + (o.listed ?? 0);
  const netTotal = d.net.reduce((s, r) => s + r.n, 0);
  const awayTotal = d.turned_away.reduce((s, r) => s + r.n, 0);
  // Facets the trawl can answer are drawn as a comparison; the rest are grouped under one caveat instead of
  // repeating "not asked" down half the page.
  const judgedTotal = d.use.n_listed + d.use.n_thrown_back;
  const software = d.verdict.all.filter((b) => (LISTABLE_CODES as readonly string[]).includes(b.key)).reduce((s, b) => s + b.n, 0);
  const shared = d.facets.filter((f) => !TEMPLATED_ON_TRAWL.has(f.facet));
  const declaredOnly = d.facets.filter((f) => TEMPLATED_ON_TRAWL.has(f.facet) && f.opted.length);

  // The time series at whichever grain has something to show. A snapshot from before the weekly series
  // existed has no weeks at all, and then the months are drawn as they always were.
  const listingsW = d.listings_w ?? [];
  const toolsW = d.tools_w ?? { keys: [], months: [] };
  const grain = pickGrain(d.listings, listingsW);
  const intake = grain === "week" ? listingsW : d.listings;
  const toolSeries = grain === "week" && toolsW.months.length ? toolsW.months : d.tools.months;
  const byThe = grain === "week" ? "week by week" : "month by month";
  const toolsTotal = toolTotals(d.tools.keys, toolSeries);
  const toolsN = toolsTotal.reduce((s, x) => s + x.n, 0);
  const anyTools = d.tools.months.some((m) => m.total) || toolsW.months.some((m) => m.total);

  const jump: [string, string, boolean][] = [
    ["#sea", "the sea", Boolean(d.sea)],
    ["#haul", "the haul", judgedTotal > 0],
    ["#intake", "intake", true],
    ["#tools", "tools", anyTools],
    ["#topics", "topics", d.cloud.trawl.length + d.cloud.opted.length > 0],
    ...shared.map((f): [string, string, boolean] => [`#${f.facet}`, FACET_TITLE[f.facet].toLowerCase(), true]),
    ["#paperwork", "the paperwork", declaredOnly.length > 0],
    ["#age", "age", true],
    ["#stars", "stars", true],
    ["#net", "thrown back", true],
    ["#turned-away", "turned away", awayTotal > 0],
  ];

  return (
    <section class="wrap narrow dash" style="padding:0">
      <h2>Trends</h2>
      <p class="muted">What {listedTotal.toLocaleString()} listings look like when you stand back from them. Recounted once a night from data the site already holds; nothing is sent to a model to build this page. Snapshot: <strong>{d.date}</strong>. Also <a href="/trends.json">.json</a> and <a href="/trends.md">.md</a>.</p>
      <p class="jump">{jump.filter((j) => j[2]).map(([href, label]) => <a href={href}>{label}</a>)}</p>

      <Kpis>
        <Kpi label="listed" value={listedTotal} sub={<><i class="swatch trawl"></i> {(t.listed ?? 0).toLocaleString()} trawled · <i class="swatch opted"></i> {(o.listed ?? 0).toLocaleString()} opted in</>} />
        <Kpi label="makers" value={(t.owners ?? 0) + (o.owners ?? 0)} sub={`${(t.owners ?? 0).toLocaleString()} trawled · ${(o.owners ?? 0).toLocaleString()} opted in`} />
        <Kpi label="new in 30 days" value={(t.new_30d ?? 0) + (o.new_30d ?? 0)} sub={`${t.new_30d ?? 0} trawled · ${o.new_30d ?? 0} opted in`} />
        <Kpi label="judged so far" value={judgedTotal} sub={judgedTotal ? `${d.verdict.n_listed} let through · ${d.verdict.n_thrown_back} thrown back` : "the judge has not seen anything yet"} />
      </Kpis>
      <p class="muted small">Mean stars {t.mean_stars ?? 0} trawled · {o.mean_stars ?? 0} opted in. Mean score here {t.mean_score ?? 0} trawled · {o.mean_score ?? 0} opted in. {(o.submitted ?? 0).toLocaleString()} of the opted-in listings were launched by their owner; {o.with_demo ?? 0} opted-in and {t.with_demo ?? 0} trawled listings carry a demo link.</p>

      <details class="note" open>
        <summary>Read this first, or you will read the charts wrong</summary>
        <p class="small"><strong>Trawled</strong> repos never asked to be here. The Cap'm found them because their owner said in public, in the past tense, that a model wrote the thing — then a cheap classifier checked it was software rather than a blog post about software. Nothing else was selected for, so as a sample of <em>publicly self-declared AI-written software</em> it is about as close to random as this gets. It is <em>not</em> a sample of AI-written software: most of that is never labelled, and the label is the only thing we can see.</p>
        <p class="small"><strong>Opted-in</strong> repos committed a <a href="/spec">slopscore.md</a>. That is a person choosing to file paperwork about their own work, which is self-selection with a capital S. Their column tells you about people who volunteer, and it is the only column that can answer a question the maker had to answer themselves.</p>
        <p class="small">Two more ropes on the sample: the trawl only looks at repos with {STAR_WINDOW} stars, pushed in the last {PUSHED_WITHIN_DAYS} days, under a licence permissive enough to quote from. So the ends of the star chart are a rule of ours, not a fact about the world.{d.sea ? <> <strong>The sea</strong>, first below, is the same searches with those ropes taken off: every repo they return, at any star count and under any licence, counted from the search response alone and never listed. It is where the ropes are measured.</> : null}</p>
        <p class="small">Two of the charts below — what the software is <em>for</em>, and what kind of thing it is — are a <strong>model's</strong> labels rather than a maker's, picked off a fixed list by the classifier the trawl already runs (<a href="/about">how that works</a>). They are the only numbers here that are somebody's opinion, they are marked where they appear, and they are the only way to ask that question of a sample nobody volunteered for. Everything else on this page is counted, not judged.</p>
        <p class="small">All of that, and the biases we know about, written down in one frozen and versioned place: <a href="/method">how we count</a>. The same numbers once a week, as a document you can cite after this snapshot has been pruned: <a href="/report">the Trawl Report</a>.</p>
      </details>

      {d.sea ? <Sea s={d.sea} /> : null}

      {judgedTotal ? (
        <>
          <h3 id="haul">The haul: what the judge let through and what it threw back</h3>
          <p class="muted small">The trawl pays a cheap classifier to look at every candidate before deciding whether to list it (<a href="/about">how that works</a>). It answers with two values off two fixed lists — never a sentence — and both answers are kept, for the ones it let through <em>and</em> the ones it threw back. That second group never reaches the feed, and it is the only near-random read this site has on what is actually out there. Still a <strong>small</strong> read: {judgedTotal.toLocaleString()} repos judged so far. Counts are printed beside every share for that reason; a slice standing on single digits is an anecdote with a percentage sign on it.</p>
          <Fig caption={<>Only the first five codes are listable; the rest are reasons a candidate gets put back over the side, folded into the grey slice here and broken out below. These are a <strong>model's</strong> labels, not a maker's.</>}>
            <Donut slices={verdictSlices(d.verdict)} hero={pct(judgedTotal ? software / judgedTotal : 0)} caption="software somebody made" title={`What the judge decided over ${judgedTotal} candidates`} empty="The judge has not seen anything yet." />
          </Fig>
          <h4 class="cohead">…and what kind of thing it turned out to be, both sides of the decision</h4>
          <Judged c={d.verdict} />

          <h3 id="use">What people are actually building</h3>
          <p class="muted small">The same classifier's other answer: what the software is <em>for</em>, off a closed list. Whole sample first, then the ones it let through and the ones it threw back.</p>
          <Judged c={d.use} />
        </>
      ) : null}

      <h3 id="intake">How much comes in, {byThe}</h3>
      <p class="muted small">Listings by the {grain} they went up, trawled and opted-in stacked together. The trawl releases a fixed number a day, so this line is mostly a picture of our own throttle — it is here so the shape of everything below has a denominator.{grain === "week" ? " Drawn by week while the site is young; it switches to months once three of them have anything in." : ""}</p>
      <Fig>
        <Columns cols={intake.map((m): ColumnSpec => ({ period: m.period, total: m.total, parts: [{ key: "trawled", n: m.trawl, cls: "trawl" }, { key: "opted in", n: m.opted, cls: "opted" }] }))} />
        <Legend keys={[{ key: "trawled", cls: "trawl" }, { key: "opted in", cls: "opted" }]} />
      </Fig>

      {anyTools ? (
        <>
          <h3 id="tools">Which tool gets the credit</h3>
          <p class="muted small">Listings whose paperwork or GitHub topics name that tool. A repo can name more than one, so the shares are of mentions, not of repos, and the ring is {toolsN.toLocaleString()} mentions over the whole run of the chart. <strong>Read this as how loudly each tool's users say its name in public</strong>, not as market share: the trawl searches grounds named after tools (<a href="/method">method</a>, bias 2), so a tool whose users never tag their repos is undercounted by construction.</p>
          <Fig cls="pair" caption={<>The columns are the same mentions {byThe}, each column at 100%. The number above a column is how many mentions it stands on: a tall-looking swing on a column of four is noise.</>}>
            <div>
              <h4>all of it</h4>
              <Donut slices={toolsTotal} hero={toolsTotal[0] ? pct(toolsTotal[0].n / toolsN) : ""} caption={toolsTotal[0]?.key ?? ""} title={`Which tool gets the credit, ${toolsN} mentions`} unit="" />
            </div>
            <div>
              <h4>{byThe}</h4>
              <ToolShare keys={d.tools.keys} months={toolSeries} />
            </div>
          </Fig>
        </>
      ) : null}

      {d.cloud.trawl.length + d.cloud.opted.length ? (
        <>
          <h3 id="topics">Topics, in the makers' own words</h3>
          <p class="muted small">Every GitHub topic on a listed repo, sized by how many carry it. These are labels the owner chose, not anything we inferred — which makes them the one free-vocabulary answer both cohorts give. Click any of them to see those repos.</p>
          {COHORTS.filter((c) => (d.totals[c]?.listed ?? 0) > 0).map((c) => (
            <>
              <div class="cohead"><i class={`swatch ${c}`}></i> {COHORT_LABEL[c]} <span class="muted">· {COHORT_SUB[c]} · {(d.totals[c]?.listed ?? 0).toLocaleString()} repos</span></div>
              <TagCloud rows={d.cloud[c]} of={d.totals[c]?.listed} />
            </>
          ))}
        </>
      ) : null}

      {shared.map((chart) => <FacetPair chart={chart} totals={d.totals} />)}

      {declaredOnly.length ? (
        <>
          <h3 id="paperwork">Questions only the paperwork can answer</h3>
          <p class="muted small">A trawled listing's disclosures are a template the Cap'm wrote from what GitHub shows, identical on every one of them, so the trawl has no opinion on any of these and is left out rather than drawn as a bar at 100%. What is left is the opted-in crowd talking about their own work — which is the most self-selected thing on the page and also the only place these answers exist at all. <a href="/orphanage">Why trawled listings carry a template</a>.</p>
          <div class="cohorts declared">
            {declaredOnly.map((chart) => <SoloChart chart={chart} of={o.listed} />)}
          </div>
        </>
      ) : null}

      <Pair id="age" title="How old it was when it turned up" note="Days between the repo being created on GitHub and being listed here." trawl={d.age.trawl} opted={d.age.opted} totals={d.totals} limit={6} />

      <Pair id="stars" title="Stars" note={`The trawl's window is ${STAR_WINDOW} by rule, so read the trawled column as a shape inside that window and nothing more.`} trawl={d.stars.trawl} opted={d.stars.opted} totals={d.totals} limit={6} />

      <h3 id="net">What the net throws back</h3>
      <p class="muted small">{netTotal ? <>Of {netTotal.toLocaleString()} candidates the trawl evaluated in the last 30 days and did not list, why. This is the most honest thing on the page about what is actually out there: the site only ever shows you the ones that got through.</> : <>Nothing evaluated in the last 30 days.</>}</p>
      <Bars rows={d.net} of={netTotal} wide tone="trawl" empty="The trawl has not been out lately." />

      {awayTotal ? (
        <>
          <h3 id="turned-away">What the trough turns away</h3>
          <p class="muted small">Of {awayTotal.toLocaleString()} repos that filed paperwork and did not get listed, the gate that stopped them. Every one of them has a public reason on its own page.</p>
          <Bars rows={d.turned_away} of={awayTotal} wide tone="opted" />
        </>
      ) : null}

      <p class="muted small">Counted from <a href="/stats">the same public numbers</a> everything else here runs on. The snapshot is rebuilt at 00:05 UTC; each night's rows are kept for 180 days. Want the raw table? <a href="/trends.json">/trends.json</a>.</p>
    </section>
  );
};

/** The dashboard as markdown, for agents and for anyone who would rather read numbers than bars. */
export function trendsMd(d: TrendsView): string {
  const t = d.totals.trawl ?? {};
  const o = d.totals.opted ?? {};
  const table = (rows: Bar[], of?: number) =>
    rows.length ? rows.slice(0, 10).map((r) => `- ${r.key}: ${r.n}${of ? ` (${pct(r.n / of)})` : ""}`) : ["- (nothing yet)"];
  const netTotal = d.net.reduce((s, r) => s + r.n, 0);
  const weekly = (d.listings_w ?? []).filter((m) => m.total);
  const weeklyTools = (d.tools_w?.months ?? []).filter((m) => m.total);
  return [
    "# Trends", "",
    `Snapshot ${d.date}. Recounted once a night from data the site already holds. No model is called to build this page; the two "what people are building" charts below count labels the trawl's classifier applied at pick time, and are the only numbers here that are a judgement rather than a count.`, "",
    "## The sample", "",
    ...(d.sea ? ["- **seen**: every repo the same searches return, at any star count and under any licence, counted from the search response alone. Never read, judged or listed. The water the trawled cohort is drawn from."] : []),
    `- **trawled**: found by us because the owner said in public that a model wrote it. Close to random within that label; ${MIN_STARS}-${MAX_STARS} stars, pushed within ${PUSHED_WITHIN_DAYS} days, permissive licence.`,
    "- **opted in**: committed a slopscore.md. Self-selected, and the only cohort that can answer a question a person had to answer.", "",
    "Method, frozen and versioned: /method. The weekly bulletin counted from these same snapshots: /report.", "",
    `| | trawled | opted in |`, `|---|---|---|`,
    `| listed | ${t.listed ?? 0} | ${o.listed ?? 0} |`,
    `| makers | ${t.owners ?? 0} | ${o.owners ?? 0} |`,
    `| new in 30 days | ${t.new_30d ?? 0} | ${o.new_30d ?? 0} |`,
    `| launched by owner | — | ${o.submitted ?? 0} |`,
    `| mean stars | ${t.mean_stars ?? 0} | ${o.mean_stars ?? 0} |`,
    `| mean score | ${t.mean_score ?? 0} | ${o.mean_score ?? 0} |`, "",
    ...(d.sea ? (() => {
      const s = d.sea;
      const n = s.totals.seen ?? 0;
      const share = (k: string) => pct(n ? (s.totals[k] ?? 0) / n : 0);
      return [
        "## The sea", "",
        `${n} repos seen in the last ${PUSHED_WITHIN_DAYS} days by the same searches with no star clause, counted from the search response alone (method v4). ${share("unstarred")} have no stars, ${share("unlicensed")} no licence, ${share("candidates")} would reach the judge under the trawl's rules. ${s.totals.owners ?? 0} owners; ${s.totals.new_30d ?? 0} first seen in the last 30 days.`, "",
        "Stars:", ...table(s.stars, n), "",
        "Licence:", ...table(s.licence, n), "",
        "What the trawl's rules would do (first rule that stops it):", ...table(s.sieve, n), "",
        "How long it lived, created to last push:", ...table(s.life, n), "",
        "Languages:", ...table(s.language, n), "",
        "Which tool the description credits (weaker than a README's sentence):", ...table(s.tool, n), "",
        "Which water it came up in:", ...table(s.ground, n), "",
        "Created per week:", ...s.born_w.map((w) => `- ${w.period}: ${w.n}`), "",
      ];
    })() : []),
    "## Listings by month", "",
    ...d.listings.map((m) => `- ${m.period}: ${m.total} (${m.trawl} trawled, ${m.opted} opted in)`), "",
    ...(weekly.length ? ["## Listings by week", "", ...weekly.map((m) => `- ${m.period}: ${m.total} (${m.trawl} trawled, ${m.opted} opted in)`), ""] : []),
    "## What people are actually building", "",
    `The trawl's classifier answers two closed-list questions about every candidate it sees, listed or not. ${d.use.n_listed + d.use.n_thrown_back} judged so far (${d.use.n_listed} listed, ${d.use.n_thrown_back} thrown back), which is a small sample: counts, not shares, are the honest number here.`, "",
    "What it is for:", ...table(d.use.all, d.use.n_listed + d.use.n_thrown_back), "",
    "What kind of thing it is:", ...table(d.verdict.all, d.verdict.n_listed + d.verdict.n_thrown_back), "",
    "## Topics, in the makers' own words", "",
    "GitHub topics the owners chose. Trawled:", ...table(d.cloud.trawl.slice(0, 30), t.listed), "",
    "Opted in:", ...table(d.cloud.opted.slice(0, 30), o.listed), "",
    "## Which tool gets the credit, by month", "",
    ...d.tools.months.filter((m) => m.total).map((m) => `- ${m.period}: ${m.parts.map((p) => `${p.key} ${pct(p.share)}`).join(", ")} (n=${m.total})`), "",
    ...(weeklyTools.length ? ["## Which tool gets the credit, by week", "", ...weeklyTools.map((m) => `- ${m.period}: ${m.parts.map((p) => `${p.key} ${pct(p.share)}`).join(", ")} (n=${m.total})`), ""] : []),
    ...d.facets.filter((f) => !TEMPLATED_ON_TRAWL.has(f.facet)).flatMap((f) => [
      `## ${FACET_TITLE[f.facet]} (${f.facet})`, "",
      "Trawled:", ...table(f.trawl, t.listed), "",
      "Opted in:", ...table(f.opted, o.listed), "",
    ]),
    "## Questions only the paperwork can answer", "",
    "A trawled listing's disclosures are a template, identical on every one of them, so only the opted-in cohort is counted here.", "",
    ...d.facets.filter((f) => TEMPLATED_ON_TRAWL.has(f.facet) && f.opted.length).flatMap((f) => [
      `### ${FACET_TITLE[f.facet]} (${f.facet})`, "", ...table(f.opted, o.listed), "",
    ]),
    "## What the net throws back", "",
    `Of ${netTotal} candidates evaluated in the last 30 days and not listed:`, "",
    ...table(d.net, netTotal), "",
  ].join("\n");
}
