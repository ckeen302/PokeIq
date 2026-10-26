"use client";

/* eslint-disable @next/next/no-img-element -- tiny sprites; next/image adds nothing here */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowUp } from "lucide-react";
import { DLE_COLUMNS, isNear, statusArrow, type CellStatus, type DleCell, type DleColumn, type DleRow } from "@/lib/dle-types";
import { cn } from "@/lib/utils";
import { suggest, type NameEntry } from "./search";

/** Pokédle's guess box and board, shared by the daily puzzle and duels. */

export type { NameEntry } from "./search";

export const spriteUrl = (id: number) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;


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
export const STATUS_TEXT: Record<CellStatus, string> = {
  match: "match",
  partial: "right type, other slot",
  "close-higher": "close, the answer is higher",
  "close-lower": "close, the answer is lower",
  higher: "the answer is higher",
  lower: "the answer is lower",
  miss: "no match",
};

/** What each column's clue compares, for the column headers' tooltips. */
export const COLUMN_HELP: Record<DleColumn, string> = {
  gen: "Generation. Close: one generation away.",
  type1: "Primary type. Yellow: the answer has this type as its second type.",
  type2: "Secondary type (None if it has one). Yellow: the answer has this type as its first type.",
  height: "Height. Close: within 25% (or 0.1 m).",
  weight: "Weight. Close: within 25% (or 0.1 kg).",
  color: "The Pokédex colour. Match or no match.",
  stage: "Evolution stage: Baby, then 1 to 3. Close: one stage away (a Baby is never close).",
};

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


/** `name` with the part that matches what was typed in bold. */
function Highlighted({ name, query }: { name: string; query: string }) {
  const q = query.trim().toLowerCase();
  const at = q ? name.toLowerCase().indexOf(q) : -1;
  if (at < 0) return <>{name}</>;
  return (
    <>
      {name.slice(0, at)}
      <b className="font-bold text-foreground">{name.slice(at, at + q.length)}</b>
      {name.slice(at + q.length)}
    </>
  );
}

/**
 * Type a Pokémon, pick it from the list: arrows (they wrap) and Enter, or a
 * tap. Forgives accents, punctuation and typos (search.ts). The list closes
 * when the box loses focus or on Esc (a second Esc clears the box).
 */
export function GuessInput({
  names,
  exclude,
  disabled,
  placeholder,
  onGuess,
  inputRef,
  fill,
}: {
  names: NameEntry[];
  /** Already guessed: left out of the list. */
  exclude: ReadonlySet<number>;
  disabled?: boolean;
  placeholder: string;
  /** False when the guess wasn't taken (the text stays). */
  onGuess: (entry: NameEntry) => boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  /** A name to put in the box (from the Pokédex beside the board); `n` changes with every fill. */
  fill?: { name: string; n: number } | null;
}) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [open, setOpen] = useState(false);
  const ownRef = useRef<HTMLInputElement | null>(null);
  const ref = inputRef ?? ownRef;
  const listId = useId();
  // A fill from before this box appeared (an earlier round) stays out of it.
  const filled = useRef(fill?.n);

  // "/" jumps to the guess box from anywhere on the page (not while typing elsewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement || (el as HTMLElement | null)?.isContentEditable) return;
      if (!ref.current || ref.current.disabled) return;
      e.preventDefault();
      ref.current.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // The ref never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!fill || fill.n === filled.current) return;
    filled.current = fill.n;
    setQuery(fill.name);
    setHighlight(0);
    setOpen(true);
    ref.current?.focus();
    // Only a new fill puts a name in the box; the ref never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fill]);

  const result = useMemo(() => suggest(names, query, exclude), [query, names, exclude]);
  const suggestions = open ? result.entries : [];
  const nothing = open && query.trim() !== "" && result.entries.length === 0;

  function submit(entry: NameEntry | undefined) {
    if (!entry || !onGuess(entry)) return;
    setQuery("");
    setHighlight(0);
  }

  return (
    <div className="relative mx-auto max-w-md">
      <input
        ref={ref}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setHighlight(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          const n = result.entries.length;
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) return setOpen(true);
            if (n) setHighlight((h) => (e.key === "ArrowDown" ? (h + 1) % n : (h - 1 + n) % n));
          } else if (e.key === "Enter") {
            e.preventDefault();
            setOpen(true);
            submit(result.entries[Math.min(highlight, n - 1)]);
          } else if (e.key === "Escape") {
            if (open && query) setOpen(false);
            else setQuery("");
            setHighlight(0);
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        enterKeyHint="go"
        spellCheck={false}
        disabled={disabled}
        aria-label="Guess a Pokémon (press / to jump here, Esc to clear)"
        role="combobox"
        aria-expanded={suggestions.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={suggestions[highlight] ? `${listId}-${suggestions[highlight][0]}` : undefined}
        className="h-12 w-full rounded-md border-2 border-foreground/15 bg-shade/40 px-4 font-display text-base tracking-wide focus-visible:border-screen/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-60"
      />
      <AnimatePresence>
        {suggestions.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="absolute inset-x-0 top-14 z-30 overflow-hidden rounded-md border-2 border-foreground/15 bg-card shadow-2xl"
            role="listbox"
            id={listId}
            aria-label="Pokémon matching your guess"
          >
            {suggestions.map((entry, i) => (
              <li key={entry[0]} id={`${listId}-${entry[0]}`} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => submit(entry)}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn("menu-item flex w-full items-center gap-3 px-3 py-1 text-left font-display text-sm", i === highlight && "bg-screen/10")}
                  tabIndex={-1}
                >
                  <img src={spriteUrl(entry[0])} alt="" width={40} height={40} decoding="async" className="h-10 w-10 shrink-0 rounded-md bg-shade/30" />
                  <span className="flex-1 truncate font-medium text-foreground/85">
                    <Highlighted name={entry[1]} query={query} />
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">Gen {entry[2]}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
      {nothing && (
        <p className="absolute inset-x-0 top-14 z-30 rounded-md border-2 border-foreground/15 bg-card px-3 py-2.5 text-sm text-muted-foreground shadow-2xl" role="status">
          {result.alreadyGuessed ? `You've already guessed ${result.alreadyGuessed[1]}.` : "No Pokémon by that name."}
        </p>
      )}
    </div>
  );
}

/** What each clue's colour and mark means: under every board, so no clue relies on remembering the how-to. */
export function ClueLegend({ close = true, className }: { close?: boolean; className?: string }) {
  const items: { status: CellStatus; label: string; glyph?: React.ReactNode }[] = [
    { status: "match", label: "Match" },
    { status: "partial", label: "Type in the other slot" },
    ...(close ? [{ status: "close-higher" as const, label: "Close" }] : []),
    {
      status: "higher",
      label: "Answer is higher / lower",
      glyph: (
        <span className="flex items-center leading-none" aria-hidden>
          <ArrowUp className="h-3 w-3 text-primary" />
          <ArrowDown className="h-3 w-3 text-primary" />
        </span>
      ),
    },
    { status: "miss", label: "No match" },
  ];
  return (
    <ul className={cn("flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground", className)} aria-label="What the clues mean" data-testid="clue-legend">
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
  const shown = DLE_COLUMNS.filter((c) => (columns ? columns.includes(c.key) : rows.some((r) => r.cells[c.key])));
  const pendingRow = pending && !rows.some((r) => r.id === pending.id) ? pending : null;
  const empty = Math.max(0, (slots ?? 0) - rows.length - (pendingRow ? 1 : 0));
  // A phone: the clues share the width (the name above them). Wider: fixed tracks, a full name beside its sprite, every tile the same size.
  const grid = "grid gap-1 grid-cols-[repeat(var(--dle-n),minmax(0,1fr))] sm:gap-1.5 sm:grid-cols-[10rem_repeat(var(--dle-n),3.75rem)]";
  const done = shown.length * 0.12 + 0.4;

  return (
    <div className="pb-2 sm:-mx-4 sm:overflow-x-auto sm:px-4">
      <div className="w-full space-y-1.5 sm:mx-auto sm:w-max" role="table" aria-label="Your guesses, newest first" style={{ "--dle-n": shown.length } as React.CSSProperties}>
        <div className={cn(grid, "hud-label text-center")} role="row">
          <div className="sr-only sm:not-sr-only sm:text-left" role="columnheader">
            Pokémon
          </div>
          {shown.map((c) => (
            <div
              key={c.key}
              role="columnheader"
              title={close ? COLUMN_HELP[c.key] : COLUMN_HELP[c.key].replace(/ Close:.*$/, " ▲ / ▼ only, no close state.")}
              className="cursor-help truncate text-[8px] tracking-normal underline decoration-dotted decoration-foreground/30 underline-offset-2 sm:text-[10px] sm:tracking-[0.12em]"
            >
              {c.label}
            </div>
          ))}
        </div>
        {pendingRow && (
          <div key={`row-${pendingRow.id}`} className={grid} role="row" aria-busy="true">
            <RowName id={pendingRow.id} name={pendingRow.name} />
            {shown.map((c) => (
              <div key={c.key} role="cell" className="h-11 rounded-lg border border-foreground/15 bg-card/60 motion-safe:animate-pulse sm:h-12" aria-label={`${c.label}: checking…`} />
            ))}
          </div>
        )}
        {[...rows].reverse().map((row, r) => {
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
                  <Cell key={c.key} label={c.label} cell={cell} delay={flip ? i * 0.12 : null} onClick={onClue ? () => onClue(c.key, row.id, cell) : undefined} />
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
              Guess {rows.length + (pendingRow ? 1 : 0) + i + 1}
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

/** A clue as words: "Height 1.2 m: close, the answer is higher". */
export const clueText = (label: string, cell: DleCell) => `${label} ${cell.value}: ${STATUS_TEXT[cell.status]}`;

function Cell({ cell, label, delay, onClick }: { cell: DleCell; label: string; delay: number | null; onClick?: () => void }) {
  const text = clueText(label, cell);
  const className = cn(
    "flex h-11 w-full flex-col items-center justify-center gap-0.5 rounded-lg border px-0.5 text-center text-[10px] font-semibold leading-tight sm:h-12 sm:px-1 sm:text-[11px]",
    CELL_STYLES[cell.status],
    onClick && "cursor-pointer transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  );
  const body = (
    <>
      <span className="max-w-full truncate">{cell.value}</span>
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
        <button type="button" onClick={onClick} className={className} aria-label={`${text}. Filter the Pokédex by this clue`} title={`${text}. Click to filter the Pokédex by this clue.`}>
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
