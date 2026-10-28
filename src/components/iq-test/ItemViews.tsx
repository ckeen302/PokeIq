"use client";

import { motion } from "framer-motion";
import { monName } from "@/lib/cognitive/materials";
import type { ArithItem, MatrixItem, NumberItem, PathItem, PileItem, RotationItem } from "@/lib/cognitive/types";
import { cn } from "@/lib/utils";
import { CellView, MonSprite, PokeBall } from "./CellView";

/**
 * The option-based items. Each view draws its stimulus and hands the
 * options to <OptionGrid />, whose tiles are thumb-sized, keyed 1–6 and
 * flash green or red on the pick (the right answer is never shown: this is
 * a test, not a lesson).
 */

export interface OptionProps {
  picked: number | null;
  correct: boolean | null;
  onPick: (index: number) => void;
}

export function OptionGrid({ count, picked, correct, onPick, render, columns = 3, square }: OptionProps & { count: number; render: (i: number) => React.ReactNode; columns?: 2 | 3; square?: boolean }) {
  const locked = picked !== null;
  return (
    <div className={cn("grid gap-2.5", columns === 3 ? "grid-cols-3" : "grid-cols-2")} role="group" aria-label="Options">
      {Array.from({ length: count }, (_, i) => {
        const isPicked = picked === i;
        return (
          <motion.button
            key={i}
            type="button"
            data-answer-tile
            data-testid="cog-option"
            disabled={locked}
            onClick={() => onPick(i)}
            initial={{ opacity: 0, y: 8 }}
            animate={isPicked && correct === false ? { opacity: 1, y: 0, x: [0, -5, 5, -3, 3, 0] } : { opacity: 1, y: 0 }}
            transition={{ delay: 0.04 * i, duration: 0.22 }}
            className={cn(
              "menu-item relative flex min-h-[64px] w-full items-center justify-center rounded-md border-2 border-foreground/10 bg-shade/30 p-2 font-display text-lg font-semibold",
              square && "aspect-square",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              !locked && "hover:border-screen/60 hover:bg-screen/[0.06] active:scale-[0.98]",
              isPicked && correct === true && "border-success bg-success/15",
              isPicked && correct === false && "border-destructive bg-destructive/15",
              locked && !isPicked && "opacity-50"
            )}
          >
            {render(i)}
            <kbd className="absolute right-1.5 top-1 hidden font-pixel text-[10px] text-muted-foreground sm:inline" aria-hidden>
              {i + 1}
            </kbd>
          </motion.button>
        );
      })}
    </div>
  );
}

export function MatrixView({ item, ...opts }: OptionProps & { item: MatrixItem }) {
  return (
    <div className="space-y-5">
      <div className="mx-auto grid w-full max-w-[330px] grid-cols-3 gap-1.5 rounded-lg border border-foreground/10 bg-shade/20 p-1.5" data-testid="cog-matrix" aria-label="The 3 by 3 pattern, last cell missing">
        {item.cells.map((c, i) => (
          <div key={i} className={cn("flex aspect-square items-center justify-center rounded-md bg-background/60", c.k === "blank" && "border-2 border-dashed border-screen/50")}>
            <CellView cell={c} box={88} />
          </div>
        ))}
      </div>
      <OptionGrid count={item.options.length} {...opts} square render={(i) => <CellView cell={item.options[i]} box={80} />} />
    </div>
  );
}

export function NumberView({ item, ...opts }: OptionProps & { item: NumberItem }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-center gap-2" aria-label="The sequence">
        {item.terms.map((t, i) => (
          <span key={i} className="screen flex h-14 min-w-14 items-center justify-center rounded-md px-3 font-display text-2xl font-bold tabular-nums">
            <span className="relative z-[3]">{t}</span>
          </span>
        ))}
        <span className="flex h-14 min-w-14 items-center justify-center rounded-md border-2 border-dashed border-screen/60 px-3 font-display text-2xl font-bold text-muted-foreground">?</span>
      </div>
      <OptionGrid count={item.options.length} {...opts} render={(i) => <span className="tabular-nums">{item.options[i]}</span>} />
    </div>
  );
}

export function ArithView({ item, ...opts }: OptionProps & { item: ArithItem }) {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-4 rounded-lg border border-foreground/10 bg-shade/20 p-4">
        <MonSprite id={item.monId} size={72} className="shrink-0" />
        <p className="text-[17px] font-medium leading-snug">{item.prompt}</p>
      </div>
      <OptionGrid count={item.options.length} {...opts} render={(i) => <span className="tabular-nums">{item.options[i]}</span>} />
    </div>
  );
}

export function RotationView({ item, ...opts }: OptionProps & { item: RotationItem }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-col items-center gap-2">
        <div className="screen flex h-36 w-36 items-center justify-center rounded-md">
          <MonSprite id={item.monId} size={120} className="relative z-[3]" />
        </div>
        <p className="text-center text-sm text-muted-foreground">Which one is this {monName(item.monId)} turned — not mirrored?</p>
      </div>
      <OptionGrid count={item.options.length} {...opts} square columns={item.options.length > 4 ? 3 : 2} render={(i) => <MonSprite id={item.monId} size={84} rot={item.options[i].rot} flip={item.options[i].flip} />} />
    </div>
  );
}

export function PathView({ item, ...opts }: OptionProps & { item: PathItem }) {
  const n = item.size;
  const t = 100 / n;
  return (
    <div className="space-y-5">
      <div className="mx-auto w-full max-w-[300px]">
        <svg viewBox="0 0 100 100" className="w-full rounded-lg border border-foreground/10" role="img" aria-label={`A ${n} by ${n} route map`}>
          <rect width="100" height="100" fill="#7ac74c" />
          {item.walls.map((w, i) => {
            const x = (i % n) * t;
            const y = Math.floor(i / n) * t;
            return (
              <g key={i}>
                <rect x={x} y={y} width={t} height={t} fill={w ? "#2f5a2a" : i % 2 === Math.floor(i / n) % 2 ? "#8bd45c" : "#7ac74c"} stroke="#5a9a3a" strokeWidth="0.4" />
                {w && <circle cx={x + t / 2} cy={y + t / 2} r={t * 0.3} fill="#1f3f1c" />}
              </g>
            );
          })}
          <g transform={`translate(${(item.start % n) * t + t / 2} ${Math.floor(item.start / n) * t + t / 2})`}>
            <circle r={t * 0.36} fill="#e3350d" stroke="#1b1b1b" strokeWidth="1" />
            <path d={`M${-t * 0.36} 0 h${t * 0.72}`} stroke="#1b1b1b" strokeWidth="1" />
            <circle r={t * 0.1} fill="#fafafa" stroke="#1b1b1b" strokeWidth="0.8" />
          </g>
          <g transform={`translate(${(item.goal % n) * t + t / 2} ${Math.floor(item.goal / n) * t + t / 2})`}>
            <rect x={-t * 0.35} y={-t * 0.35} width={t * 0.7} height={t * 0.7} rx={t * 0.08} fill="#fcc33a" stroke="#1b1b1b" strokeWidth="1" />
            <path d={`M${-t * 0.18} ${t * 0.2} v${-t * 0.4} h${t * 0.36}`} stroke="#1b1b1b" strokeWidth="1.2" fill="none" />
          </g>
        </svg>
        <p className="mt-2 text-center text-sm text-muted-foreground">Fewest steps from the Poké Ball to the Gym (up, down, left, right; trees block)?</p>
      </div>
      <OptionGrid count={item.options.length} {...opts} render={(i) => <span className="tabular-nums">{item.options[i]}</span>} />
    </div>
  );
}

/** The pile in a slanted 3D-ish projection, back to front, bottom to top. */
function Pile({ layers }: { layers: readonly [number, number][] }) {
  const R = 10;
  const balls: { x: number; y: number; order: number }[] = [];
  layers.forEach(([rows, cols], l) => {
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        const ii = i + l * 0.5;
        const jj = j + l * 0.5;
        balls.push({ x: (jj - ii) * R, y: (jj + ii) * R * 0.5 - l * R * 1.15, order: l * 1000 + ii + jj });
      }
    }
  });
  balls.sort((a, b) => a.order - b.order);
  const xs = balls.map((b) => b.x);
  const ys = balls.map((b) => b.y);
  const minX = Math.min(...xs) - R * 1.2;
  const maxX = Math.max(...xs) + R * 1.2;
  const minY = Math.min(...ys) - R * 1.2;
  const maxY = Math.max(...ys) + R * 1.2;
  return (
    <svg viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`} className="mx-auto h-56 w-full max-w-[320px]" role="img" aria-label="A pile of Poké Balls">
      {balls.map((b, i) => (
        <PokeBall key={i} size={R * 2} x={b.x - R} y={b.y - R} />
      ))}
    </svg>
  );
}

export function PileView({ item, ...opts }: OptionProps & { item: PileItem }) {
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-foreground/10 bg-shade/20 p-2">
        <Pile layers={item.layers} />
        <p className="pb-1 text-center text-sm text-muted-foreground">How many Poké Balls in the pile, the hidden ones included? Every ball rests on balls below it.</p>
      </div>
      <OptionGrid count={item.options.length} {...opts} render={(i) => <span className="tabular-nums">{item.options[i]}</span>} />
    </div>
  );
}
