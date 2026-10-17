"use client";

import { motion } from "framer-motion";
import { ratingToIQ } from "@/lib/rating";

/**
 * How the adaptive test homed in: the PokéIQ estimate after each answer,
 * with its 90% credible band narrowing as evidence accumulates.
 */
export function IqConvergence({ trajectory, grid }: { trajectory: [number, number][]; grid: string }) {
  const W = 560;
  const H = 180;
  const pad = { l: 34, r: 12, t: 12, b: 22 };
  const points = trajectory.map(([r, se], i) => ({
    i,
    iq: ratingToIQ(r),
    lo: ratingToIQ(r - 1.645 * se),
    hi: ratingToIQ(r + 1.645 * se),
    correct: grid[i] === "1",
  }));
  const minY = Math.min(70, ...points.map((p) => p.lo)) - 5;
  const maxY = Math.max(130, ...points.map((p) => p.hi)) + 5;
  const x = (i: number) => pad.l + (i / Math.max(1, points.length - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - minY) / (maxY - minY)) * (H - pad.t - pad.b);

  const line = points.map((p, i) => `${i ? "L" : "M"}${x(p.i)},${y(p.iq)}`).join(" ");
  const band =
    points.map((p, i) => `${i ? "L" : "M"}${x(p.i)},${y(p.hi)}`).join(" ") +
    " " +
    [...points].reverse().map((p) => `L${x(p.i)},${y(p.lo)}`).join(" ") +
    " Z";
  const final = points[points.length - 1];

  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="mb-1 flex items-baseline justify-between text-xs text-muted-foreground">
        <span className="font-semibold text-foreground">How your PokéIQ was measured</span>
        <span>Each question was picked to be as informative as possible for you</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`PokéIQ estimate converged to ${final.iq}`}>
        {[80, 100, 120, 140].filter((v) => v > minY && v < maxY).map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="currentColor" className="text-white/10" strokeDasharray="3 4" />
            <text x={pad.l - 6} y={y(v)} textAnchor="end" dominantBaseline="middle" className="fill-muted-foreground text-[10px]">
              {v}
            </text>
          </g>
        ))}
        <motion.path d={band} className="fill-primary/15" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4, duration: 0.8 }} />
        <motion.path
          d={line}
          fill="none"
          stroke="hsl(var(--primary))"
          strokeWidth={2.5}
          strokeLinejoin="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 1.4, ease: "easeInOut" }}
        />
        {points.map((p) => (
          <motion.circle
            key={p.i}
            cx={x(p.i)}
            cy={y(p.iq)}
            r={3.5}
            className={p.correct ? "fill-success" : "fill-destructive"}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.1 + p.i * 0.065 }}
          />
        ))}
        <text x={pad.l} y={H - 4} className="fill-muted-foreground text-[10px]">Q1</text>
        <text x={W - pad.r} y={H - 4} textAnchor="end" className="fill-muted-foreground text-[10px]">
          Q{points.length}
        </text>
      </svg>
    </div>
  );
}
