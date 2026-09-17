// The Trawl Report as a page.
//
// The bulletin's prose is frozen markdown (jobs/report.ts writes it once and never again), and this file never
// rewrites a word of it. What it adds is drawn from the `data` column frozen beside it: a masthead with the
// headline numbers, a ring for the judge's verdict, and a movers chart under each counted section, laid around
// the prose rather than in place of it. The prose lists stay: they are the citable record, and the table view
// every figure needs. A week whose data will not parse renders exactly as it did before this file existed.
import type { FC } from "hono/jsx";
import { parseJson } from "../lib/db";
import { renderMarkdown } from "../lib/markdown";
import { LISTABLE_CODES } from "../lib/method";
import { isoDateTime, weekStart } from "../lib/time";
import { COHORT_LABEL, type Cohort } from "../jobs/trends";
import type { ArchiveRow, Move, ReportRow, ReportView, Section } from "../jobs/report";
import { Donut, Fig, Kpi, Kpis, Movers, Sparkline, SplitBar, Swings, OTHER_CLASS, donutSlices, pct, slotClass, type Slice, type Swing } from "./charts";

/** The frozen markdown split at its `## ` headings. The preamble comes first, with no heading. */
export function splitSections(body: string): { heading: string | null; md: string }[] {
  const out: { heading: string | null; md: string }[] = [];
  let heading: string | null = null;
  let buf: string[] = [];
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const h = /^## (.+?)\s*$/.exec(line);
    if (h) {
      out.push({ heading, md: buf.join("\n").trim() });
      heading = h[1];
      buf = [];
    } else buf.push(line);
  }
  out.push({ heading, md: buf.join("\n").trim() });
  return out;
}

const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** "Week 37 of 2026 · 7 to 13 September", or the slug when it is not one. */
export function weekText(slug: string): string {
  const monday = weekStart(slug);
  if (monday == null) return slug;
  const long = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const a = new Date(monday * 1000);
  const b = new Date((monday + 6 * 86400) * 1000);
  const span = a.getUTCMonth() === b.getUTCMonth()
    ? `${a.getUTCDate()} to ${b.getUTCDate()} ${long[a.getUTCMonth()]}`
    : `${a.getUTCDate()} ${long[a.getUTCMonth()]} to ${b.getUTCDate()} ${long[b.getUTCMonth()]}`;
  return `Week ${Number(slug.slice(6))} of ${slug.slice(0, 4)} · ${span}`;
}

/** The judge's codes as a ring: listable ones in their own fixed colours, everything thrown back in one grey slice. */
export function verdictSlices(codes: Move[]): Slice[] {
  const listable = (LISTABLE_CODES as readonly string[]);
  const kept = codes.filter((m) => listable.includes(m.key)).map((m) => ({ key: m.key, n: m.n, cls: slotClass(listable.indexOf(m.key)) }));
  const thrown = codes.filter((m) => !listable.includes(m.key)).reduce((s, m) => s + m.n, 0);
  return thrown ? [...kept, { key: "thrown back", n: thrown, cls: OTHER_CLASS }] : kept;
}

/** A section's rows as a ring: six named slices and the grey fold, in the section's own order (biggest first). */
const sectionSlices = (s: Section): Slice[] => donutSlices(s.rows);

/**
 * A counted section as a card: the ring on the left says what the pile is made of, the movers on the right say
 * what changed. The bar is this week, the hollow marker is last week, the chip is the distance in points.
 */
const SectionFig: FC<{ v: ReportView; s: Section; slices?: Slice[]; hero?: string; caption?: string; what: string; ringTitle: string; rows?: Section["rows"] }> = ({ v, s, slices, hero, caption, what, ringTitle, rows }) => {
  if (!s.total) return null;
  const sl = slices ?? sectionSlices(s);
  const top = sl[0];
  return (
    <Fig cls="pair" caption={<>{s.total.toLocaleString()} {what} in the {COHORT_LABEL[s.cohort as Cohort] ?? s.cohort} sample.{v.first ? " The first bulletin, so there is nothing to move from yet." : " In what moved, the bar is this week, the hollow marker is where it stood a week ago, and the chip is the distance in share points."}</>}>
      <div>
        <h4>the pile</h4>
        <Donut slices={sl} hero={hero ?? (top ? pct(top.n / s.total) : "")} caption={caption ?? (top && top.key.length <= 16 ? top.key : "the biggest slice")} title={ringTitle} size={160} />
      </div>
      <div>
        <h4>{v.first ? "where they stand" : "what moved"}</h4>
        <Movers rows={rows ?? s.rows} first={v.first} tone={s.cohort === "opted" ? "opted" : ""} />
      </div>
    </Fig>
  );
};

/** The judge's verdict: the same card, but the ring keeps the five listable codes apart from everything thrown back. */
const SoftwareFig: FC<{ v: ReportView }> = ({ v }) => {
  if (!v.judged.seen) return null;
  const s: Section = { cohort: "trawl", total: v.judged.seen, was_total: v.judged.was_seen, rows: v.judged.codes };
  return (
    <>
      <SectionFig v={v} s={s} slices={verdictSlices(v.judged.codes)} hero={pct(v.judged.software_share)} caption="software somebody made" what="candidates judged" ringTitle={`What the judge saw over ${v.judged.seen} candidates`} />
      <p class="muted small">One population, both halves: everything the judge was paid to look at, whether it was listed or not. The five listable codes keep their own colours; every reason to throw a candidate back shares the grey slice. These are a <strong>model's</strong> labels from a closed list, not a maker's own words.</p>
    </>
  );
};

/** The trough as one bar: how much of the pile was dragged in and how much walked in. */
const TroughFig: FC<{ v: ReportView }> = ({ v }) => (
  v.totals.listed ? (
    <Fig caption={<>Every listing, by how it got here. The purple sliver is the only part of the site anyone volunteered for.</>}>
      <SplitBar title={`${v.totals.listed} listings: ${v.totals.trawl} trawled, ${v.totals.opted} opted in`} parts={[{ key: "trawled", n: v.totals.trawl, cls: "trawl" }, { key: "opted in", n: v.totals.opted, cls: "opted" }]} />
    </Fig>
  ) : null
);

/** Everything that moved this week, every section together, biggest swing first. Never on a first bulletin. */
export function swingsOf(v: ReportView): Swing[] {
  if (v.first) return [];
  const from = (rows: Section["rows"], group: string): Swing[] => rows.filter((m) => m.points != null).map((m) => ({ key: m.key, group, points: m.points! }));
  return [...from(v.tools.rows, "tool"), ...from(v.languages.rows, "language"), ...from(v.judged.codes, "verdict"), ...from(v.net.rows, "thrown back")];
}

const SwingsFig: FC<{ v: ReportView }> = ({ v }) => {
  const rows = swingsOf(v).filter((r) => Math.abs(r.points) >= 0.005);
  if (!rows.length) return null;
  return (
    <>
      <h2 id="biggest-swings">Biggest swings this week</h2>
      <Fig caption={<>Share points gained or lost against last week's snapshot, across every counted section. Pink went up, purple went down; the number is the move, not the size. A big swing on a small section is the mix changing, not the world.</>}>
        <Swings rows={rows} />
      </Fig>
    </>
  );
};

/**
 * Which figure goes under which heading, keyed by the heading text jobs/report.ts writes. A heading with no
 * figure is listed as null on purpose: the test that every heading reportMd emits is a key here is what stops
 * a rename in report.ts from silently losing a chart. A heading this map has never heard of (an old week
 * written under different words) simply renders as prose.
 */
export const SECTION_FIGURES: Record<string, FC<{ v: ReportView }> | null> = {
  "The trough": TroughFig,
  "How much of it is software": SoftwareFig,
  "Which tool gets the credit": ({ v }) => <SectionFig v={v} s={v.tools} what="credits" ringTitle={`Which tool gets the credit, ${v.tools.total} credits`} />,
  "What it is written in": ({ v }) => <SectionFig v={v} s={v.languages} what="language credits" ringTitle={`What it is written in, ${v.languages.total} language credits`} />,
  "What the net threw back": ({ v }) => <SectionFig v={v} s={v.net} what="candidates thrown back in 30 days" ringTitle={`What the net threw back, ${v.net.total} candidates`} />,
  "The small print": null,
};

/** True when the frozen JSON is a bulletin this page knows how to draw. Anything else falls back to the prose. */
export function readView(row: ReportRow): ReportView | null {
  const v = parseJson<Partial<ReportView> | null>(row.data, null);
  return v && v.totals && v.judged && v.tools && v.languages && v.net ? (v as ReportView) : null;
}

const Masthead: FC<{ row: ReportRow; v: ReportView }> = ({ row, v }) => (
  <>
    <header class="masthead">
      <span class="kicker">The Trawl Report · {row.slug}</span>
      <h1>{weekText(row.slug)}</h1>
      {/* Only what the frozen prose underneath does not already say: the snapshot dates are its first sentence. */}
      <p class="meta">Written {isoDateTime(row.at)} · method v{v.method}{v.since ? null : " · the first one, so nothing here moves yet"} · counted, never generated</p>
    </header>
    <Kpis>
      <Kpi label="listed" value={v.totals.listed} delta={v.totals.added} since="this week" sub={`across ${v.totals.owners.toLocaleString()} owners`} />
      <Kpi label="trawled" value={v.totals.trawl} delta={v.totals.added_trawl} sub={<><i class="swatch trawl"></i> dragged out of public GitHub; nobody submitted them</>} />
      <Kpi label="opted in" value={v.totals.opted} delta={v.totals.added_opted} sub={<><i class="swatch opted"></i> committed a slopscore.md and asked to be counted</>} />
      <Kpi label="the judge has seen" value={v.judged.seen} delta={v.judged.was_seen == null ? null : v.judged.seen - v.judged.was_seen} since="this week" sub={v.judged.seen ? `${pct(v.judged.software_share)} was software somebody made` : "nothing yet, so no pass rate"} />
    </Kpis>
  </>
);

/** Every bulletin so far, newest first, with the number each one led with; and the line they draw once there are enough. */
export const ReportArchive: FC<{ rows: ArchiveRow[]; current?: string }> = ({ rows, current }) => {
  if (rows.length < 2) return null;
  const oldest = [...rows].reverse();
  const listed = oldest.map((r) => r.listed).filter((x): x is number => x != null);
  const share = oldest.map((r) => r.software_share).filter((x): x is number => x != null);
  return (
    <>
      <h3>Every bulletin</h3>
      {rows.length >= 3 ? (
        <div class="sparks">
          {listed.length >= 3 ? <div><span class="label">repos listed, week by week</span><Sparkline values={listed} title={`Repos listed, oldest to newest: ${listed.join(", ")}`} /></div> : null}
          {share.length >= 3 ? <div><span class="label">share of the pile that was software</span><Sparkline values={share} title={`Software share, oldest to newest: ${share.map(pct).join(", ")}`} /></div> : null}
        </div>
      ) : null}
      <div class="archive">
        {rows.map((r) => {
          const inner = (
            <>
              <span class="slug">{r.slug}</span>
              <span class="muted">{r.listed == null ? `method v${r.method}` : `${r.listed.toLocaleString()} listed${r.added == null ? "" : ` (${r.added > 0 ? "+" : ""}${r.added})`}`}</span>
              {r.software_share != null ? <span class="muted">{pct(r.software_share)} software</span> : null}
            </>
          );
          return r.slug === current ? <span class="now" aria-current="page">{inner}</span> : <a href={`/report/${r.slug}`}>{inner}</a>;
        })}
      </div>
    </>
  );
};

/**
 * Where to subscribe, when there is somewhere.
 *
 * A link, not a form. The site keeps no mailing list and never asks for an address: somebody else operates the
 * newsletter, handles the unsubscribe, and carries the compliance, and this page's whole job is to hand the
 * reader over to them. Unset NEWSLETTER_URL and the line disappears; the bulletin is still published and still
 * on RSS, which is the channel that needs nobody's permission.
 */
export const Subscribe: FC<{ list: { url: string; name: string } | null }> = ({ list }) => (
  <p class="muted small">
    Get it weekly: {list ? <><a href={list.url} rel="noopener">{list.name}</a> by email, or </> : null}
    <a href="/report.xml">RSS</a>. Free, and it stays free — it is how the numbers get cited, not how they get sold.
    {list ? <> We never see your address: the list lives with them, not here.</> : null}
  </p>
);

/** One bulletin: the frozen prose, with the figures its frozen numbers allow laid around it. Never re-derived. */
export const ReportPage: FC<{ row: ReportRow; archive: ArchiveRow[]; list: { url: string; name: string } | null }> = ({ row, archive, list }) => {
  const v = readView(row);
  return (
    <section class="wrap narrow report" style="padding:0">
      {v ? (
        <>
          <Masthead row={row} v={v} />
          <SwingsFig v={v} />
          {splitSections(row.body).map(({ heading, md }) => {
            if (heading == null) return <div dangerouslySetInnerHTML={{ __html: renderMarkdown(md.replace(/^# [^\n]*\n?/, "")) }} />;
            const Figure = SECTION_FIGURES[heading] ?? null;
            return (
              <>
                <h2 id={slugify(heading)}>{heading}</h2>
                {Figure ? <Figure v={v} /> : null}
                <div dangerouslySetInnerHTML={{ __html: renderMarkdown(md) }} />
              </>
            );
          })}
        </>
      ) : (
        <div dangerouslySetInnerHTML={{ __html: renderMarkdown(row.body) }} />
      )}
      <Subscribe list={list} />
      <p class="muted small">
        Written {isoDateTime(row.at)} · method v{row.method} · <a href={`/report/${row.slug}.md`}>markdown</a> · <a href={`/report/${row.slug}.json`}>the numbers</a> · <a href="/report.xml">RSS</a> · <a href="/trends">the live dashboard</a>
      </p>
      <ReportArchive rows={archive} current={row.slug} />
    </section>
  );
};
