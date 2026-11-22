"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "@/i18n/client";
import battleCharts from "@/messages/battle-lab-charts";
import { cn } from "@/lib/utils";

/**
 * The battle charts' shared pieces (the Battle Lab, the replay analysis and
 * battle stats): colours, a width hook, the tooltip, the table view and the
 * card. The Lab's own charts are in lab-charts.tsx. Side A, Side B and draws
 * keep the same colours everywhere (--lab-a, --lab-b, --lab-draw), and text
 * always stays in the text colours.
 */

export const SIDE_COLOR = ["var(--lab-a)", "var(--lab-b)"] as const;
export const DRAW_COLOR = "var(--lab-draw)";

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/** The element's width, kept up to date. */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
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

export function Swatch({ color, line }: { color: string; line?: boolean }) {
  return line ? (
    <span className="inline-block h-0.5 w-3.5 shrink-0 rounded-full" style={{ background: color }} aria-hidden />
  ) : (
    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color }} aria-hidden />
  );
}

export function Tooltip({ x, width, children }: { x: number; width: number; children: React.ReactNode }) {
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
  const t = useT(battleCharts);
  return (
    <details className="group text-xs">
      <summary className="hud-label cursor-pointer select-none py-1 hover:text-foreground">{t("tableView")}</summary>
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
