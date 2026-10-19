"use client";

/* eslint-disable @next/next/no-img-element -- tiny sprites; next/image adds nothing here */
import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDown, ArrowUp } from "lucide-react";
import { DLE_COLUMNS, type CellStatus, type DleCell, type DleRow } from "@/lib/dle-types";
import { cn } from "@/lib/utils";

/** Pokédle's guess box and board, shared by the daily puzzle and duels. */

export type NameEntry = [id: number, name: string, gen: number];

export const spriteUrl = (id: number) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;

const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

export const CELL_STYLES: Record<CellStatus, string> = {
  match: "bg-success/90 text-success-foreground border-success",
  partial: "bg-yellow-500/85 text-yellow-950 border-yellow-400",
  higher: "bg-secondary text-foreground border-foreground/10",
  lower: "bg-secondary text-foreground border-foreground/10",
  miss: "bg-muted/60 text-muted-foreground border-foreground/5",
};

/** Type a Pokémon, pick it from the list (arrows + Enter work too). */
export function GuessInput({
  names,
  exclude,
  disabled,
  placeholder,
  onGuess,
  inputRef,
}: {
  names: NameEntry[];
  /** Already guessed: left out of the list. */
  exclude: ReadonlySet<number>;
  disabled?: boolean;
  placeholder: string;
  /** False when the guess wasn't taken (the text stays). */
  onGuess: (entry: NameEntry) => boolean;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const suggestions = useMemo(() => {
    const q = normalize(query);
    if (!q) return [];
    const starts: NameEntry[] = [];
    const contains: NameEntry[] = [];
    for (const entry of names) {
      if (exclude.has(entry[0])) continue;
      const n = normalize(entry[1]);
      if (n.startsWith(q)) starts.push(entry);
      else if (n.includes(q)) contains.push(entry);
    }
    return [...starts, ...contains].slice(0, 7);
  }, [query, names, exclude]);

  function submit(entry: NameEntry | undefined) {
    if (!entry || !onGuess(entry)) return;
    setQuery("");
    setHighlight(0);
  }

  return (
    <div className="relative mx-auto max-w-md">
      <input
        ref={inputRef}
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
            submit(suggestions[highlight]);
          }
        }}
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        aria-label="Guess a Pokémon"
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
          >
            {suggestions.map((entry, i) => (
              <li key={entry[0]}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => submit(entry)}
                  onMouseEnter={() => setHighlight(i)}
                  className={cn("menu-item flex w-full items-center gap-3 px-3 py-1.5 text-left font-display text-sm font-semibold", i === highlight && "bg-screen/10")}
                  role="option"
                  aria-selected={i === highlight}
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

/** Every guess so far, newest on top, with each clue's colour. */
export function Board({ rows }: { rows: DleRow[] }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2">
      <div className="mx-auto min-w-[560px] max-w-3xl space-y-2">
        <div className="hud-label grid grid-cols-[minmax(92px,1.3fr)_repeat(7,minmax(56px,1fr))] gap-1.5 text-center">
          <div className="text-left">Pokémon</div>
          {DLE_COLUMNS.map((c) => (
            <div key={c.key}>{c.label}</div>
          ))}
        </div>
        {[...rows].reverse().map((row, r) => (
          <div key={row.id} className="grid grid-cols-[minmax(92px,1.3fr)_repeat(7,minmax(56px,1fr))] gap-1.5">
            <div className="flex items-center gap-1.5 rounded-lg border bg-card/80 px-1.5">
              <img src={spriteUrl(row.id)} alt="" width={36} height={36} className="h-9 w-9 shrink-0" />
              <span className="truncate text-xs font-semibold">{row.name}</span>
            </div>
            {DLE_COLUMNS.map((c, i) => (
              <Cell key={c.key} cell={row.cells[c.key]} delay={r === 0 ? i * 0.12 : 0} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Cell({ cell, delay }: { cell: DleCell; delay: number }) {
  return (
    <motion.div
      initial={{ rotateX: 90, opacity: 0 }}
      animate={{ rotateX: 0, opacity: 1 }}
      transition={{ delay, duration: 0.35 }}
      className={cn(
        "flex min-h-12 flex-col items-center justify-center rounded-lg border px-1 text-center text-[11px] font-semibold leading-tight",
        CELL_STYLES[cell.status]
      )}
    >
      <span>{cell.value}</span>
      {cell.status === "higher" && <ArrowUp className="h-3.5 w-3.5 text-primary" aria-label="answer is higher" />}
      {cell.status === "lower" && <ArrowDown className="h-3.5 w-3.5 text-primary" aria-label="answer is lower" />}
    </motion.div>
  );
}
