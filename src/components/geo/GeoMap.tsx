"use client";

import { useRef } from "react";
import type { GeoRegionInfo } from "@/lib/geo-types";
import { cn } from "@/lib/utils";

export interface MapPin {
  x: number;
  y: number;
}

export interface RevealedRound {
  guess: MapPin | null;
  answer: { pin: [number, number]; mask: [number, number][] };
  /** Round number shown on the markers in the end-of-game summary. */
  label?: string;
}

interface Props {
  region: GeoRegionInfo;
  /** The pin being placed this round. */
  pick?: MapPin | null;
  /** Rounds to reveal: the true area, its flag, and a line from the guess. */
  revealed?: RevealedRound[];
  onPick?: (pin: MapPin) => void;
  className?: string;
}

/** A region's town map: click/tap drops the guess pin; revealed rounds draw guess → answer. */
export function GeoMap({ region, pick, revealed = [], onPick, className }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { width: W, height: H } = region.map;
  // Small maps are pixel art: scale them crisply.
  const pixelArt = Math.max(W, H) <= 420;
  const u = Math.max(W, H) / 100;

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!onPick || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    onPick({
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    });
  }

  return (
    <div
      ref={ref}
      onClick={handleClick}
      className={cn("relative w-full select-none overflow-hidden rounded-md border-2 border-foreground/20 bg-shade/30", onPick && "cursor-crosshair", className)}
      style={{ aspectRatio: `${W} / ${H}` }}
      role={onPick ? "application" : "img"}
      aria-label={onPick ? `Map of ${region.name}: click where you think this is` : `Map of ${region.name}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- pixel maps need exact scaling, not next/image */}
      <img
        src={region.map.src}
        alt=""
        draggable={false}
        className="absolute inset-0 h-full w-full"
        style={{ imageRendering: pixelArt ? "pixelated" : "auto" }}
      />
      <svg viewBox={`0 0 ${W} ${H}`} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden>
        {revealed.map((r, i) => (
          <g key={i}>
            {r.answer.mask.map(([x, y], k) => (
              <circle key={k} cx={x * W} cy={y * H} r={u * 1.4} className="fill-success/60" />
            ))}
            {r.guess && (
              <line
                x1={r.guess.x * W}
                y1={r.guess.y * H}
                x2={r.answer.pin[0] * W}
                y2={r.answer.pin[1] * H}
                strokeWidth={u * 0.6}
                strokeDasharray={`${u * 1.8} ${u * 1.2}`}
                stroke="#120f24"
              />
            )}
            <Flag x={r.answer.pin[0] * W} y={r.answer.pin[1] * H} u={u} />
            {r.guess && <Ball x={r.guess.x * W} y={r.guess.y * H} u={u} label={r.label} />}
          </g>
        ))}
        {pick && <Ball x={pick.x * W} y={pick.y * H} u={u} />}
      </svg>
    </div>
  );
}

/** The guess marker: a tiny Poké Ball. */
function Ball({ x, y, u, label }: { x: number; y: number; u: number; label?: string }) {
  const r = u * 3;
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={r} fill="#fff" stroke="#120f24" strokeWidth={u * 0.7} />
      <path d={`M${-r} 0a${r} ${r} 0 0 1 ${2 * r} 0z`} fill="#e2306f" stroke="#120f24" strokeWidth={u * 0.7} />
      <circle r={u} fill="#fff" stroke="#120f24" strokeWidth={u * 0.5} />
      {label && (
        <text y={-r - u} textAnchor="middle" fontSize={u * 3.6} fontWeight={700} fill="#fff" stroke="#120f24" strokeWidth={u * 0.8} paintOrder="stroke">
          {label}
        </text>
      )}
    </g>
  );
}

/** The true location: a green flag. */
function Flag({ x, y, u }: { x: number; y: number; u: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle r={u * 1.4} fill="#120f24" />
      <path d={`M0 0V${-u * 7}`} stroke="#120f24" strokeWidth={u * 0.8} />
      <path d={`M0 ${-u * 7}l${u * 4.5} ${u * 1.6}l${-u * 4.5} ${u * 1.6}z`} className="fill-success" stroke="#120f24" strokeWidth={u * 0.5} />
    </g>
  );
}
