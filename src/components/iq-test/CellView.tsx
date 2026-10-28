"use client";

import { monArt, monName } from "@/lib/cognitive/materials";
import type { BallKind, Cell, Glyph, TypeName } from "@/lib/cognitive/types";
import { typeColor, typeTextColor } from "@/lib/pokemon/type-colors";
import { cn } from "@/lib/utils";

/**
 * Draws the test's material: a Pokémon (turned, sized, repeated), type
 * icons, Poké Balls, dot patterns and numbers, from the data in a Cell.
 */

const BALL_COLORS: Record<BallKind, { top: string; mark?: string }> = {
  poke: { top: "#e3350d" },
  great: { top: "#2d6fd6", mark: "#e3350d" },
  ultra: { top: "#2a2a2a", mark: "#f5c400" },
  master: { top: "#7b3fa0", mark: "#f2b5d4" },
  premier: { top: "#f4f4f4", mark: "#e3350d" },
  net: { top: "#2fa6a0", mark: "#1b1b1b" },
};

/** A Poké Ball; with `x`/`y` it nests inside another SVG. */
export function PokeBall({ kind = "poke", size = 32, rot = 0, className, x, y }: { kind?: BallKind; size?: number; rot?: number; className?: string; x?: number; y?: number }) {
  const c = BALL_COLORS[kind];
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} x={x} y={y} className={className} style={{ transform: rot ? `rotate(${rot}deg)` : undefined }} aria-hidden>
      <circle cx="20" cy="20" r="18" fill="#fafafa" stroke="#1b1b1b" strokeWidth="2.5" />
      <path d="M2 20 A18 18 0 0 1 38 20 Z" fill={c.top} stroke="#1b1b1b" strokeWidth="2.5" />
      {c.mark && kind !== "premier" && <path d="M8 11 h8 M24 11 h8" stroke={c.mark} strokeWidth="3" strokeLinecap="round" />}
      {kind === "net" && <path d="M6 14 q14 -6 28 0 M9 9 q11 -3 22 0" stroke={c.mark} strokeWidth="1.5" fill="none" />}
      {kind === "master" && <text x="20" y="13" textAnchor="middle" fontSize="9" fontWeight="700" fill={c.mark} fontFamily="sans-serif">M</text>}
      <rect x="2" y="18.5" width="36" height="3" fill="#1b1b1b" />
      <circle cx="20" cy="20" r="6" fill="#fafafa" stroke="#1b1b1b" strokeWidth="2.5" />
      <circle cx="20" cy="20" r="2.5" fill="#1b1b1b" />
    </svg>
  );
}

export function TypeIcon({ type, size = 36, className }: { type: TypeName; size?: number; className?: string }) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center rounded-full font-pixel text-[9px] uppercase ring-2 ring-black/30", className)}
      style={{ width: size, height: size, background: typeColor(type), color: typeTextColor(type), fontSize: Math.max(8, size * 0.26) }}
      aria-label={`${type} type`}
    >
      {type.slice(0, 3)}
    </span>
  );
}

export function MonSprite({ id, size = 56, rot = 0, flip = false, className }: { id: number; size?: number; rot?: number; flip?: boolean; className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={monArt(id)}
      alt={monName(id)}
      width={size}
      height={size}
      draggable={false}
      className={cn("select-none object-contain", className)}
      style={{ width: size, height: size, transform: `${flip ? "scaleX(-1) " : ""}rotate(${rot}deg)` }}
    />
  );
}

/** The 3×3 dot pattern of a "dots" cell. */
function Dots({ bits, size }: { bits: number; size: number }) {
  const r = size / 3;
  return (
    <div className="grid grid-cols-3" style={{ width: size, height: size }} aria-hidden>
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className="flex items-center justify-center" style={{ width: r, height: r }}>
          {bits & (1 << i) ? <PokeBall size={r * 0.8} /> : <span className="rounded-full bg-foreground/10" style={{ width: r * 0.25, height: r * 0.25 }} />}
        </span>
      ))}
    </div>
  );
}

/** One cell, drawn to fit a box of `box` px. */
export function CellView({ cell, box = 88 }: { cell: Cell; box?: number }) {
  switch (cell.k) {
    case "blank":
      return (
        <span className="font-display text-3xl font-bold text-muted-foreground" aria-label="missing">
          ?
        </span>
      );
    case "num":
      return <span className="font-display text-2xl font-bold tabular-nums">{cell.v}</span>;
    case "dots":
      return <Dots bits={cell.bits} size={box * 0.8} />;
    case "type": {
      const s = cell.n === 1 ? box * 0.5 : box * 0.34;
      return (
        <span className="flex flex-wrap items-center justify-center gap-1" style={{ maxWidth: box * 0.9 }}>
          {Array.from({ length: cell.n }, (_, i) => (
            <TypeIcon key={i} type={cell.t} size={s} />
          ))}
        </span>
      );
    }
    case "ball": {
      const s = cell.n === 1 ? box * 0.55 : box * 0.36;
      return (
        <span className="flex flex-wrap items-center justify-center gap-0.5" style={{ maxWidth: box * 0.92 }}>
          {Array.from({ length: cell.n }, (_, i) => (
            <PokeBall key={i} kind={cell.b} size={s} rot={cell.rot} />
          ))}
        </span>
      );
    }
    case "mon": {
      const base = cell.n === 1 ? box * 0.9 : box * 0.42;
      const s = base * (cell.size === 1 ? 0.5 : cell.size === 2 ? 0.75 : 1);
      return (
        <span className="flex flex-wrap items-center justify-center gap-0.5" style={{ maxWidth: box * 0.95 }}>
          {Array.from({ length: cell.n }, (_, i) => (
            <MonSprite key={i} id={cell.id} size={s} rot={cell.rot} flip={cell.flip} />
          ))}
        </span>
      );
    }
  }
}

export function GlyphView({ glyph, size = 44 }: { glyph: Glyph; size?: number }) {
  return glyph.k === "type" ? <TypeIcon type={glyph.t} size={size} /> : <MonSprite id={glyph.id} size={size} />;
}
