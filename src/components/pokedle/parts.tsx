"use client";

/* eslint-disable @next/next/no-img-element -- tiny sprites; next/image adds nothing here */
import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowDown, ArrowUp } from "lucide-react";
import { DLE_COLUMNS, isNear, statusArrow, type CellStatus, type DleCell, type DleColumn, type DleRow } from "@/lib/dle-types";
import { cn } from "@/lib/utils";

/** Pokédle's guess box and board, shared by the daily puzzle and duels. */

export type NameEntry = [id: number, name: string, gen: number];

export const spriteUrl = (id: number) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;

const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

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

/** Type a Pokémon, pick it from the list (arrows + Enter work too). */
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
  const ownRef = useRef<HTMLInputElement | null>(null);
  const ref = inputRef ?? ownRef;
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
    ref.current?.focus();
    // Only a new fill puts a name in the box; the ref never changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fill]);

  const suggestions = useMemo(() => {
    const q = normalize(query);
    if (!q) return [];
    const typed = query.trim().toLowerCase();
    // The exact name first ("Mew" before Mewtwo, Nidoran♂ before Nidoran♀ when that's what you typed).
    const exact: NameEntry[] = [];
    const same: NameEntry[] = [];
    const starts: NameEntry[] = [];
    const contains: NameEntry[] = [];
    for (const entry of names) {
      if (exclude.has(entry[0])) continue;
      const n = normalize(entry[1]);
      if (entry[1].toLowerCase() === typed) exact.push(entry);
      else if (n === q) same.push(entry);
      else if (n.startsWith(q)) starts.push(entry);
      else if (n.includes(q)) contains.push(entry);
    }
    return [...exact, ...same, ...starts, ...contains].slice(0, 7);
  }, [query, names, exclude]);

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
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setHighlight((h) => Math.min(h + 1, suggestions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            submit(suggestions[highlight]);
          } else if (e.key === "Escape") {
            setQuery("");
            setHighlight(0);
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        aria-label="Guess a Pokémon (press / to jump here, Esc to clear)"
        role="combobox"
        aria-expanded={suggestions.length > 0}
        aria-controls="dle-suggestions"
        aria-autocomplete="list"
        aria-activedescendant={suggestions[highlight] ? `dle-option-${suggestions[highlight][0]}` : undefined}
        className="h-12 w-full rounded-md border-2 border-foreground/15 bg-shade/40 px-4 font-display text-base tracking-wide focus-visible:border-screen/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
      />
      <AnimatePresence>
        {suggestions.length > 0 && (
          <motion.ul
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute inset-x-0 top-14 z-20 overflow-hidden rounded-md border-2 border-foreground/15 bg-card shadow-2xl"
            role="listbox"
            id="dle-suggestions"
          >
            {suggestions.map((entry, i) => (
              <li key={entry[0]} id={`dle-option-${entry[0]}`} role="option" aria-selected={i === highlight}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => submit(entry)}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn("menu-item flex w-full items-center gap-3 px-3 py-1.5 text-left font-display text-sm font-semibold", i === highlight && "bg-screen/10")}
                  tabIndex={-1}
                >
                  <img src={spriteUrl(entry[0])} alt="" width={40} height={40} className="h-10 w-10" loading="lazy" />
                  <span className="flex-1 font-medium">{entry[1]}</span>
                  <span className="text-xs text-muted-foreground">Gen {entry[2]}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Every guess so far, newest on top, with each clue's colour and glyph.
 * Only the newest guess flips in (cell by cell), and not at all for
 * players who prefer reduced motion.
 */
export function Board({ rows, flipNewest = true }: { rows: DleRow[]; flipNewest?: boolean }) {
  const reduced = useReducedMotion();
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2">
      <div className="mx-auto min-w-[560px] max-w-3xl space-y-2" role="table" aria-label="Your guesses, newest first">
        <div className="hud-label grid grid-cols-[minmax(92px,1.3fr)_repeat(7,minmax(56px,1fr))] gap-1.5 text-center" role="row">
          <div className="text-left" role="columnheader">Pokémon</div>
          {DLE_COLUMNS.map((c) => (
            <div key={c.key} role="columnheader" title={COLUMN_HELP[c.key]} className="cursor-help underline decoration-dotted decoration-foreground/30 underline-offset-2">
              {c.label}
            </div>
          ))}
        </div>
        {[...rows].reverse().map((row, r) => {
          // Rows are keyed by Pokémon, so only a new row mounts (and flips); the rest stay put.
          const flip = flipNewest && !reduced && r === 0;
          return (
            <div key={row.id} className="grid grid-cols-[minmax(92px,1.3fr)_repeat(7,minmax(56px,1fr))] gap-1.5" role="row">
              <div className="flex items-center gap-1.5 rounded-lg border bg-card/80 px-1.5" role="rowheader">
                <img src={spriteUrl(row.id)} alt="" width={36} height={36} className="h-9 w-9 shrink-0" />
                <span className="truncate text-xs font-semibold">{row.name}</span>
              </div>
              {DLE_COLUMNS.map((c, i) => (
                <Cell
                  key={c.key}
                  label={c.label}
                  cell={row.cells[c.key]}
                  delay={flip ? i * 0.12 : null}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A clue as words: "Height 1.2 m: close, the answer is higher". */
export const clueText = (label: string, cell: DleCell) => `${label} ${cell.value}: ${STATUS_TEXT[cell.status]}`;

function Cell({ cell, label, delay }: { cell: DleCell; label: string; delay: number | null }) {
  const text = clueText(label, cell);
  return (
    <motion.div
      role="cell"
      initial={delay === null ? false : { rotateX: 90, opacity: 0 }}
      animate={{ rotateX: 0, opacity: 1 }}
      transition={{ delay: delay ?? 0, duration: 0.35 }}
    >
      <div
        className={cn("flex min-h-12 w-full flex-col items-center justify-center gap-0.5 rounded-lg border px-1 text-center text-[11px] font-semibold leading-tight", CELL_STYLES[cell.status])}
        aria-label={text}
        title={text}
      >
        <span>{cell.value}</span>
        <CellGlyph status={cell.status} />
      </div>
    </motion.div>
  );
}
