"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Графіки дашборда (SVG, без бібліотек). Правила: одна вісь, тонкі стовпчики (≤24 px) із заокругленим кінцем,
 * 2 px проміжок між сегментами, легенда для ≥2 рядів, підказка при наведенні з усіма значеннями,
 * текст — кольорами тексту, не кольором ряду. Кольори рядів — CSS-змінні --c1…--c3 з globals.css
 * (перевірено валідатором палітри на дальтонізм і контраст).
 */

export type Fmt = "uah" | "int" | "pct";
const nf = new Intl.NumberFormat("uk-UA", { maximumFractionDigits: 0 });
export const fmt = (v: number, f: Fmt) => f === "uah" ? `${nf.format(Math.round(v))} грн` : f === "pct" ? `${Math.round(v)}%` : nf.format(Math.round(v));
const compact = (v: number, f: Fmt) => {
  const a = Math.abs(v);
  const s = a >= 1_000_000 ? `${+(v / 1_000_000).toFixed(1)} млн` : a >= 10_000 ? `${Math.round(v / 1000)} тис.` : nf.format(Math.round(v));
  return f === "pct" ? `${Math.round(v)}%` : s;
};

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null); const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width))); ro.observe(el); setW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}
/** «Чисті» поділки осі: 0, 1/2/5×10ⁿ. */
function ticks(max: number, min = 0, n = 4, minStep = 0) {
  const span = Math.max(1, max - min); const raw = Math.max(span / n, minStep); const p = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(minStep, [1, 2, 2.5, 5, 10].map((m) => m * p).find((s) => s >= raw) ?? raw); // для лічильників крок не дрібніший за 1
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out: number[] = []; for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

export type Series = { key: string; name: string; color: string; hatch?: boolean; negative?: boolean };
export type Cat = { key: string; label: string; sub?: string; dim?: boolean };
type TipRow = { name: string; color?: string; value: string; strong?: boolean };

function Tooltip({ x, y, w, title, rows }: { x: number; y: number; w: number; title: string; rows: TipRow[] }) {
  const left = Math.min(Math.max(8, x - 125), Math.max(8, w - 258));
  return <div className="chart-tip" style={{ left, top: Math.max(0, y) }} role="status"><div className="chart-tip-t">{title}</div>
    {rows.map((r, i) => <div key={i} className="chart-tip-r">{r.color ? <i style={{ background: r.color }} /> : <i className="none" />}<b className={r.strong ? "strong" : ""}>{r.value}</b><span>{r.name}</span></div>)}</div>;
}
export function Legend({ items }: { items: { name: string; color: string; hatch?: boolean; line?: boolean }[] }) {
  return <div className="chart-legend">{items.map((s) => <span key={s.name}><i className={`${s.hatch ? "hatch" : ""} ${s.line ? "line" : ""}`} style={{ ["--sw" as string]: s.color }} />{s.name}</span>)}</div>;
}

/**
 * Стовпчики з накопиченням. values[cat][series]; ряд negative малюється вниз від нуля (прихід / відтік).
 * extra[cat] — додаткові рядки підказки (напр., «якщо всі продовжать»).
 */
export function ColumnChart({ cats, series, values, format, height = 220, extra, totalLabel = "Разом", showTotals = true, ariaLabel }: {
  cats: Cat[]; series: Series[]; values: Record<string, Record<string, number>>; format: Fmt; height?: number;
  extra?: Record<string, TipRow[]>; totalLabel?: string; showTotals?: boolean; ariaLabel: string;
}) {
  const [ref, w] = useWidth<HTMLDivElement>(); const [hover, setHover] = useState<number | null>(null);
  const v = (c: string, s: Series) => Math.abs(values[c]?.[s.key] ?? 0);
  const pos = cats.map((c) => series.filter((s) => !s.negative).reduce((a, s) => a + v(c.key, s), 0));
  const neg = cats.map((c) => series.filter((s) => s.negative).reduce((a, s) => a + v(c.key, s), 0));
  const hasNeg = neg.some((x) => x > 0);
  const tk = ticks(Math.max(1, ...pos), hasNeg ? -Math.max(...neg) : 0, 4, format === "int" ? 1 : 0);
  const top = tk[tk.length - 1], bot = tk[0];
  const padL = 52, padR = 8, padT = showTotals ? 18 : 8, padB = 34;
  const ih = height - padT - padB, iw = Math.max(10, w - padL - padR);
  const y = (val: number) => padT + ((top - val) / (top - bot || 1)) * ih;
  const band = iw / Math.max(1, cats.length); const bw = Math.min(24, Math.max(6, band * 0.56));
  const every = Math.ceil(cats.length / Math.max(1, Math.floor(iw / 56)));
  const total = (i: number) => pos[i] - neg[i];
  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}>
      <Legend items={series.map((s) => ({ name: s.name, color: s.color, hatch: s.hatch }))} />
      {w > 0 && <svg width={w} height={height} role="img" aria-label={ariaLabel}>
        <defs>{series.filter((s) => s.hatch).map((s) => <pattern key={s.key} id={`h-${s.key}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill={s.color} opacity=".22" /><line x1="0" y1="0" x2="0" y2="6" stroke={s.color} strokeWidth="2.4" /></pattern>)}</defs>
        {tk.map((t) => <g key={t}><line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} className={t === 0 ? "chart-zero" : "chart-grid"} /><text x={padL - 8} y={y(t) + 4} textAnchor="end" className="chart-axis">{compact(t, format)}</text></g>)}
        {cats.map((c, i) => {
          const cx = padL + band * i + band / 2; let up = 0, down = 0;
          return <g key={c.key} opacity={hover === null || hover === i ? 1 : 0.55}>
            <rect x={padL + band * i} y={padT} width={band} height={ih} fill="transparent" onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${c.label}: ${fmt(total(i), format)}`} />
            {series.map((s) => {
              const val = v(c.key, s); if (!val) return null;
              const from = s.negative ? down : up; const to = from + val;
              if (s.negative) down = to; else up = to;
              const y1 = s.negative ? y(-from) : y(to), y2 = s.negative ? y(-to) : y(from);
              const hgt = Math.max(0, y2 - y1 - (from > 0 ? 2 : 0)); // 2 px проміжок між сегментами
              const yy = s.negative ? y1 + (from > 0 ? 2 : 0) : y1;
              const isEnd = s.negative ? !series.some((o) => o.negative && series.indexOf(o) > series.indexOf(s) && v(c.key, o)) : !series.some((o) => !o.negative && series.indexOf(o) > series.indexOf(s) && v(c.key, o));
              return <path key={s.key} d={roundedBar(cx - bw / 2, yy, bw, hgt, isEnd ? 4 : 0, s.negative)} fill={s.hatch ? `url(#h-${s.key})` : s.color} pointerEvents="none" />;
            })}
            {showTotals && (hover === i || cats.length <= 8) && pos[i] > 0 && <text x={cx} y={y(pos[i]) - 6} textAnchor="middle" className="chart-val">{compact(pos[i], format)}</text>}
            {(i % every === 0 || hover === i) && <text x={cx} y={height - padB + 16} textAnchor="middle" className={`chart-axis ${c.dim ? "dim" : ""}`}>{c.label}</text>}
            {c.sub && i % every === 0 && <text x={cx} y={height - padB + 29} textAnchor="middle" className="chart-axis dim">{c.sub}</text>}
          </g>;
        })}
      </svg>}
      {hover !== null && w > 0 && <Tooltip x={padL + band * hover + band / 2} y={24} w={w} title={cats[hover].label + (cats[hover].sub ? ` · ${cats[hover].sub}` : "")}
        rows={[...series.filter((s) => v(cats[hover].key, s)).map((s) => ({ name: s.name, color: s.color, value: `${s.negative ? "−" : ""}${fmt(v(cats[hover].key, s), format)}` })),
          ...(series.filter((s) => v(cats[hover].key, s)).length > 1 && !hasNeg ? [{ name: totalLabel, value: fmt(total(hover), format), strong: true }] : []), ...(extra?.[cats[hover].key] ?? [])]} />}
    </div>
  );
}
function roundedBar(x: number, y: number, w: number, h: number, r: number, down?: boolean) {
  if (h <= 0) return "";
  r = Math.min(r, h, w / 2);
  if (!r) return `M${x},${y}h${w}v${h}h${-w}z`;
  return down
    ? `M${x},${y}h${w}v${h - r}a${r},${r} 0 0 1 ${-r},${r}h${-(w - 2 * r)}a${r},${r} 0 0 1 ${-r},${-r}z`
    : `M${x},${y + h}v${-(h - r)}a${r},${r} 0 0 1 ${r},${-r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}z`;
}

/** Лінія з легкою заливкою (один ряд): перехрестя знаходить найближчу точку, підказка показує значення. */
export function LineChart({ points, format, color = "var(--c1)", height = 200, ariaLabel, name }: { points: { key: string; label: string; value: number | null; note?: string }[]; format: Fmt; color?: string; height?: number; ariaLabel: string; name: string }) {
  const [ref, w] = useWidth<HTMLDivElement>(); const [hover, setHover] = useState<number | null>(null);
  const vals = points.map((p) => p.value ?? 0); const tk = ticks(Math.max(1, ...vals) * 1.08, 0, 4, format === "int" ? 1 : 0);
  const top = tk[tk.length - 1];
  const padL = 52, padR = 16, padT = 14, padB = 30; const ih = height - padT - padB, iw = Math.max(10, w - padL - padR);
  const x = (i: number) => padL + (points.length > 1 ? (iw * i) / (points.length - 1) : iw / 2);
  const y = (v: number) => padT + ((top - v) / (top || 1)) * ih;
  const pts = points.map((p, i) => p.value === null ? null : [x(i), y(p.value)] as const).filter(Boolean) as (readonly [number, number])[];
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join("");
  const area = pts.length ? `${line}L${pts[pts.length - 1][0]},${y(0)}L${pts[0][0]},${y(0)}Z` : "";
  const every = Math.ceil(points.length / Math.max(1, Math.floor(iw / 56)));
  const last = pts.length - 1;
  return (
    <div className="chart" ref={ref} onMouseLeave={() => setHover(null)}
      onMouseMove={(e) => { const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); const px = e.clientX - r.left; let best = 0; points.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; }); setHover(best); }}>
      {w > 0 && <svg width={w} height={height} role="img" aria-label={ariaLabel}>
        {tk.map((t) => <g key={t}><line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} className={t === 0 ? "chart-zero" : "chart-grid"} /><text x={padL - 8} y={y(t) + 4} textAnchor="end" className="chart-axis">{compact(t, format)}</text></g>)}
        <path d={area} fill={color} opacity=".1" />
        <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={padT} y2={y(0)} className="chart-cross" />}
        {pts.map((p, i) => (i === last || i === hover) && <circle key={i} cx={p[0]} cy={p[1]} r="4.5" fill={color} stroke="#fff" strokeWidth="2" />)}
        {last >= 0 && <text x={pts[last][0] - 6} y={pts[last][1] - 10} textAnchor="end" className="chart-val">{fmt(points.filter((p) => p.value !== null).slice(-1)[0].value ?? 0, format)}</text>}
        {points.map((p, i) => (i % every === 0 || i === points.length - 1) && <text key={p.key} x={x(i)} y={height - 10} textAnchor="middle" className="chart-axis">{p.label}</text>)}
      </svg>}
      {hover !== null && w > 0 && points[hover].value !== null && <Tooltip x={x(hover)} y={4} w={w} title={points[hover].label} rows={[{ name, color, value: fmt(points[hover].value ?? 0, format), strong: true }, ...(points[hover].note ? [{ name: points[hover].note!, value: "" }] : [])]} />}
    </div>
  );
}

/** Одна смуга 100 %: частки цілого (склад клубу). Підписи — у легенді з числом і відсотком. */
export function ShareBar({ parts, ariaLabel }: { parts: { name: string; value: number; color: string; hatch?: boolean }[]; ariaLabel: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1; const [hover, setHover] = useState<number | null>(null);
  return (
    <div className="sharebar" role="img" aria-label={ariaLabel}>
      <div className="sharebar-track">{parts.filter((p) => p.value > 0).map((p, i) => <span key={p.name} className={`${p.hatch ? "hatch" : ""} ${hover === i ? "on" : ""}`} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} title={`${p.name}: ${fmt(p.value, "int")} (${Math.round((p.value / total) * 100)}%)`} style={{ flexGrow: p.value, ["--sw" as string]: p.color }} />)}</div>
      <div className="chart-legend">{parts.map((p) => <span key={p.name}><i className={p.hatch ? "hatch" : ""} style={{ ["--sw" as string]: p.color }} /><b>{fmt(p.value, "int")}</b>{p.name}<em>{Math.round((p.value / total) * 100)}%</em></span>)}</div>
    </div>
  );
}

/** Горизонтальні смуги (рейтинг / конверсія): значення праворуч, підказка з поясненням. */
export function HBars({ rows, format, max }: { rows: { name: string; value: number; note?: string; color?: string }[]; format: Fmt; max?: number }) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value));
  return <div className="hbars">{rows.map((r) => <div key={r.name} className="hbar" title={r.note ? `${r.name}: ${fmt(r.value, format)} — ${r.note}` : undefined}>
    <span className="hbar-n">{r.name}</span><span className="hbar-t"><i style={{ width: `${Math.max(0.5, (r.value / m) * 100)}%`, ["--sw" as string]: r.color ?? "var(--c2)" }} /></span><b>{fmt(r.value, format)}</b>{r.note && <small>{r.note}</small>}</div>)}</div>;
}
