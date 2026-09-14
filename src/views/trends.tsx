// The trends dashboard. Everything is drawn server-side out of one snapshot: CSS bars, CSS columns, no
// script tag, no chart library, no fetch. It prints, it works with JS off, and it costs one D1 query.
import type { FC } from "hono/jsx";
import { COHORTS, COHORT_LABEL, FACET_TITLE, TEMPLATED_ON_TRAWL, type Bar, type Cohort, type FacetChart, type JudgedChart, type ToolMonth, type TrendsView } from "../jobs/trends";
import { MIN_STARS, MAX_STARS, PUSHED_WITHIN_DAYS } from "../lib/virtual";

/** The trawl's own window, spelled out for the reader. Read off the constants the trawl actually filters on
 *  (../lib/virtual), so loosening the floor to one star rewrites the page instead of leaving it lying. */
const STAR_WINDOW = `${MIN_STARS.toLocaleString("en-US")} to ${MAX_STARS.toLocaleString("en-US")}`;

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
/**
 * A month as "Sep", with the year appended only where it changes so the axis does not repeat 2026 twelve times.
 * The year is its own span: on a phone it is hidden, which shortens every label enough to stop the axis rotating.
 */
const MonthLabel: FC<{ period: string; prev?: string }> = ({ period, prev }) => {
  const [y, m] = period.split("-");
  const name = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m)] ?? m;
  return <>{name}{prev && prev.slice(0, 4) === y ? null : <span class="yr"> ’{y.slice(2)}</span>}</>;
};

/** One horizontal bar chart. `of` is the denominator the share is quoted against, when there is a sensible one. */
export const Bars: FC<{ rows: Bar[]; of?: number; limit?: number; empty?: string; wide?: boolean; counts?: boolean }> = ({ rows, of, limit = 10, empty, wide, counts }) => {
  if (!rows.length) return <p class="muted small">{empty ?? "Nothing here yet."}</p>;
  return (
    <div class={`bars${wide ? " wide" : ""}${counts ? " withn" : ""}`}>
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
 * The same question asked of both cohorts, side by side. The gap between the columns is the actual finding —
 * so when one cohort is empty (a site that has never run the trawl) the chart drops to one column rather than
 * spending half its width saying "nothing here yet" fifteen times.
 */
const Pair: FC<{ title: string; sub?: string; note?: string; trawl: Bar[]; opted: Bar[]; totals: Record<Cohort, Record<string, number>>; limit?: number }> = ({ title, sub, note, trawl, opted, totals, limit }) => {
  const show: Cohort[] = COHORTS.filter((c) => (totals[c]?.listed ?? 0) > 0);
  const cols = show.length ? show : ["opted" as Cohort];
  return (
    <div class="chart">
      <h3>{title} {sub ? <span class="muted">· {sub}</span> : null}</h3>
      {note ? <p class="muted small">{note}</p> : null}
      <div class={cols.length > 1 ? "cohorts" : ""}>
        {cols.map((c) => (
          <div>
            <div class="cohead">{COHORT_LABEL[c]} <span class="muted">· {c === "trawl" ? "the net's sample" : "they filed the paperwork"}</span></div>
            <Bars rows={c === "trawl" ? trawl : opted} of={totals[c]?.listed} limit={limit} empty="Nothing declared here yet." />
          </div>
        ))}
      </div>
    </div>
  );
};

const FacetPair: FC<{ chart: FacetChart; totals: Record<Cohort, Record<string, number>> }> = ({ chart, totals }) => (
  <Pair title={FACET_TITLE[chart.facet]} sub={chart.facet} trawl={chart.trawl} opted={chart.opted} totals={totals} />
);

/** A facet the trawl cannot answer: one column, and the caveat is carried by the section it sits in. */
const SoloChart: FC<{ chart: FacetChart; of?: number }> = ({ chart, of }) => (
  <div>
    <div class="cohead">{FACET_TITLE[chart.facet]} <span class="muted">· {chart.facet}</span></div>
    <Bars rows={chart.opted} of={of} limit={8} />
  </div>
);

/** A column chart of counts. Heights are relative to the busiest month; the number sits above the column. */
const Columns: FC<{ rows: { period: string; total: number; parts?: { key: string; n: number }[] }[]; keyed?: string[] }> = ({ rows, keyed }) => {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div class="cols">
      {rows.map((r, i) => (
        <div class="col">
          <span class="coln">{r.total || ""}</span>
          <span class="colstack" style={`height:${pct(r.total / max)}`}>
            {(r.parts ?? []).map((p) => (
              <i class={`seg c${((keyed?.indexOf(p.key) ?? 0) % 7) + 1}`} style={`flex:${p.n}`} title={`${p.key}: ${p.n}`}></i>
            ))}
          </span>
          <span class="collabel"><MonthLabel period={r.period} prev={rows[i - 1]?.period} /></span>
        </div>
      ))}
    </div>
  );
};

/** Share of the credit, month by month: each column is one month at 100%, stacked by tool. */
const ToolShare: FC<{ keys: string[]; months: ToolMonth[] }> = ({ keys, months }) => (
  <>
    <div class="cols tall">
      {months.map((m, i) => (
        <div class="col">
          <span class="coln">{m.total || ""}</span>
          <span class={`colstack${m.total ? "" : " ghost"}`} style="height:100%">
            {m.parts.map((p) => (
              <i class={`seg c${(keys.indexOf(p.key) % 7) + 1}`} style={`flex:${p.n}`} title={`${m.period} · ${p.key}: ${p.n} of ${m.total} (${pct(p.share)})`}></i>
            ))}
          </span>
          <span class="collabel"><MonthLabel period={m.period} prev={months[i - 1]?.period} /></span>
        </div>
      ))}
    </div>
    <p class="legend">{keys.map((k, i) => <span class="lkey"><i class={`swatch c${(i % 7) + 1}`}></i>{k}</span>)}</p>
  </>
);

export const Trends: FC<{ d: TrendsView }> = ({ d }) => {
  const t = d.totals.trawl ?? {};
  const o = d.totals.opted ?? {};
  const listedTotal = (t.listed ?? 0) + (o.listed ?? 0);
  const netTotal = d.net.reduce((s, r) => s + r.n, 0);
  const awayTotal = d.turned_away.reduce((s, r) => s + r.n, 0);
  // Facets the trawl can answer are drawn as a comparison; the rest are grouped under one caveat instead of
  // repeating "not asked" down half the page.
  const judgedTotal = d.use.n_listed + d.use.n_thrown_back;
  const shared = d.facets.filter((f) => !TEMPLATED_ON_TRAWL.has(f.facet));
  const declaredOnly = d.facets.filter((f) => TEMPLATED_ON_TRAWL.has(f.facet) && f.opted.length);
  return (
    <section class="wrap narrow dash" style="padding:0">
      <h2>Trends</h2>
      <p class="muted">What {listedTotal.toLocaleString()} listings look like when you stand back from them. Recounted once a night from data the site already holds. Nothing is sent to a model to build this page; two charts count labels a model already applied during the trawl, and say so. Snapshot: <strong>{d.date}</strong>. Also <a href="/trends.json">.json</a> and <a href="/trends.md">.md</a>.</p>

      <div class="capacity">
        <div><span class="label">trawled</span><strong>{(t.listed ?? 0).toLocaleString()}</strong> listings · {(t.owners ?? 0).toLocaleString()} makers · <strong>{t.new_30d ?? 0}</strong> in 30 days</div>
        <div><span class="label">opted in</span><strong>{(o.listed ?? 0).toLocaleString()}</strong> listings · {(o.owners ?? 0).toLocaleString()} makers · <strong>{o.new_30d ?? 0}</strong> in 30 days</div>
        <div><span class="label">launched by their owner</span><strong>{(o.submitted ?? 0).toLocaleString()}</strong> <span class="muted">of the opted-in ones</span></div>
        <div><span class="label">has a demo link</span><strong>{o.with_demo ?? 0}</strong> opted in · <strong>{t.with_demo ?? 0}</strong> trawled</div>
        <div><span class="label">mean stars</span><strong>{t.mean_stars ?? 0}</strong> trawled · <strong>{o.mean_stars ?? 0}</strong> opted in</div>
        <div><span class="label">mean score here</span><strong>{t.mean_score ?? 0}</strong> trawled · <strong>{o.mean_score ?? 0}</strong> opted in</div>
      </div>

      <div class="note">
        <h3>Read this first, or you will read the charts wrong</h3>
        <p class="small"><strong>Trawled</strong> repos never asked to be here. The Cap'm found them because their owner said in public, in the past tense, that a model wrote the thing — then a cheap classifier checked it was software rather than a blog post about software. Nothing else was selected for, so as a sample of <em>publicly self-declared AI-written software</em> it is about as close to random as this gets. It is <em>not</em> a sample of AI-written software: most of that is never labelled, and the label is the only thing we can see.</p>
        <p class="small"><strong>Opted-in</strong> repos committed a <a href="/spec">slopscore.md</a>. That is a person choosing to file paperwork about their own work, which is self-selection with a capital S. Their column tells you about people who volunteer, and it is the only column that can answer a question the maker had to answer themselves.</p>
        <p class="small">Two more ropes on the sample: the trawl only looks at repos with {STAR_WINDOW} stars, pushed in the last {PUSHED_WITHIN_DAYS} days, under a licence permissive enough to quote from. So the ends of the star chart are a rule of ours, not a fact about the world.</p>
        <p class="small">Two of the charts below — what the software is <em>for</em>, and what kind of thing it is — are a <strong>model's</strong> labels rather than a maker's, picked off a fixed list by the classifier the trawl already runs (<a href="/about">how that works</a>). They are the only numbers here that are somebody's opinion, they are marked where they appear, and they are the only way to ask that question of a sample nobody volunteered for. Everything else on this page is counted, not judged.</p>
        <p class="small">All of that, and the biases we know about, written down in one frozen and versioned place: <a href="/method">how we count</a>. The same numbers once a week, as a document you can cite after this snapshot has been pruned: <a href="/report">the Trawl Report</a>.</p>
      </div>

      <h3>How much comes in, month by month</h3>
      <p class="muted small">Listings by the month they went up, trawled and opted-in stacked together. The trawl releases a fixed number a day, so this line is mostly a picture of our own throttle — it is here so the shape of everything below has a denominator.</p>
      <Columns rows={d.listings.map((m) => ({ period: m.period, total: m.total, parts: [{ key: "opted", n: m.opted }, { key: "trawl", n: m.trawl }] }))} keyed={["opted", "trawl"]} />
      <p class="legend"><span class="lkey"><i class="swatch c1"></i>opted in</span><span class="lkey"><i class="swatch c2"></i>trawled</span></p>

      {d.tools.months.some((m) => m.total) ? (
        <>
          <h3>Which tool gets the credit, month by month</h3>
          <p class="muted small">Share of the listings added each month whose paperwork or GitHub topics name that tool. A repo can name more than one, so the shares are of mentions, not of repos. The number above each column is how many mentions it stands on: a tall-looking swing on a column of four is noise.</p>
          <ToolShare keys={d.tools.keys} months={d.tools.months} />
        </>
      ) : null}

      {judgedTotal ? (
        <>
          <h3>What people are actually building</h3>
          <p class="muted small">The trawl pays a cheap classifier to look at every candidate before deciding whether to list it (<a href="/about">how that works</a>). It answers with two values off two fixed lists — never a sentence — and both answers are now kept, for the ones it let through <em>and</em> the ones it threw back. That second group is the larger and more interesting half: it is everything that looked the part and did not make it, and it never reaches the feed.</p>
          <p class="muted small">This is the only near-random read this site has on what these tools are being pointed at, and it is still a <strong>small</strong> one — {judgedTotal.toLocaleString()} repos judged so far. Counts are printed beside every share for that reason. A bar standing on single digits is an anecdote with a percentage sign on it.</p>
          <Judged c={d.use} />

          <h3>…and what kind of thing it turned out to be</h3>
          <p class="muted small">The same classifier's other answer. Only the first five are listable; the rest are the reasons a candidate gets put back over the side, so the "thrown back" column is mostly those by construction.</p>
          <Judged c={d.verdict} />
        </>
      ) : null}

      {d.cloud.trawl.length + d.cloud.opted.length ? (
        <>
          <h3>Topics, in the makers' own words</h3>
          <p class="muted small">Every GitHub topic on a listed repo, sized by how many carry it. These are labels the owner chose, not anything we inferred — which makes them the one free-vocabulary answer both cohorts give. Click any of them to see those repos.</p>
          {COHORTS.filter((c) => (d.totals[c]?.listed ?? 0) > 0).map((c) => (
            <>
              <div class="cohead">{COHORT_LABEL[c]} <span class="muted">· {c === "trawl" ? "the net's sample" : "they filed the paperwork"} · {(d.totals[c]?.listed ?? 0).toLocaleString()} repos</span></div>
              <TagCloud rows={d.cloud[c]} of={d.totals[c]?.listed} />
            </>
          ))}
        </>
      ) : null}

      {shared.map((chart) => <FacetPair chart={chart} totals={d.totals} />)}

      {declaredOnly.length ? (
        <>
          <h3>Questions only the paperwork can answer</h3>
          <p class="muted small">A trawled listing's disclosures are a template the Cap'm wrote from what GitHub shows, identical on every one of them, so the trawl has no opinion on any of these and is left out rather than drawn as a bar at 100%. What is left is the opted-in crowd talking about their own work — which is the most self-selected thing on the page and also the only place these answers exist at all. <a href="/orphanage">Why trawled listings carry a template</a>.</p>
          <div class="cohorts declared">
            {declaredOnly.map((chart) => <SoloChart chart={chart} of={o.listed} />)}
          </div>
        </>
      ) : null}

      <Pair title="How old it was when it turned up" note="Days between the repo being created on GitHub and being listed here." trawl={d.age.trawl} opted={d.age.opted} totals={d.totals} limit={6} />

      <Pair title="Stars" note={`The trawl's window is ${STAR_WINDOW} by rule, so read the trawled column as a shape inside that window and nothing more.`} trawl={d.stars.trawl} opted={d.stars.opted} totals={d.totals} limit={6} />

      <h3>What the net throws back</h3>
      <p class="muted small">{netTotal ? <>Of {netTotal.toLocaleString()} candidates the trawl evaluated in the last 30 days and did not list, why. This is the most honest thing on the page about what is actually out there: the site only ever shows you the ones that got through.</> : <>Nothing evaluated in the last 30 days.</>}</p>
      <Bars rows={d.net} of={netTotal} wide empty="The trawl has not been out lately." />

      {awayTotal ? (
        <>
          <h3>What the trough turns away</h3>
          <p class="muted small">Of {awayTotal.toLocaleString()} repos that filed paperwork and did not get listed, the gate that stopped them. Every one of them has a public reason on its own page.</p>
          <Bars rows={d.turned_away} of={awayTotal} wide />
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
  return [
    "# Trends", "",
    `Snapshot ${d.date}. Recounted once a night from data the site already holds. No model is called to build this page; the two "what people are building" charts below count labels the trawl's classifier applied at pick time, and are the only numbers here that are a judgement rather than a count.`, "",
    "## The sample", "",
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
    "## Listings by month", "",
    ...d.listings.map((m) => `- ${m.period}: ${m.total} (${m.trawl} trawled, ${m.opted} opted in)`), "",
    "## What people are actually building", "",
    `The trawl's classifier answers two closed-list questions about every candidate it sees, listed or not. ${d.use.n_listed + d.use.n_thrown_back} judged so far (${d.use.n_listed} listed, ${d.use.n_thrown_back} thrown back), which is a small sample: counts, not shares, are the honest number here.`, "",
    "What it is for:", ...table(d.use.all, d.use.n_listed + d.use.n_thrown_back), "",
    "What kind of thing it is:", ...table(d.verdict.all, d.verdict.n_listed + d.verdict.n_thrown_back), "",
    "## Topics, in the makers' own words", "",
    "GitHub topics the owners chose. Trawled:", ...table(d.cloud.trawl.slice(0, 30), t.listed), "",
    "Opted in:", ...table(d.cloud.opted.slice(0, 30), o.listed), "",
    "## Which tool gets the credit, by month", "",
    ...d.tools.months.filter((m) => m.total).map((m) => `- ${m.period}: ${m.parts.map((p) => `${p.key} ${pct(p.share)}`).join(", ")} (n=${m.total})`), "",
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
