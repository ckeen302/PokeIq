"use client";

/* eslint-disable @next/next/no-img-element -- small sprites from the site's own art route; next/image adds nothing here */
import { forwardRef } from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { typeColor, typeTextColor } from "@/lib/pokemon/type-colors";
import { artUrl } from "@/lib/pokemon/art";
import { CONN_LEVELS, type ConnGroupExplained, type ConnGroupReveal, type ConnLevel, type ConnTile } from "@/lib/connections/types";
import { cn } from "@/lib/utils";

/** The group colour as a CSS colour, and dark text that reads on it in either theme. */
export const levelStyle = (level: ConnLevel) => ({ background: CONN_LEVELS[level].hex, color: "#17142b" });

/** A group's symbol (● ▲ ■ ◆), so a group never relies on its colour alone. */
export function LevelMark({ level, className }: { level: ConnLevel; className?: string }) {
  return (
    <span className={cn("inline-block w-[1em] text-center leading-none", className)} aria-hidden>
      {CONN_LEVELS[level].symbol}
    </span>
  );
}

/**
 * A tile's picture: a sprite for a Pokémon, a type-coloured chip for a move
 * or a type, an icon for an ability. `size` is the box in pixels.
 */
export function TileArt({ tile, size, className }: { tile: ConnTile; size: number; className?: string }) {
  // width/height reserve the box before the sprite arrives (no layout shift); 160px art stays crisp on a 3x phone at the grid's size.
  if (!tile.kind) return <img src={artUrl(tile.id, size <= 48 ? 96 : 160)} alt="" width={size} height={size} decoding="async" draggable={false} className={className} />;
  const small = size <= 48;
  if (tile.kind === "ability") {
    return (
      <span aria-hidden data-tile-kind="ability" className={cn("flex items-center justify-center rounded-full border-2 border-dashed border-foreground/30 bg-muted text-foreground/70", className)}>
        <Sparkles className={small ? "h-4 w-4" : "h-7 w-7"} />
      </span>
    );
  }
  const type = tile.type ?? "normal";
  return (
    <span
      aria-hidden
      data-tile-kind={tile.kind}
      className={cn("flex items-center justify-center font-display font-bold uppercase leading-none", tile.kind === "move" ? "rounded-md" : "rounded-full", small ? "text-[8px]" : "text-[11px]", className)}
      style={{ background: typeColor(type), color: typeTextColor(type) }}
    >
      {tile.kind === "move" ? "Move" : type}
    </span>
  );
}

/** What a tile is, in words, for screen readers and the "Why?" panel. */
export const tileKindLabel = (tile: ConnTile) => (tile.kind === "move" ? "Move" : tile.kind === "ability" ? "Ability" : tile.kind === "type" ? "Type" : "Pokémon");

export type TileMotion = "jump" | "shake" | null;

/** A tile's (and a found group's bar's) height: the whole 4×4 board and its buttons fit a 390×844 phone and a 1440×900 laptop without scrolling. */
export const TILE_H4 = "h-[5.75rem] sm:h-[7rem]";
export const TILE_H5 = "h-[4.75rem] sm:h-[6rem]";

/** One Pokémon on the grid: its sprite and name, selectable. */
export const GridTile = forwardRef<
  HTMLButtonElement,
  {
    tile: ConnTile;
    index: number;
    selected: boolean;
    disabled: boolean;
    motionKind: TileMotion;
    /** Position in the jump's stagger (0–3). */
    order: number;
    onToggle: () => void;
    onKeyDown: (e: React.KeyboardEvent<HTMLButtonElement>) => void;
    /** The hint: this Pokémon belongs to the easiest group not found yet. */
    hinted?: boolean;
    /** A 5×5 board: smaller tiles, so five fit across. */
    compact?: boolean;
  }
>(function GridTile({ tile, index, selected, disabled, motionKind, order, onToggle, onKeyDown, hinted, compact }, ref) {
  // The name always fits on one line: its size shrinks with its length against the tile's width (a container query).
  const fit = { "--conn-chars": Math.max(tile.name.length, 6) } as React.CSSProperties;
  return (
    <motion.button
      ref={ref}
      layout
      type="button"
      data-index={index}
      data-testid="conn-tile"
      data-id={tile.id}
      data-hinted={hinted ? "true" : undefined}
      aria-pressed={selected}
      aria-label={`${tile.kind ? `${tileKindLabel(tile)} ` : ""}${tile.name}${hinted ? ", hint: in the easiest group left" : ""}${selected ? ", selected" : ""}`}
      disabled={disabled}
      onClick={onToggle}
      onKeyDown={onKeyDown}
      transition={{ layout: { type: "spring", stiffness: 420, damping: 36 } }}
      animate={
        motionKind === "jump"
          ? { y: [0, -14, 0], transition: { duration: 0.32, delay: order * 0.09 } }
          : motionKind === "shake"
            ? { x: [0, -7, 7, -5, 5, -2, 0], transition: { duration: 0.42 } }
            : { y: 0, x: 0 }
      }
      whileTap={disabled ? undefined : { scale: 0.96 }}
      className={cn(
        "group relative flex min-w-0 select-none flex-col items-center justify-center gap-0.5 rounded-lg border px-1 pb-1.5 pt-1 text-center [container-type:inline-size] [-webkit-tap-highlight-color:transparent] sm:px-1.5 sm:pb-2",
        "transition-[background-color,border-color,color,box-shadow] duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        compact ? TILE_H5 : TILE_H4,
        selected
          ? "border-screen bg-screen text-background shadow-[0_3px_0_hsl(var(--screen)/0.45)]"
          : "border-foreground/10 bg-card text-foreground shadow-[0_3px_0_hsl(var(--border))] hover:border-screen/60 hover:bg-screen/[0.07]",
        hinted && !selected && "ring-2 ring-warning ring-offset-1 ring-offset-background",
        disabled && !selected && "cursor-default"
      )}
    >
      {hinted && (
        <span aria-hidden className="absolute right-1 top-1 text-xs">
          💡
        </span>
      )}
      <TileArt
        tile={tile}
        size={76}
        className={cn(compact ? "h-10 w-10 sm:h-14 sm:w-14" : "h-14 w-14 sm:h-[4.25rem] sm:w-[4.25rem]", "pointer-events-none object-contain transition-transform duration-150", !selected && "group-hover:scale-105")}
      />
      <span
        style={fit}
        className={cn(
          "block w-full overflow-hidden whitespace-nowrap font-display font-bold uppercase leading-tight",
          compact
            ? "text-[min(10px,calc(100cqw/(var(--conn-chars)*0.8)))] sm:text-[min(12px,calc(100cqw/(var(--conn-chars)*0.76)))]"
            : "text-[min(11px,calc(100cqw/(var(--conn-chars)*0.72)))] sm:text-[min(14px,calc(100cqw/(var(--conn-chars)*0.76)))] sm:tracking-wide"
        )}
      >
        {tile.name}
      </span>
    </motion.button>
  );
});

/** A found group: a coloured bar with its name and its four Pokémon. */
export function GroupBar({ group, symbols, revealed, compact }: { group: ConnGroupReveal; symbols: boolean; revealed?: boolean; compact?: boolean }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.9, y: 6 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 420, damping: 24 }}
      className={cn(
        "relative flex flex-col items-center justify-center gap-1 overflow-hidden rounded-lg px-4 text-center shadow-[0_3px_0_rgb(0_0_0/0.25)]",
        compact ? TILE_H5 : TILE_H4
      )}
      style={levelStyle(group.level)}
      data-testid="conn-group"
      data-level={group.level}
      role="group"
      aria-label={`${CONN_LEVELS[group.level].name} group${revealed ? " (revealed)" : ""}: ${group.label}: ${group.members.map((m) => m.name).join(", ")}`}
    >
      {!revealed && (
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent"
          initial={{ x: "-120%" }}
          animate={{ x: "420%" }}
          transition={{ duration: 0.7, delay: 0.12, ease: "easeOut" }}
        />
      )}
      <p className="flex items-center gap-2 font-display text-sm font-bold uppercase leading-tight tracking-wide sm:text-lg">
        {symbols && <LevelMark level={group.level} className="text-sm opacity-70" />}
        {group.label}
        {symbols && <LevelMark level={group.level} className="text-sm opacity-70" />}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-0 sm:gap-x-3 sm:gap-y-0.5">
        {group.members.map((m) => (
          <span key={m.id} className="flex items-center gap-0.5 text-xs font-semibold sm:gap-1 sm:text-sm">
            <TileArt tile={m} size={32} className="h-6 w-6 shrink-0 object-contain sm:h-8 sm:w-8" />
            {m.name}
          </span>
        ))}
      </div>
    </motion.div>
  );
}

/** Mistakes left, as dots: a lost one pops and turns into an empty ring; the last one left turns red. */
export function MistakeDots({ left, max }: { left: number; max: number }) {
  const last = left === 1;
  return (
    <div className={cn("flex items-center justify-center gap-3 text-sm transition-colors", last ? "font-semibold text-destructive" : "text-muted-foreground")} data-testid="conn-mistakes" data-left={left} aria-label={`${left} of ${max} mistakes left`}>
      {last ? "Last chance:" : "Mistakes remaining:"}
      <span className="flex gap-1.5" aria-hidden>
        {Array.from({ length: max }, (_, i) => (
          <motion.span
            key={i}
            initial={false}
            animate={i < left ? { scale: 1, opacity: 1 } : { scale: [1, 1.6, 0.85], opacity: [1, 1, 0.55] }}
            transition={{ duration: 0.35 }}
            className={cn("h-3.5 w-3.5 rounded-full border-2", i < left ? (last ? "border-destructive bg-destructive" : "border-foreground/80 bg-foreground/80") : "border-foreground/30 bg-transparent")}
          />
        ))}
      </span>
    </div>
  );
}

/** The guesses as rows of coloured squares, with each group's symbol (the share's grid). */
export function GuessHistory({ rows, symbols }: { rows: ConnLevel[][]; symbols: boolean }) {
  return (
    <div className="inline-flex flex-col gap-1" role="img" aria-label={rows.map((r, i) => `Guess ${i + 1}: ${r.map((l) => CONN_LEVELS[l].name).join(", ")}`).join(". ")}>
      {rows.map((row, i) => (
        <div key={i} className="flex gap-1">
          {row.map((level, j) => (
            <span key={j} className="flex h-7 w-7 items-center justify-center rounded-[5px] text-[11px] shadow-[inset_0_-2px_0_rgb(0_0_0/0.18)]" style={levelStyle(level)}>
              {symbols && <LevelMark level={level} className="opacity-60" />}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** The "Why?" panel: each group's rule, a line per Pokémon, and the red herrings that pointed at it. */
export function WhyPanel({ groups, symbols }: { groups: ConnGroupExplained[]; symbols: boolean }) {
  return (
    <section aria-labelledby="conn-why" className="space-y-3" data-testid="conn-why">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="conn-why" className="font-display text-2xl font-bold uppercase tracking-tight">
          Why?
        </h2>
        <p className="hud-label">Every fact is from the Pokédex data</p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        {groups.map((g) => (
          <article key={g.level} className="overflow-hidden rounded-lg border bg-card">
            <header className="flex items-center gap-2 px-4 py-2.5" style={levelStyle(g.level)}>
              {symbols && <LevelMark level={g.level} className="text-xs opacity-70" />}
              <h3 className="font-display text-sm font-bold uppercase tracking-wide">{g.label}</h3>
            </header>
            <div className="space-y-2.5 p-4">
              <p className="text-sm text-muted-foreground">{g.rule}</p>
              <ul className="space-y-1.5">
                {g.lines.map((l) => (
                  <li key={l.id} className="flex items-center gap-2.5 text-sm">
                    <TileArt tile={l} size={32} className="h-8 w-8 shrink-0 object-contain" />
                    <span className="min-w-0">
                      <b className="font-semibold">{l.name}</b>
                      {l.kind && <span className="ml-1 rounded bg-muted px-1 py-px align-middle text-[10px] font-semibold uppercase text-muted-foreground">{tileKindLabel(l)}</span>}
                      <span className="text-muted-foreground">: {l.why}</span>
                    </span>
                  </li>
                ))}
              </ul>
              {g.herrings.length > 0 && (
                <div className="space-y-1 border-t border-dashed pt-2.5">
                  <p className="hud-label">Red herrings</p>
                  <ul className="space-y-1">
                    {g.herrings.map((h) => (
                      <li key={h.id} className="text-xs text-muted-foreground">
                        <b className="font-semibold text-foreground">{h.name}</b>: {h.reason}.
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
