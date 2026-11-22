"use client";

/* eslint-disable @next/next/no-img-element -- tiny sprites; next/image adds nothing here */
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import board from "@/messages/pokedle-board";
import { suggest, type NameEntry } from "./search";

/** Pokédle's guess box, in its own file: the quizzes use it without the board (./parts). */

export const spriteUrl = (id: number) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;

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
  const t = useT(board);
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
        aria-label={t("input.aria")}
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
            aria-label={t("input.list")}
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
                  <span className="shrink-0 text-xs text-muted-foreground">{t("input.gen", { n: entry[2] })}</span>
                </button>
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
      {nothing && (
        <p className="absolute inset-x-0 top-14 z-30 rounded-md border-2 border-foreground/15 bg-card px-3 py-2.5 text-sm text-muted-foreground shadow-2xl" role="status">
          {result.alreadyGuessed ? t("input.already", { name: result.alreadyGuessed[1] }) : t("input.none")}
        </p>
      )}
    </div>
  );
}
