"use client";

import type { CSSProperties, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { MonArt, Twinkles, useStageColours } from "./Art";

const MOTES: { l: number; b: number; s: number; d: number; p: number }[] = [
  { l: 18, b: 18, s: 3, d: 0, p: 7 },
  { l: 30, b: 10, s: 2, d: 2.4, p: 8 },
  { l: 44, b: 22, s: 2.5, d: 4.1, p: 6.5 },
  { l: 58, b: 12, s: 2, d: 1.2, p: 7.5 },
  { l: 70, b: 20, s: 3, d: 3.3, p: 6 },
  { l: 82, b: 14, s: 2, d: 5.2, p: 8.5 },
  { l: 10, b: 30, s: 2, d: 6, p: 7 },
  { l: 90, b: 32, s: 2.5, d: 0.8, p: 7.8 },
];

/** The stage's colours as CSS variables (for anything else lit by the same shiny). */
export function stageVars(a: string, b: string): CSSProperties {
  return { "--sa": a, "--sb": b } as CSSProperties;
}

/** The chance-by-now ring: a track, the arc so far, marks at 50% and 90%, and a light at the arc's tip. */
function Ring({ chance, marks }: { chance: number; marks?: boolean }) {
  const r = 47;
  const v = Math.max(0, Math.min(1, chance));
  const tip = (v * 2 * Math.PI) - Math.PI / 2;
  const dot = (f: number) => [50 + r * Math.cos(f * 2 * Math.PI - Math.PI / 2), 50 + r * Math.sin(f * 2 * Math.PI - Math.PI / 2)];
  return (
    <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full overflow-visible" aria-hidden>
      <defs>
        <linearGradient id="sh-ring-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fff2b8" />
          <stop offset="0.5" stopColor="#ffc93c" />
          <stop offset="1" stopColor="#ff9a1f" />
        </linearGradient>
        <filter id="sh-ring-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1.1" />
        </filter>
      </defs>
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgb(255 255 255 / 0.09)" strokeWidth="1.6" />
      <circle cx="50" cy="50" r={r + 2.4} fill="none" stroke="rgb(255 255 255 / 0.05)" strokeWidth="0.4" strokeDasharray="0.6 2.2" />
      {v > 0 && (
        <g transform="rotate(-90 50 50)">
          <circle cx="50" cy="50" r={r} fill="none" stroke="#ffc93c" strokeWidth="2.4" strokeLinecap="round" pathLength={1} strokeDasharray={`${Math.max(v, 0.004)} 1`} filter="url(#sh-ring-glow)" opacity="0.7" className="transition-[stroke-dasharray] duration-500 motion-reduce:transition-none" />
          <circle cx="50" cy="50" r={r} fill="none" stroke="url(#sh-ring-g)" strokeWidth="1.9" strokeLinecap="round" pathLength={1} strokeDasharray={`${Math.max(v, 0.004)} 1`} className="transition-[stroke-dasharray] duration-500 motion-reduce:transition-none" />
        </g>
      )}
      {marks &&
        [0.5, 0.9].map((m) => {
          const [x, y] = dot(m);
          return <circle key={m} cx={x} cy={y} r="1.15" fill={v >= m ? "#fff2b8" : "rgb(255 255 255 / 0.35)"} stroke="#0d0a1d" strokeWidth="0.5" />;
        })}
      {v > 0.004 && <circle cx={50 + r * Math.cos(tip)} cy={50 + r * Math.sin(tip)} r="1.9" fill="#fff" style={{ filter: "drop-shadow(0 0 2px #ffe08a)" }} />}
    </svg>
  );
}

/**
 * A shiny on its lit stage: a spotlight and glow in its own colours, a battle platform in its type's, sparkles and
 * drifting motes, and (when given) the chance-by-now ring. `children` lay over the stage (labels, buttons).
 */
export function ShinyStage({
  id,
  type,
  chance,
  alt,
  pulse = 0,
  compact,
  className,
  figureClassName,
  children,
  testId,
}: {
  id: number;
  type: string | null;
  chance?: number;
  alt?: string;
  /** Bumped on each count: the stage flashes softly. */
  pulse?: number;
  compact?: boolean;
  className?: string;
  figureClassName?: string;
  children?: ReactNode;
  testId?: string;
}) {
  const { a, b, onPalette } = useStageColours(id, type);
  return (
    <div className={cn("sh-stage dark-scope", className)} style={stageVars(a, b)} data-testid={testId}>
      <div className="sh-beam" aria-hidden />
      {!compact && MOTES.map((m, i) => <span key={i} className="sh-mote" style={{ left: `${m.l}%`, bottom: `${m.b}%`, width: m.s, height: m.s, animationDelay: `${m.d}s`, animationDuration: `${m.p}s` }} aria-hidden />)}
      {pulse > 0 && <span key={pulse} className="sh-pulse" aria-hidden />}
      <div className={cn("relative mx-auto aspect-square", figureClassName)}>
        <div className="sh-platform sh-shadow bottom-[1%] w-[78%]" aria-hidden />
        {chance !== undefined && <Ring chance={chance} marks />}
        <div className="sh-glow inset-[16%]" aria-hidden />
        <div className={cn("sh-float absolute", chance !== undefined ? "inset-[10%]" : "inset-[4%]")}>
          <MonArt id={id} shiny size={compact ? "md" : "lg"} eager={!compact} alt={alt} onPalette={onPalette} className="h-full w-full drop-shadow-[0_18px_22px_rgb(0_0_0/0.55)]" />
        </div>
        <Twinkles scale={compact ? 0.6 : 1.1} />
      </div>
      {children}
    </div>
  );
}
