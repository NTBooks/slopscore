// The chart primitives /trends and /report draw with.
//
// Inline SVG for the marks and plain HTML for every word and number. No script, no library, no fetch: the
// pages print, work with JavaScript off, and cost the same one query they always did. Text stays out of the
// SVG on purpose -- an SVG stretched to the column would scale an 8px label to a headline, and a number in
// HTML can be selected, wrapped on a phone and read by a screen reader without any of that.
//
// Colour is by class, never by presentation attribute: `.slice.c3 { stroke: var(--c3) }` in style.css
// follows the dark-mode token flip for free, and `fill="var(--c3)"` on the element would not.
import type { Child, FC, PropsWithChildren } from "hono/jsx";
import { weekStart } from "../lib/time";

export const pct = (x: number) => `${Math.round(x * 1000) / 10}%`;
/** Two decimals: hono/jsx prints numbers raw, and `33.333333333333336` in a path is noise in every diff. */
const r2 = (n: number) => Math.round(n * 100) / 100;

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// ---- palette ----

/** Named series take slots 1..6 in a fixed order; the fold bucket is always the grey seventh, whatever its size. */
export const SERIES_SLOTS = 6;
export const OTHER_CLASS = "c7";
export const slotClass = (i: number) => `c${Math.min(i, SERIES_SLOTS - 1) + 1}`;

// ---- geometry (pure, tested) ----

export interface Slice { key: string; n: number; cls: string }

/**
 * Fold rows to at most `max` named slices plus one "other". The caller's order is kept (biggest first is the
 * usual) and the sum is preserved, so a share read off the ring is a share of the whole sample.
 */
export function donutSlices<T extends { key: string; n: number }>(rows: T[], max = SERIES_SLOTS, cls: (row: T, i: number) => string = (_r, i) => slotClass(i)): Slice[] {
  const out: Slice[] = rows.slice(0, max).map((r, i) => ({ key: r.key, n: r.n, cls: cls(r, i) }));
  const other = rows.slice(max).reduce((s, r) => s + r.n, 0);
  if (other > 0) out.push({ key: "other", n: other, cls: OTHER_CLASS });
  return out;
}

/** An SVG arc along a circle of radius `r`; angles in radians, clockwise from twelve o'clock. */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => `${r2(cx + r * Math.sin(a))} ${r2(cy - r * Math.cos(a))}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(a0)}A${r} ${r} 0 ${large} 1 ${p(a1)}`;
}

export interface Arc extends Slice { share: number; /** null: the whole ring, drawn as a circle, since an arc from a point to itself draws nothing */ d: string | null }

/** The ring's slices as arcs, with `gap` units of surface between neighbours. Zero-count slices are dropped. */
export function donutArcs(slices: Slice[], r: number, gap = 2, cx = 60, cy = 60): Arc[] {
  const live = slices.filter((s) => s.n > 0);
  const total = live.reduce((s, x) => s + x.n, 0);
  if (!total) return [];
  if (live.length === 1) return [{ ...live[0], share: 1, d: null }];
  const g = gap / r;
  let a = 0;
  return live.map((s) => {
    const ang = (s.n / total) * 2 * Math.PI;
    // A sliver keeps its whole angle rather than being trimmed out of existence by its own gaps.
    const trim = ang > g * 2 ? g / 2 : 0;
    const d = arcPath(cx, cy, r, a + trim, a + ang - trim);
    a += ang;
    return { ...s, share: s.n / total, d };
  });
}

/** A polyline through `values` (oldest first) fitted to a w×h box, flat at mid-height when every value is equal. */
export function sparkPath(values: number[], w = 100, h = 24, pad = 2): string {
  if (values.length < 2) return "";
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo || 1;
  const step = (w - pad * 2) / (values.length - 1);
  return values.map((v, i) => `${i ? "L" : "M"}${r2(pad + i * step)} ${r2(hi === lo ? h / 2 : pad + (1 - (v - lo) / span) * (h - pad * 2))}`).join("");
}

export { pickGrain } from "../jobs/trends";

// ---- axis labels ----

/**
 * A period on an axis: "Sep" for a month, "7 Sep" (its Monday) for an ISO week, with the year appended only
 * where it changes so the axis does not repeat 2026 twelve times. The year is its own span: on a phone it is
 * hidden, which shortens every label enough to stop the axis rotating.
 */
export const PeriodLabel: FC<{ period: string; prev?: string }> = ({ period, prev }) => {
  const year = (p: string) => p.slice(0, 4);
  const yr = prev && year(prev) === year(period) ? null : <span class="yr"> ’{year(period).slice(2)}</span>;
  const monday = weekStart(period);
  if (monday != null) {
    const d = new Date(monday * 1000);
    return <>{d.getUTCDate()} {MONTHS[d.getUTCMonth() + 1]}{yr}</>;
  }
  const m = Number(period.slice(5, 7));
  return <>{MONTHS[m] ?? period}{yr}</>;
};

/** A period spelled out for a tooltip: "the week of 7 Sep 2026" or "September 2026". */
export function periodText(period: string): string {
  const monday = weekStart(period);
  if (monday != null) {
    const d = new Date(monday * 1000);
    return `the week of ${d.getUTCDate()} ${MONTHS[d.getUTCMonth() + 1]} ${d.getUTCFullYear()}`;
  }
  const m = Number(period.slice(5, 7));
  return MONTHS[m] ? `${["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][m]} ${period.slice(0, 4)}` : period;
}

// ---- components ----

/** A figure with an optional caption underneath. The heading and the prose around it belong to the page. */
export const Fig: FC<PropsWithChildren<{ caption?: Child; cls?: string }>> = ({ caption, cls, children }) => (
  <figure class={`fig${cls ? ` ${cls}` : ""}`}>
    {children}
    {caption ? <figcaption class="muted small">{caption}</figcaption> : null}
  </figure>
);

/** The legend every multi-series chart carries: one swatch and one name per series, in slot order. */
export const Legend: FC<{ keys: { key: string; cls: string }[] }> = ({ keys }) => (
  <p class="legend">{keys.map((k) => <span class="lkey"><i class={`swatch ${k.cls}`}></i>{k.key}</span>)}</p>
);

/** The headline row. A handful of numbers, each with its label and, where there is a week before, its move. */
export const Kpis: FC<PropsWithChildren> = ({ children }) => <div class="kpis">{children}</div>;

export const Kpi: FC<{ label: string; value: string | number; delta?: number | null; since?: string; sub?: Child; title?: string }> = ({ label, value, delta, since, sub, title }) => (
  <div class="kpi" title={title}>
    <span class="label">{label}</span>
    <strong class="value">{typeof value === "number" ? value.toLocaleString("en-US") : value}</strong>
    {delta != null ? <Delta n={delta} text={`${delta > 0 ? "+" : delta < 0 ? "−" : "±"}${Math.abs(delta).toLocaleString("en-US")}${since ? ` ${since}` : ""}`} /> : null}
    {sub ? <span class="sub">{sub}</span> : null}
  </div>
);

/** A movement chip. The sign picks the colour; the text is the caller's, so "+2 this week" and "+1.4 pts" share one look. */
export const Delta: FC<{ n: number; text: string }> = ({ n, text }) => (
  <span class={`delta ${n > 0 ? "up" : n < 0 ? "down" : "flat"}`}>{text}</span>
);

/**
 * A ring. Part-to-whole at a glance, six slices at most plus the grey fold, a hero number in the middle and
 * the same numbers as text beside it -- the legend is the table view, not decoration.
 */
export const Donut: FC<{ slices: Slice[]; hero: Child; caption: Child; title: string; size?: number; unit?: string; empty?: string }> = ({ slices, hero, caption, title, size = 150, unit = "", empty = "Nothing here yet." }) => {
  const arcs = donutArcs(slices, 46);
  if (!arcs.length) return <p class="muted small">{empty}</p>;
  const label = (a: Arc) => `${a.key}: ${a.n}${unit} (${pct(a.share)})`;
  return (
    <div class="donut">
      <div class="ring" style={`width:${size}px;height:${size}px`}>
        <svg viewBox="0 0 120 120" width={size} height={size} role="img" aria-label={title}>
          <title>{title}</title>
          {arcs.map((a) => a.d == null
            ? <circle class={`slice ${a.cls}`} cx="60" cy="60" r="46"><title>{label(a)}</title></circle>
            : <path class={`slice ${a.cls}`} d={a.d}><title>{label(a)}</title></path>)}
        </svg>
        <div class="centre"><strong>{hero}</strong><span>{caption}</span></div>
      </div>
      <ul class="dlegend">
        {arcs.map((a) => (
          <li><i class={`swatch ${a.cls}`}></i><span class="k">{a.key}</span><span class="n">{a.n}{unit} <span class="muted">{pct(a.share)}</span></span></li>
        ))}
      </ul>
    </div>
  );
};

/** A stacked column series: one column per period, segments by key, the count above and the period below. */
export interface ColumnSpec { period: string; total: number; parts: { key: string; n: number; cls: string }[] }
export const Columns: FC<{ cols: ColumnSpec[]; share?: boolean; tall?: boolean }> = ({ cols, share, tall }) => {
  const max = Math.max(1, ...cols.map((c) => c.total));
  return (
    <div class={`cols${tall ? " tall" : ""}${cols.length > 8 ? " dense" : ""}`}>
      {cols.map((c, i) => (
        <div class="col">
          <span class="coln">{c.total || ""}</span>
          <span class={`colstack${c.total ? "" : " ghost"}`} style={share ? "height:100%" : `height:${pct(c.total / max)}`}>
            {c.parts.filter((p) => p.n > 0).map((p) => (
              <i class={`seg ${p.cls}`} style={`flex:${p.n}`} title={`${periodText(c.period)} · ${p.key}: ${p.n}${share ? ` of ${c.total} (${pct(p.n / c.total)})` : ""}`}></i>
            ))}
          </span>
          <span class="collabel"><PeriodLabel period={c.period} prev={cols[i - 1]?.period} /></span>
        </div>
      ))}
    </div>
  );
};

/**
 * Where a section stands and where it stood a week ago. The bar is now; the hollow marker is last week, joined
 * to the bar end so the eye reads the distance; the chip says it in points. A key with no last week is "new",
 * and on a first bulletin nothing is drawn as movement at all, because there is nothing to move from.
 */
export interface MoveRow { key: string; n: number; share: number; was_share: number | null; points: number | null }
export const Movers: FC<{ rows: MoveRow[]; first?: boolean; limit?: number; unit?: string; tone?: string }> = ({ rows, first, limit = 8, unit = "", tone = "" }) => {
  const shown = rows.slice(0, limit);
  if (!shown.length) return null;
  const max = Math.max(0.001, ...shown.map((r) => Math.max(r.share, first ? 0 : r.was_share ?? 0)));
  const x = (s: number) => `${r2((s / max) * 100)}%`;
  return (
    <div class={`movers${tone ? ` ${tone}` : ""}`}>
      {shown.map((r) => {
        const moved = !first && r.was_share != null;
        const lo = moved ? Math.min(r.share, r.was_share!) : r.share;
        const hi = moved ? Math.max(r.share, r.was_share!) : r.share;
        const tip = `${r.key}: ${r.n}${unit} (${pct(r.share)})${moved ? `, was ${pct(r.was_share!)}` : first ? "" : r.was_share == null ? ", new this week" : ""}`;
        return (
          <div class="mrow" title={tip}>
            <span class="mkey">{r.key}</span>
            <span class="mtrack">
              {moved ? <i class="mgap" style={`left:${x(lo)};width:${x(hi - lo)}`}></i> : null}
              <i class="mbar" style={`width:${x(r.share)}`}></i>
              {moved ? <i class="mwas" style={`left:${x(r.was_share!)}`}></i> : null}
            </span>
            <span class="mn">{pct(r.share)} <span class="muted">{r.n}{unit}</span></span>
            <span class="mdelta">
              {first ? null
                : r.was_share == null ? <span class="delta new">new</span>
                : r.points == null || Math.abs(r.points) < 0.005 ? <Delta n={0} text="flat" />
                : <Delta n={r.points} text={`${r.points > 0 ? "+" : "−"}${(Math.abs(r.points) * 100).toFixed(1)} pts`} />}
            </span>
          </div>
        );
      })}
    </div>
  );
};

/** A line through a few weeks. Three points at least: two is a segment, and a segment is not a trend. */
export const Sparkline: FC<{ values: number[]; title: string; cls?: string }> = ({ values, title, cls }) => {
  if (values.length < 3) return null;
  return (
    <svg class={`spark${cls ? ` ${cls}` : ""}`} viewBox="0 0 100 24" preserveAspectRatio="none" role="img" aria-label={title}>
      <title>{title}</title>
      <path d={sparkPath(values)} fill="none" vector-effect="non-scaling-stroke" />
    </svg>
  );
};
