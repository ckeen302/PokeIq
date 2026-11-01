"use client";

import { useId, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { Eye, HelpCircle, Send } from "lucide-react";
import { TrainerAvatar } from "@/components/trainers/TrainerAvatar";
import { Button } from "@/components/ui/button";
import { revealFactor, suggest, resolveGuess, TRAINER_NAMES } from "@/lib/whose-team";
import { cn } from "@/lib/utils";

/**
 * Whose Team Is This? pieces, shared by solo runs (QuizController) and
 * duels (QuizDuel): the team on show, the guess box and the trainer reveal.
 */

type Card = { label: string; imageUrl: string };

/** One row on desktop for up to six (each tile ~100px), two rows of four for the anime's bigger rosters. */
const GRID: Record<number, string> = {
  2: "max-w-[240px] grid-cols-2",
  3: "max-w-sm grid-cols-3",
  4: "max-w-md grid-cols-4",
  5: "grid-cols-3 sm:grid-cols-5 sm:max-w-[540px]",
  6: "grid-cols-3 sm:grid-cols-6",
  7: "grid-cols-4 sm:max-w-md",
  8: "grid-cols-4 sm:max-w-md",
};

interface TeamBoardProps {
  cards: Card[];
  /** Hard: how many of the team are showing. */
  reveal?: { shown: number; total: number };
  /** Hard, while the question is open: ask for the next Pokémon. */
  onReveal?: () => void;
  revealing?: boolean;
}

/** The team: every Pokémon, or in Hard the ones revealed so far and a "?" for each still hidden. */
export function TeamBoard({ cards, reveal, onReveal, revealing }: TeamBoardProps) {
  const total = reveal?.total ?? cards.length;
  const hidden = Math.max(0, total - cards.length);
  const nextFactor = reveal && reveal.shown < reveal.total ? revealFactor(reveal.shown + 1, reveal.total) : null;
  return (
    <div className="space-y-3">
      <ol
        className={cn("mx-auto grid gap-2 sm:gap-3", GRID[Math.min(total, 8)] ?? GRID[6])}
        aria-label={reveal ? `Team: ${cards.length} of ${total} Pokémon shown` : `Team of ${total} Pokémon`}
      >
        {cards.map((card, i) => (
          <motion.li
            key={`${i}-${card.imageUrl}`}
            initial={{ opacity: 0, scale: 0.85, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.25, delay: reveal ? 0 : i * 0.04 }}
            className="flex min-w-0 flex-col items-center gap-1.5"
          >
            <div className="screen relative aspect-square w-full rounded-md">
              <Image src={card.imageUrl} alt={card.label} fill priority unoptimized sizes="(min-width: 640px) 100px, 30vw" className="relative z-[1] object-contain p-1.5" />
            </div>
            <span className="w-full truncate text-center font-display text-[12px] font-semibold leading-tight tracking-wide sm:text-[13px]" title={card.label}>
              {card.label}
            </span>
          </motion.li>
        ))}
        {Array.from({ length: hidden }).map((_, i) => (
          <li key={`hidden-${i}`} className="flex min-w-0 flex-col items-center gap-1.5" aria-hidden>
            <div className="relative flex aspect-square w-full items-center justify-center rounded-md border-2 border-dashed border-foreground/15 bg-shade/30">
              <HelpCircle className="h-6 w-6 text-muted-foreground/60" />
            </div>
            <span className="font-pixel text-[10px] uppercase tracking-wider text-muted-foreground/70">???</span>
          </li>
        ))}
      </ol>
      {reveal && onReveal && nextFactor !== null && (
        <div className="flex flex-col items-center gap-2 sm:flex-row sm:justify-between">
          <p className="hud-label normal-case tracking-wide text-muted-foreground" data-testid="team-worth">
            Seen {reveal.shown}/{reveal.total} · a right answer now is worth {Math.round(revealFactor(reveal.shown, reveal.total) * 100)}%
          </p>
          <Button type="button" variant="outline" size="sm" onClick={onReveal} disabled={revealing} data-testid="team-reveal">
            <Eye className="h-4 w-4" aria-hidden /> {revealing ? "Revealing…" : `Reveal next (${Math.round(nextFactor * 100)}%)`}
          </Button>
        </div>
      )}
    </div>
  );
}

interface GuessBoxProps {
  /** Every answer the server accepts (the question's options). */
  options: readonly string[];
  disabled?: boolean;
  onGuess: (name: string) => void;
}

/** The guess: type a trainer, pick from the autocomplete (aliases like "Green" find Blue). */
export function GuessBox({ options, disabled, onGuess }: GuessBoxProps) {
  const listId = useId();
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [hint, setHint] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const names = useMemo(() => {
    const allowed = new Set(options);
    // The server's list is the truth; the alias table only adds other spellings.
    const known = TRAINER_NAMES.filter((n) => allowed.has(n.name));
    const extra = options.filter((o) => !known.some((n) => n.name === o)).map((name) => ({ name }));
    return [...known, ...extra];
  }, [options]);
  const matches = useMemo(() => suggest(text, names), [text, names]);

  const commit = (name: string | null) => {
    if (!name || disabled) {
      setHint(true);
      return;
    }
    setText(name);
    setOpen(false);
    onGuess(name);
  };

  // An exact name or alias, else the highlighted suggestion.
  const submit = () => commit(resolveGuess(text, names) ?? matches[active]?.name ?? null);

  return (
    <form
      className="relative z-10"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={open && matches.length > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={open && matches[active] ? `${listId}-${active}` : undefined}
            aria-label="Trainer's name"
            placeholder="Type a trainer's name…"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            maxLength={40}
            disabled={disabled}
            value={text}
            data-testid="team-guess"
            onChange={(e) => {
              setText(e.target.value);
              setActive(0);
              setOpen(true);
              setHint(false);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 120)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" && matches.length) {
                e.preventDefault();
                setOpen(true);
                setActive((a) => (a + 1) % matches.length);
              } else if (e.key === "ArrowUp" && matches.length) {
                e.preventDefault();
                setActive((a) => (a - 1 + matches.length) % matches.length);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            className={cn(
              "h-12 w-full rounded-md border-2 border-foreground/15 bg-shade/30 px-4 font-display text-base font-semibold tracking-wide outline-none transition-colors placeholder:font-sans placeholder:font-normal placeholder:text-muted-foreground focus:border-screen/70",
              hint && "border-destructive/70"
            )}
          />
          <AnimatePresence>
            {/* Opens upward: the box sits at the bottom of a card that clips what overflows it. */}
            {open && matches.length > 0 && !disabled && (
              <motion.ul
                id={listId}
                role="listbox"
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className="absolute inset-x-0 bottom-[calc(100%+4px)] z-30 overflow-hidden rounded-md border-2 border-screen/40 bg-[hsl(var(--card))] shadow-[0_12px_32px_-8px_rgb(0_0_0/0.7)]"
              >
                {matches.map((m, i) => (
                  <li
                    key={m.name}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={i === active}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      commit(m.name);
                    }}
                    onMouseEnter={() => setActive(i)}
                    className={cn("flex cursor-pointer items-center justify-between gap-2 px-4 py-2.5 font-display text-[15px] font-semibold tracking-wide", i === active && "bg-screen/10 text-foreground")}
                  >
                    <span>{m.name}</span>
                    {m.via && <span className="text-xs font-normal text-muted-foreground">also “{m.via}”</span>}
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
        </div>
        <Button type="submit" size="lg" className="h-12 shrink-0" disabled={disabled} data-testid="team-submit">
          <Send className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Guess</span>
        </Button>
      </div>
      {hint && <p className="mt-2 text-xs text-destructive">Pick a trainer from the list.</p>}
    </form>
  );
}

/** Who it was: the trainer's plate (initials, as on the trainer pages) and which appearance this team is from. */
export function TrainerReveal({ name, appearance, correct }: { name: string; appearance?: string; correct: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("flex items-center gap-4 rounded-md border-2 bg-shade/20 p-3 sm:p-4", correct ? "border-success/60" : "border-destructive/50")}
      data-testid="team-answer"
    >
      <TrainerAvatar name={name} size="md" />
      <div className="min-w-0">
        <p className="hud-label">{correct ? "You got it" : "It was"}</p>
        <p className="font-display text-2xl font-bold uppercase leading-tight">{name}</p>
        {appearance && <p className="text-sm text-muted-foreground">{appearance}</p>}
      </div>
    </motion.div>
  );
}
