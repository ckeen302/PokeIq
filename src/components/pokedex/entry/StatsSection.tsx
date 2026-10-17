"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { STAT_LABELS, type StatKey } from "@/lib/pokemon/constants";
import { statRange } from "@/lib/pokemon/stat-calc";
import { cn } from "@/lib/utils";

const ORDER: StatKey[] = ["hp", "atk", "def", "spa", "spd", "spe"];
/** Game-style radar order, clockwise from the top. */
const RADAR: StatKey[] = ["hp", "atk", "def", "spe", "spd", "spa"];

function barColor(v: number): string {
  if (v >= 130) return "#22d3ee";
  if (v >= 100) return "#22c55e";
  if (v >= 80) return "#a3e635";
  if (v >= 60) return "#facc15";
  if (v >= 40) return "#fb923c";
  return "#ef4444";
}

interface StatsSectionProps {
  stats: Record<StatKey, number>;
  percentiles: Record<StatKey | "bst", number>;
  accent: string;
  isShedinja: boolean;
  /** Percentiles describe the default form only. */
  showPercentiles: boolean;
}

export function StatsSection({ stats, percentiles, accent, isShedinja, showPercentiles }: StatsSectionProps) {
  const [level, setLevel] = useState<50 | 100>(100);
  const bst = ORDER.reduce((sum, k) => sum + stats[k], 0);

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="space-y-3 rounded-2xl border bg-card/60 p-5">
        <div className="grid grid-cols-[72px_40px_minmax(0,1fr)_90px] items-center gap-x-3 text-[11px] uppercase tracking-wider text-muted-foreground">
          <span>Stat</span>
          <span className="text-right">Base</span>
          <span />
          <div className="flex justify-end">
            <div className="flex rounded-full border border-white/10 p-0.5">
              {([50, 100] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setLevel(l)}
                  className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", level === l ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
                >
                  Lv{l}
                </button>
              ))}
            </div>
          </div>
        </div>
        {ORDER.map((k, i) => {
          const [min, max] = statRange(k, stats[k], level, isShedinja);
          return (
            <div key={k} className="grid grid-cols-[72px_40px_minmax(0,1fr)_90px] items-center gap-x-3 text-sm">
              <span className="text-muted-foreground">{STAT_LABELS[k]}</span>
              <span className="text-right font-mono font-bold tabular-nums">{stats[k]}</span>
              <div className="relative h-3 overflow-hidden rounded-full bg-secondary">
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: `linear-gradient(90deg, ${barColor(stats[k])}aa, ${barColor(stats[k])})`, boxShadow: `0 0 12px ${barColor(stats[k])}66` }}
                  initial={{ width: 0 }}
                  whileInView={{ width: `${Math.min(100, (stats[k] / 200) * 100)}%` }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.9, delay: i * 0.08, ease: "easeOut" }}
                />
              </div>
              <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
                {min}–{max}
              </span>
            </div>
          );
        })}
        <div className="grid grid-cols-[72px_40px_minmax(0,1fr)_90px] items-center gap-x-3 border-t border-white/5 pt-3 text-sm">
          <span className="font-semibold">Total</span>
          <span className="text-right font-mono font-black tabular-nums" style={{ color: accent }}>
            {bst}
          </span>
          <span className="text-xs text-muted-foreground">
            {showPercentiles && `Higher than ${percentiles.bst}% of all Pokémon`}
          </span>
          <span />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Ranges assume 0 IV/0 EV with a hindering nature (min) up to 31 IV/252 EV with a boosting nature (max).
        </p>
      </div>

      <div className="space-y-3 rounded-2xl border bg-card/60 p-5">
        <Radar stats={stats} accent={accent} />
        {showPercentiles && (
          <ul className="grid grid-cols-2 gap-1.5 text-xs">
            {ORDER.map((k) => (
              <li key={k} className="flex justify-between rounded-md bg-muted/40 px-2 py-1">
                <span className="text-muted-foreground">{STAT_LABELS[k]}</span>
                <span className="font-semibold tabular-nums">top {Math.max(1, 100 - percentiles[k])}%</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Radar({ stats, accent }: { stats: Record<StatKey, number>; accent: string }) {
  const size = 260;
  const c = size / 2;
  const r = c - 34;
  const max = Math.max(160, ...RADAR.map((k) => stats[k]));
  const point = (i: number, scale: number) => {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / 6;
    return [c + Math.cos(angle) * r * scale, c + Math.sin(angle) * r * scale] as const;
  };
  const path = (scales: number[]) =>
    scales.map((s, i) => `${i === 0 ? "M" : "L"}${point(i, s)[0].toFixed(1)},${point(i, s)[1].toFixed(1)}`).join(" ") + " Z";
  const target = RADAR.map((k) => stats[k] / max);

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto w-full max-w-[260px]" role="img" aria-label="Base stat radar chart">
      {[0.25, 0.5, 0.75, 1].map((s) => (
        <path key={s} d={path(Array(6).fill(s))} fill="none" stroke="currentColor" className="text-white/10" />
      ))}
      {RADAR.map((_, i) => {
        const [x, y] = point(i, 1);
        return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke="currentColor" className="text-white/10" />;
      })}
      <motion.path
        d={path(target)}
        initial={{ d: path(Array(6).fill(0.02)), opacity: 0 }}
        animate={{ d: path(target), opacity: 1 }}
        transition={{ duration: 0.9, ease: [0.34, 1.56, 0.64, 1] }}
        fill={`${accent}55`}
        stroke={accent}
        strokeWidth={2}
        style={{ filter: `drop-shadow(0 0 8px ${accent})` }}
      />
      {RADAR.map((k, i) => {
        const [x, y] = point(i, 1.2);
        return (
          <text key={k} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-[10px] font-semibold">
            {STAT_LABELS[k]} {stats[k]}
          </text>
        );
      })}
    </svg>
  );
}
