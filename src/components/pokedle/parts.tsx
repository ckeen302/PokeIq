"use client";

/* eslint-disable @next/next/no-img-element -- tiny sprites; next/image adds nothing here */
import { motion, useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowUp } from "lucide-react";
import { DLE_COLUMNS, isNear, statusArrow, type CellStatus, type DleCell, type DleColumn, type DleRow } from "@/lib/dle-types";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import board from "@/messages/pokedle-board";
import type { BoardT } from "@/lib/dle-i18n";
import { useDleWords } from "./lexicon";
import { spriteUrl } from "./guess-input";

/** Pokédle's guess box and board, shared by the daily puzzle and duels. */

export type { NameEntry } from "./search";

export { GuessInput, spriteUrl } from "./guess-input";


/** Each clue's look (globals.css: colour-blind mode swaps the palette; close cells have a dashed border). */
export const CELL_STYLES: Record<CellStatus, string> = {
  match: "dle-match",
  partial: "dle-partial",
  "close-higher": "dle-close",
  "close-lower": "dle-close",
  higher: "dle-far",
  lower: "dle-far",
  miss: "dle-miss",
};

/** What each clue means, in words (screen readers, tooltips). */
export const statusText = (t: BoardT, status: CellStatus) => t(`status.${status}`);

/** The glyph on every clue, so none relies on colour alone: ✓ match, ≈ near (with the arrow when close), ▲▼ the way to go, ✕ wrong. */
export function CellGlyph({ status, size = "h-3.5 w-3.5" }: { status: CellStatus; size?: string }) {
  const arrow = statusArrow(status);
  const Arrow = arrow === "up" ? ArrowUp : ArrowDown;
  return (
    <span className="flex items-center gap-0.5 leading-none" aria-hidden>
      {status === "match" && <span>✓</span>}
      {isNear(status) && <span>≈</span>}
      {status === "miss" && <span>✕</span>}
      {arrow && <Arrow className={cn(size, status === "higher" || status === "lower" ? "text-primary" : "")} />}
    </span>
  );
}


/** What each clue's colour and mark means: under every board, so no clue relies on remembering the how-to. */
export function ClueLegend({ close = true, className }: { close?: boolean; className?: string }) {
  const t = useT(board);
  const items: { status: CellStatus; label: string; glyph?: React.ReactNode }[] = [
    { status: "match", label: t("legend.match") },
    { status: "partial", label: t("legend.partial") },
    ...(close ? [{ status: "close-higher" as const, label: t("legend.close") }] : []),
    {
      status: "higher",
      label: t("legend.higherLower"),
      glyph: (
        <span className="flex items-center leading-none" aria-hidden>
          <ArrowUp className="h-3 w-3 text-primary" />
          <ArrowDown className="h-3 w-3 text-primary" />
        </span>
      ),
    },
    { status: "miss", label: t("legend.miss") },
  ];
  return (
    <ul className={cn("flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground", className)} aria-label={t("legend.label")} data-testid="clue-legend">
      {items.map((it) => (
        <li key={it.status} className="flex items-center gap-1.5">
          <span className={cn("flex h-5 w-7 items-center justify-center rounded border text-[10px] font-semibold", CELL_STYLES[it.status])}>
            {it.glyph ?? <CellGlyph status={it.status} size="h-3 w-3" />}
          </span>
          {it.label}
        </li>
      ))}
    </ul>
  );
}

/**
 * Every guess so far, newest on top, with each clue's colour and glyph.
 * Only the newest guess flips in (cell by cell), and not at all for
 * players who prefer reduced motion. `onClue` makes each clue a button (the
 * Full Pokédex's clue filters).
 *
 * `slots` keeps a place for every guess the game allows (the empty ones
 * dashed, at the bottom), so the board never changes height as you play;
 * `pending` shows a guess at once, before its clues come back. On a phone
 * each guess's name sits on a line of its own above its clues, so all the
 * clue columns fit the screen.
 */
export function Board({
  rows,
  columns,
  close = true,
  flipNewest = true,
  onClue,
  slots,
  pending,
}: {
  rows: DleRow[];
  /** The game's clue columns (default: the ones the rows have). */
  columns?: readonly DleColumn[];
  /** False: the game has no close states (the headers' help leaves them out). */
  close?: boolean;
  flipNewest?: boolean;
  onClue?: (column: DleColumn, guessId: number, cell: DleCell) => void;
  /** How many guesses the game allows: the rest are drawn as empty places. */
  slots?: number;
  /** A guess on its way to the server. */
  pending?: { id: number; name: string } | null;
}) {
  const reduced = useReducedMotion();
  const words = useDleWords();
  const t = useT(board);
  const shown = DLE_COLUMNS.filter((c) => (columns ? columns.includes(c.key) : rows.some((r) => r.cells[c.key])));
  const pendingRow = pending && !rows.some((r) => r.id === pending.id) ? pending : null;
  const empty = Math.max(0, (slots ?? 0) - rows.length - (pendingRow ? 1 : 0));
  // A phone: the clues share the width (the name above them). Wider: fixed tracks, a full name beside its sprite, every tile the same size.
  const grid = "grid gap-1 grid-cols-[repeat(var(--dle-n),minmax(0,1fr))] sm:gap-1.5 sm:grid-cols-[10rem_repeat(var(--dle-n),3.75rem)]";
  const done = shown.length * 0.12 + 0.4;

  return (
    <div className="pb-2 sm:-mx-4 sm:overflow-x-auto sm:px-4">
      <div className="w-full space-y-1.5 sm:mx-auto sm:w-max" role="table" aria-label={t("board.label")} style={{ "--dle-n": shown.length } as React.CSSProperties}>
        <div className={cn(grid, "hud-label text-center")} role="row">
          <div className="sr-only sm:not-sr-only sm:text-left" role="columnheader">
            {t("board.pokemon")}
          </div>
          {shown.map((c) => (
            <div
              key={c.key}
              role="columnheader"
              title={t(`${close ? "help" : "helpStrict"}.${c.key}`)}
              className="mp-dense cursor-help truncate text-[8px] tracking-normal underline decoration-dotted decoration-foreground/30 underline-offset-2 sm:text-[10px] sm:tracking-[0.12em] max-md:font-display max-md:text-[length:10.5px] max-md:font-semibold"
            >
              {t(`column.${c.key}`)}
            </div>
          ))}
        </div>
        {pendingRow && (
          <div key={`row-${pendingRow.id}`} className={grid} role="row" aria-busy="true">
            <RowName id={pendingRow.id} name={pendingRow.name} />
            {shown.map((c) => (
              <div key={c.key} role="cell" className="h-11 rounded-lg border border-foreground/15 bg-card/60 motion-safe:animate-pulse sm:h-12" aria-label={t("board.checking", { label: t(`column.${c.key}`) })} />
            ))}
          </div>
        )}
        {[...rows].reverse().map((sent, r) => {
          const row = words.row(sent);
          // Rows are keyed by Pokémon, so only a new row mounts (and flips); the rest stay put.
          const flip = flipNewest && !reduced && r === 0 && !pendingRow;
          return (
            <motion.div
              key={`row-${row.id}`}
              className={grid}
              role="row"
              animate={flip && row.solved ? { scale: [1, 1.04, 1] } : undefined}
              transition={flip && row.solved ? { delay: done, duration: 0.45 } : undefined}
              data-solved={row.solved || undefined}
            >
              <RowName id={row.id} name={row.name} />
              {shown.map((c, i) => {
                const cell = row.cells[c.key];
                return cell ? (
                  <Cell key={c.key} label={t(`column.${c.key}`)} cell={cell} delay={flip ? i * 0.12 : null} onClick={onClue ? () => onClue(c.key, row.id, sent.cells[c.key]!) : undefined} />
                ) : (
                  <div key={c.key} role="cell" />
                );
              })}
            </motion.div>
          );
        })}
        {Array.from({ length: empty }, (_, i) => (
          <div key={`empty-${i}`} className={grid} aria-hidden data-testid="dle-empty-row">
            <div className="col-span-full flex h-7 items-center pl-1 font-pixel text-[9px] uppercase tracking-[0.12em] text-muted-foreground/40 sm:col-span-1 sm:h-12 sm:rounded-lg sm:border sm:border-dashed sm:border-foreground/10 sm:pl-3">
              {t("board.empty", { n: rows.length + (pendingRow ? 1 : 0) + i + 1 })}
            </div>
            {shown.map((c) => (
              <div key={c.key} className="h-11 rounded-lg border border-dashed border-foreground/10 sm:h-12" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** A guess's sprite and name: its own line on a phone, the first column wider. */
function RowName({ id, name }: { id: number; name: string }) {
  return (
    <div
      className="col-span-full flex h-7 min-w-0 items-center gap-1.5 sm:col-span-1 sm:h-12 sm:rounded-lg sm:border sm:bg-card/80 sm:pl-1 sm:pr-2"
      role="rowheader"
      title={name}
    >
      <img src={spriteUrl(id)} alt="" width={36} height={36} decoding="async" className="h-7 w-7 shrink-0 sm:h-9 sm:w-9" />
      <span className="min-w-0 truncate text-xs font-semibold leading-tight sm:line-clamp-2 sm:whitespace-normal sm:break-words">{name}</span>
    </div>
  );
}

/** A clue as words: "Height 1.2 m: close, the answer is higher" (`cell.value` as it reads in the page's language). */
export const clueText = (t: BoardT, label: string, cell: DleCell) => t("board.clue", { label, value: cell.value, status: statusText(t, cell.status) });

function Cell({ cell, label, delay, onClick }: { cell: DleCell; label: string; delay: number | null; onClick?: () => void }) {
  const t = useT(board);
  const text = clueText(t, label, cell);
  const className = cn(
    "mp-dense flex h-11 w-full flex-col items-center justify-center gap-0.5 rounded-lg border px-0.5 text-center text-[10px] font-semibold leading-tight sm:h-12 sm:px-1 sm:text-[11px]",
    CELL_STYLES[cell.status],
    onClick && "cursor-pointer transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  );
  const body = (
    <>
      {/* "Fighting" and "Electric" don't fit a phone's seven-column row at 10px. */}
      <span className={cn("max-w-full truncate", cell.value.length > 7 && "text-[9px] tracking-tight sm:text-[11px] sm:tracking-normal")}>{cell.value}</span>
      <CellGlyph status={cell.status} />
    </>
  );
  return (
    <motion.div
      role="cell"
      className="min-w-0"
      style={{ transformPerspective: 600 }}
      initial={delay === null ? false : { rotateX: -90, opacity: 0 }}
      animate={{ rotateX: 0, opacity: 1 }}
      transition={{ delay: delay ?? 0, duration: 0.4, ease: [0.2, 0.7, 0.3, 1] }}
    >
      {onClick ? (
        <button type="button" onClick={onClick} className={className} aria-label={t("board.filterAria", { clue: text })} title={t("board.filterTitle", { clue: text })}>
          {body}
        </button>
      ) : (
        <div className={className} aria-label={text} title={text}>
          {body}
        </div>
      )}
    </motion.div>
  );
}
