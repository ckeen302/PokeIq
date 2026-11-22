"use client";

import { useState } from "react";
import { translator } from "@/i18n/catalog";
import { useT } from "@/i18n/client";
import type { Locale } from "@/i18n/config";
import { formatNumber } from "@/i18n/format";
import battleLab from "@/messages/battle-lab";
import type { LabTotals } from "@/lib/battle/lab/stats";
import { labNumbers, type LabT } from "@/lib/battle/lab/words";
import { DRAW_COLOR, SIDE_COLOR, Swatch, TableView, Tooltip, useWidth } from "./charts";
import type { ConvergencePoint } from "./use-lab-run";

/**
 * Small SVG charts for the Battle Lab: thin marks, hairline grids, a 2px
 * gap between touching marks, values on hover and a table view under each.
 */

/** 0, 1.2K, 34K (another language: its own short form). */
export function compact(n: number, locale: Locale = "en"): string {
  if (locale !== "en") return formatNumber(Math.round(n), locale, { notation: "compact", maximumFractionDigits: 1 });
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

export function Legend({ items }: { items: { label: string; color: string; line?: boolean }[] }) {
  const t = useT(battleLab);
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label={t("chart.legend")}>
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <Swatch color={item.color} line={item.line} /> {item.label}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// The outcome: one bar, Side A | draws | Side B
// ---------------------------------------------------------------------------

export function OutcomeBar({ totals, labels }: { totals: LabTotals; labels: [string, string] }) {
  const t = useT(battleLab);
  const num = labNumbers(t.locale);
  const n = Math.max(1, totals.battles);
  const parts = [
    { key: "a", label: t("results.wins", { side: labels[0] }), value: totals.wins[0], color: SIDE_COLOR[0] },
    { key: "d", label: t("results.draws"), value: totals.draws, color: DRAW_COLOR },
    { key: "b", label: t("results.wins", { side: labels[1] }), value: totals.wins[1], color: SIDE_COLOR[1] },
  ].filter((p) => p.value > 0);
  return (
    <div className="space-y-2">
      <div className="flex h-6 w-full gap-[2px] overflow-hidden rounded-[4px] bg-shade/30" role="img" aria-label={parts.map((p) => `${p.label} ${num.pct(p.value / n)}`).join(", ")}>
        {parts.map((p) => (
          <div
            key={p.key}
            title={`${p.label}: ${num.pct(p.value / n)} (${num.count(p.value)})`}
            className="h-full transition-[width] duration-200 first:rounded-l-[4px] last:rounded-r-[4px]"
            style={{ width: `${(p.value / n) * 100}%`, background: p.color, minWidth: 2 }}
          />
        ))}
      </div>
      <Legend
        items={[
          { label: t("results.wins", { side: labels[0] }), color: SIDE_COLOR[0] },
          ...(totals.draws ? [{ label: t("results.draws"), color: DRAW_COLOR }] : []),
          { label: t("results.wins", { side: labels[1] }), color: SIDE_COLOR[1] },
        ]}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Convergence: Side A's win rate as battles come in, with its 95% interval
// ---------------------------------------------------------------------------

export function ConvergenceChart({ history, total, label }: { history: ConvergencePoint[]; total: number; label: string }) {
  const t = useT(battleLab);
  const num = labNumbers(t.locale);
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
          <svg
            width={width}
            height={height}
            className="block overflow-visible"
            role="img"
            aria-label={last ? t("chart.rateLast", { side: label, p: num.pct(last.p), n: num.count(last.n) }) : t("results.rateAside", { side: label })}
          >
            {[0, 0.25, 0.5, 0.75, 1].map((tick) => (
              <g key={tick}>
                <line x1={m.l} x2={m.l + w} y1={ys(tick)} y2={ys(tick)} stroke="hsl(var(--border))" strokeWidth={1} />
                <text x={m.l - 6} y={ys(tick)} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px] tabular-nums">
                  {t.locale === "en" ? `${tick * 100}%` : num.pct(tick, 0)}
                </text>
              </g>
            ))}
            <text x={m.l} y={height - 4} className="fill-muted-foreground font-mono text-[10px] tabular-nums">
              0
            </text>
            <text x={m.l + w} y={height - 4} textAnchor="end" className="fill-muted-foreground font-mono text-[10px] tabular-nums">
              {t("chart.axisBattles", { n: compact(total, t.locale) })}
            </text>
            {band && <path d={band} fill={SIDE_COLOR[0]} opacity={0.12} />}
            {line && <path d={line} fill="none" stroke={SIDE_COLOR[0]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
            {last && (
              <>
                <circle cx={xs(last.n)} cy={ys(last.p)} r={4} fill={SIDE_COLOR[0]} stroke="hsl(var(--card))" strokeWidth={2} />
                <text x={xs(last.n) + 8} y={ys(last.p)} dy="0.32em" className="fill-foreground font-mono text-[11px] font-semibold tabular-nums">
                  {num.pct(last.p)}
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
            <p className="font-mono text-sm font-semibold tabular-nums">{num.pct(hovered.p)}</p>
            <p className="text-muted-foreground">
              {t("chart.ciRange", { lo: num.pct(hovered.lo), hi: num.pct(hovered.hi) })}
              <br />
              {t("chart.after", { num: hovered.n, n: num.count(hovered.n) })}
            </p>
          </Tooltip>
        )}
      </div>
      <TableView
        caption={t("results.rateAside", { side: label })}
        head={[t("chart.battles"), t("results.wins", { side: label }), t("chart.ciHead")]}
        rows={pts
          .filter((_, i) => i % Math.max(1, Math.ceil(pts.length / 25)) === 0 || i === pts.length - 1)
          .map((p) => [num.count(p.n), num.pct(p.p), `${num.pct(p.lo)}–${num.pct(p.hi)}`])}
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
  format,
  axisFormat,
  height = 190,
}: {
  bins: ColumnBin[];
  series: { label: string; color: string }[];
  caption: string;
  format?: (v: number) => string;
  axisFormat?: (v: number) => string;
  height?: number;
}) {
  const t = useT(battleLab);
  const num = labNumbers(t.locale);
  const fmt = format ?? ((v: number) => num.count(v));
  const axisFmt = axisFormat ?? ((v: number) => compact(v, t.locale));
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
            {[0, 0.5, 1].map((tick) => (
              <g key={tick}>
                <line x1={m.l} x2={m.l + w} y1={m.t + h - tick * h} y2={m.t + h - tick * h} stroke="hsl(var(--border))" strokeWidth={1} />
                <text x={m.l - 6} y={m.t + h - tick * h} dy="0.32em" textAnchor="end" className="fill-muted-foreground font-mono text-[10px] tabular-nums">
                  {axisFmt(max * tick)}
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
                <span className="font-mono font-semibold tabular-nums">{fmt(hovered.values[i])}</span>
              </p>
            ))}
          </Tooltip>
        )}
      </div>
      <TableView caption={caption} head={["", ...series.map((s) => s.label)]} rows={bins.filter((b) => b.values.some((v) => v > 0)).map((b) => [b.title, ...b.values.map(fmt)])} />
    </div>
  );
}

/** Battles by the turn they ended on, stacked by outcome; long tails are grouped. */
export function turnBins(totals: LabTotals, t: LabT = translator(battleLab, "en", undefined)): ColumnBin[] {
  const last = Math.max(0, ...totals.turns.map((turns) => turns.length - 1));
  if (last <= 0) return [];
  const size = last <= 40 ? 1 : Math.ceil(last / 30);
  const bins: ColumnBin[] = [];
  for (let from = 1; from <= last; from += size) {
    const to = Math.min(last, from + size - 1);
    const values = [0, 1, 2].map((o) => {
      let n = 0;
      for (let turn = from; turn <= to; turn++) n += totals.turns[o][turn] ?? 0;
      return n;
    });
    bins.push({ label: String(from), title: size === 1 ? t("results.turn", { n: from }) : t("results.turnsRange", { from, to }), values });
  }
  return bins;
}
