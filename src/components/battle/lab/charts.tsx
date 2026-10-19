"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { count, pct, type LabTotals } from "@/lib/battle/lab/stats";
import { cn } from "@/lib/utils";
import type { ConvergencePoint } from "./use-lab-run";

/**
 * Small SVG charts for the Battle Lab: thin marks, hairline grids, a 2px
 * gap between touching marks, values on hover and a table view under each.
 * Side A, Side B and draws keep the same colours everywhere (--lab-a,
 * --lab-b, --lab-draw), and text always stays in the text colours.
 */

export const SIDE_COLOR = ["var(--lab-a)", "var(--lab-b)"] as const;
export const DRAW_COLOR = "var(--lab-draw)";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** The element's width, kept up to date. */
function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useIsoLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/** 0, 1.2K, 34K. */
export function compact(n: number): string {
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(n));
}

/** A round step for an axis that has to reach `max`. */
function niceMax(max: number): number {
  if (max <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * mag >= max) return m * mag;
  return 10 * mag;
}

/** A column with a rounded (4px) top and a square base. */
function columnPath(x: number, y: number, w: number, h: number, round: boolean): string {
  const r = round ? Math.min(4, w / 2, h) : 0;
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

export function Swatch({ color, line }: { color: string; line?: boolean }) {
  return line ? (
    <span className="inline-block h-0.5 w-3.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
  ) : (
    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color }} aria-hidden />
  );
}

export function Legend({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Legend">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <Swatch color={item.color} line={item.line} /> {item.label}
        </li>
      ))}
    </ul>
  );
}

function Tooltip({ x, width, children }: { x: number; width: number; children: React.ReactNode }) {
  const left = Math.max(0, Math.min(width - 168, x - 84));
  return (
    <div
      className="pointer-events-none absolute top-1 z-10 w-[168px] rounded-md border bg-card/95 px-2.5 py-1.5 text-xs shadow-xl backdrop-blur"
      style={{ left }}
      role="status"
    >
      {children}
    </div>
  );
}

/** A collapsible table with the chart's numbers, for screen readers and anyone who'd rather read than hover. */
export function TableView({ head, rows, caption }: { head: string[]; rows: (string | number)[][]; caption: string }) {
  return (
    <details className="group text-xs">
      <summary className="hud-label cursor-pointer select-none py-1 hover:text-foreground">Table view</summary>
      <div className="mt-1 max-h-64 overflow-auto rounded-md border">
        <table className="w-full text-left">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 bg-card">
            <tr>
              {head.map((h) => (
                <th key={h} scope="col" className="px-2 py-1 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono tabular-nums">
            {rows.map((row, i) => (
              <tr key={i} className="border-t border-foreground/[0.06]">
                {row.map((cell, j) => (
                  <td key={j} className="px-2 py-0.5">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------------------
// The outcome: one bar, Side A | draws | Side B
// ---------------------------------------------------------------------------

export function OutcomeBar({ totals, labels }: { totals: LabTotals; labels: [string, string] }) {
  const n = Math.max(1, totals.battles);
  const parts = [
    { key: "a", label: `${labels[0]} wins`, value: totals.wins[0], color: SIDE_COLOR[0] },
    { key: "d", label: "Draws", value: totals.draws, color: DRAW_COLOR },
    { key: "b", label: `${labels[1]} wins`, value: totals.wins[1], color: SIDE_COLOR[1] },
  ].filter((p) => p.value > 0);
  return (
    <div className="space-y-2">
      <div className="flex h-6 w-full gap-[2px] overflow-hidden rounded-[4px] bg-shade/30" role="img" aria-label={parts.map((p) => `${p.label} ${pct(p.value / n)}`).join(", ")}>
        {parts.map((p) => (
          <div
            key={p.key}
            title={`${p.label}: ${pct(p.value / n)} (${count(p.value)})`}
            className="h-full transition-[width] duration-200 first:rounded-l-[4px] last:rounded-r-[4px]"
            style={{ width: `${(p.value / n) * 100}%`, background: p.color, minWidth: 2 }}
          />
        ))}
      </div>
      <Legend items={[{ label: `${labels[0]} wins`, color: SIDE_COLOR[0] }, ...(totals.draws ? [{ label: "Draws", color: DRAW_COLOR }] : []), { label: `${labels[1]} wins`, color: SIDE_COLOR[1] }]} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Convergence: Side A's win rate as battles come in, with its 95% interval
// ---------------------------------------------------------------------------

export function ConvergenceChart({ history, total, label }: { history: ConvergencePoint[]; total: number; label: string }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const height = 180;
  const m = { l: 38, r: 52, t: 10, b: 22 };
  const w = Math.max(10, width - m.l - m.r);
  const h = height - m.t - m.b;
  const xs = (n: number) => m.l + (n / Math.max(1, total)) * w;
  const ys = (p: number) => m.t + (1 - p) * h;
  const pts = history.filter((p) => p.n > 0);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${xs(p.n).toFixed(1)},${ys(p.p).toFixed(1)}`).join("");
  const band = pts.length
    ? `${pts.map((p, i) => `${i ? "L" : "M"}${xs(p.n).toFixed(1)},${ys(p.hi).toFixed(1)}`).join("")}${[...pts]
        .reverse()
        .map((p) => `L${xs(p.n).toFixed(1)},${ys(p.lo).toFixed(1)}`)
        .join("")}Z`
    : "";
  const last = pts[pts.length - 1];
  const hovered = hover !== null ? pts[hover] : null;

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    if (!pts.length) return;
    const box = e.currentTarget.getBoundingClientRect();
    const n = ((e.clientX - box.left) / Math.max(1, box.width)) * total;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(pts[i].n - n) < Math.abs(pts[best].n - n)) best = i;
    setHover(best);
  }

  return (
    <div className="space-y-1">
      <div ref={ref} className="relative w-full">
        {width > 0 && (
          <svg width={width} height={height} className="block overflow-visible" role="img" aria-label={`${label}'s win rate as battles came in${last ? `: ${pct(last.p)} after ${count(last.n)}` : ""}`}>
            {[0, 0.25, 0.5, 0.75, 1].map((t) => (
              <g key={t}>
                <line x1={m.l} x2={m.l + w} y1={ys(t)} y2={ys(t)} stroke="hsl(var(--border))" strokeWidth={1} />
                <text x={m.l - 6} y={ys(t)} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px] tabular-nums">
                  {t * 100}%
                </text>
              </g>
            ))}
            <text x={m.l} y={height - 4} className="fill-muted-foreground font-mono text-[10px] tabular-nums">
              0
            </text>
            <text x={m.l + w} y={height - 4} textAnchor="end" className="fill-muted-foreground font-mono text-[10px] tabular-nums">
              {compact(total)} battles
            </text>
            {band && <path d={band} fill={SIDE_COLOR[0]} opacity={0.12} />}
            {line && <path d={line} fill="none" stroke={SIDE_COLOR[0]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
            {last && (
              <>
                <circle cx={xs(last.n)} cy={ys(last.p)} r={4} fill={SIDE_COLOR[0]} stroke="hsl(var(--card))" strokeWidth={2} />
                <text x={xs(last.n) + 8} y={ys(last.p)} dy="0.32em" className="fill-foreground font-mono text-[11px] font-semibold tabular-nums">
                  {pct(last.p)}
                </text>
              </>
            )}
            {hovered && (
              <>
                <line x1={xs(hovered.n)} x2={xs(hovered.n)} y1={m.t} y2={m.t + h} stroke="hsl(var(--muted-foreground))" strokeWidth={1} opacity={0.6} />
                <circle cx={xs(hovered.n)} cy={ys(hovered.p)} r={4} fill={SIDE_COLOR[0]} stroke="hsl(var(--card))" strokeWidth={2} />
              </>
            )}
            <rect x={m.l} y={m.t} width={w} height={h} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
          </svg>
        )}
        {hovered && (
          <Tooltip x={xs(hovered.n)} width={width}>
            <p className="font-mono text-sm font-semibold tabular-nums">{pct(hovered.p)}</p>
            <p className="text-muted-foreground">
              95% CI {pct(hovered.lo)}–{pct(hovered.hi)}
              <br />
              after {count(hovered.n)} battles
            </p>
          </Tooltip>
        )}
      </div>
      <TableView
        caption={`${label}'s win rate as battles came in`}
        head={["Battles", `${label} wins`, "95% CI"]}
        rows={pts.filter((_, i) => i % Math.max(1, Math.ceil(pts.length / 25)) === 0 || i === pts.length - 1).map((p) => [count(p.n), pct(p.p), `${pct(p.lo)}–${pct(p.hi)}`])}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Columns: the turn histogram (stacked by outcome) and the HP-left histogram
// ---------------------------------------------------------------------------

export interface ColumnBin {
  label: string;
  /** The tooltip's heading. */
  title: string;
  values: number[];
}

export function StackedColumns({
  bins,
  series,
  caption,
  format = (v) => count(v),
  axisFormat = compact,
  height = 190,
}: {
  bins: ColumnBin[];
  series: { label: string; color: string }[];
  caption: string;
  format?: (v: number) => string;
  axisFormat?: (v: number) => string;
  height?: number;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const m = { l: 34, r: 6, t: 8, b: 22 };
  const w = Math.max(10, width - m.l - m.r);
  const h = height - m.t - m.b;
  const max = niceMax(Math.max(0, ...bins.map((b) => b.values.reduce((a, v) => a + v, 0))));
  const band = w / Math.max(1, bins.length);
  const colW = Math.max(1, Math.min(24, band - 2));
  const ys = (v: number) => (v / max) * h;
  // Label every k-th column so labels never collide.
  const every = Math.max(1, Math.ceil(bins.length / Math.max(1, Math.floor(w / 34))));
  const hovered = hover !== null ? bins[hover] : null;

  return (
    <div className="space-y-1">
      <div ref={ref} className="relative w-full">
        {width > 0 && (
          <svg width={width} height={height} className="block" role="img" aria-label={caption}>
            {[0, 0.5, 1].map((t) => (
              <g key={t}>
                <line x1={m.l} x2={m.l + w} y1={m.t + h - t * h} y2={m.t + h - t * h} stroke="hsl(var(--border))" strokeWidth={1} />
                <text x={m.l - 6} y={m.t + h - t * h} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px] tabular-nums">
                  {axisFormat(max * t)}
                </text>
              </g>
            ))}
            {bins.map((bin, i) => {
              const x = m.l + i * band + (band - colW) / 2;
              let y = m.t + h;
              const segs = bin.values.map((v, s) => ({ v, s })).filter((seg) => seg.v > 0);
              return (
                <g key={i} opacity={hover === null || hover === i ? 1 : 0.55}>
                  {segs.map(({ v, s }, j) => {
                    const sh = ys(v);
                    const gap = j > 0 && sh > 3 ? 2 : 0;
                    y -= sh;
                    const path = columnPath(x, y, colW, Math.max(0, sh - gap), j === segs.length - 1);
                    return <path key={s} d={path} fill={series[s].color} />;
                  })}
                  {i % every === 0 && (
                    <text x={x + colW / 2} y={height - 6} textAnchor="middle" className="fill-muted-foreground font-mono text-[10px] tabular-nums">
                      {bin.label}
                    </text>
                  )}
                  <rect
                    x={m.l + i * band}
                    y={m.t}
                    width={band}
                    height={h}
                    fill="transparent"
                    onPointerEnter={() => setHover(i)}
                    onPointerLeave={() => setHover(null)}
                    aria-hidden
                  />
                </g>
              );
            })}
          </svg>
        )}
        {hovered && hover !== null && (
          <Tooltip x={m.l + hover * band + band / 2} width={width}>
            <p className="font-semibold">{hovered.title}</p>
            {series.map((s, i) => (
              <p key={s.label} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Swatch color={s.color} line /> {s.label}
                </span>
                <span className="font-mono font-semibold tabular-nums">{format(hovered.values[i])}</span>
              </p>
            ))}
          </Tooltip>
        )}
      </div>
      <TableView caption={caption} head={["", ...series.map((s) => s.label)]} rows={bins.filter((b) => b.values.some((v) => v > 0)).map((b) => [b.title, ...b.values.map(format)])} />
    </div>
  );
}

/** Battles by the turn they ended on, stacked by outcome; long tails are grouped. */
export function turnBins(totals: LabTotals): ColumnBin[] {
  const last = Math.max(0, ...totals.turns.map((t) => t.length - 1));
  if (last <= 0) return [];
  const size = last <= 40 ? 1 : Math.ceil(last / 30);
  const bins: ColumnBin[] = [];
  for (let from = 1; from <= last; from += size) {
    const to = Math.min(last, from + size - 1);
    const values = [0, 1, 2].map((o) => {
      let n = 0;
      for (let t = from; t <= to; t++) n += totals.turns[o][t] ?? 0;
      return n;
    });
    bins.push({ label: size === 1 ? String(from) : String(from), title: size === 1 ? `Turn ${from}` : `Turns ${from}–${to}`, values });
  }
  return bins;
}

export function CardSection({ title, aside, children, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("hud min-w-0 space-y-3 rounded-lg border bg-card p-4", className)} aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display text-base font-bold uppercase tracking-wide">{title}</h3>
        {aside && <span className="hud-label normal-case tracking-wider">{aside}</span>}
      </div>
      {children}
    </section>
  );
}
