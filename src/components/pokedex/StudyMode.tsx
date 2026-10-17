"use client";

/* eslint-disable @next/next/no-img-element -- pre-sized art */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useMotionValue, useTransform, type PanInfo } from "framer-motion";
import { Check, GraduationCap, RotateCcw, Shuffle, X } from "lucide-react";
import { artUrl } from "@/lib/pokemon/art";
import { typeColor } from "@/lib/pokemon/type-colors";
import { capitalize } from "@/lib/pokemon/type-matrix";
import { TypeBadge } from "./TypeBadge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Flashcard study mode. Missed cards are re-queued a few cards later
 * (a lightweight spaced-repetition loop); cards you get right on the first
 * try are recorded as "mastered" in localStorage.
 */

export interface StudyCard {
  id: number;
  slug: string;
  name: string;
  genus: string;
  types: string[];
  gen: number;
  entry: string;
}

type Prompt = "silhouette" | "entry" | "typing";

const PROMPTS: { id: Prompt; label: string; hint: string }[] = [
  { id: "silhouette", label: "Silhouette", hint: "Who's that Pokémon?" },
  { id: "entry", label: "Pokédex entry", hint: "Which Pokémon is this?" },
  { id: "typing", label: "Typing", hint: "What type is it?" },
];

const REGIONS = ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Galar", "Paldea"];
const MASTERY_KEY = "pokeiq:mastery:v1";
const DECK_SIZES = [10, 20, 50, Infinity];

/** Keys pressed on these keep their native behaviour instead of driving the deck. */
function isInteractive(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest("a, button, input, select, textarea, [contenteditable]") !== null;
}

function loadMastery(): Set<number> {
  try {
    return new Set(JSON.parse(localStorage.getItem(MASTERY_KEY) ?? "[]") as number[]);
  } catch {
    return new Set();
  }
}

function saveMastery(set: Set<number>) {
  try {
    localStorage.setItem(MASTERY_KEY, JSON.stringify([...set]));
  } catch {
    /* storage unavailable */
  }
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function StudyMode({ cards }: { cards: StudyCard[] }) {
  const [gens, setGens] = useState<number[]>([1]);
  const [prompt, setPrompt] = useState<Prompt>("silhouette");
  const [deckSize, setDeckSize] = useState<number>(20);
  const [skipMastered, setSkipMastered] = useState(true);
  const [mastery, setMastery] = useState<Set<number>>(new Set());
  const [queue, setQueue] = useState<StudyCard[] | null>(null);
  const [total, setTotal] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [missed, setMissed] = useState<Set<number>>(new Set());
  const [knownFirstTry, setKnownFirstTry] = useState(0);
  const [exitDir, setExitDir] = useState<1 | -1>(1);

  useEffect(() => {
    setMastery(loadMastery());
    // Read ?gen= after mount so the page itself can be prerendered.
    const gen = Number(new URLSearchParams(window.location.search).get("gen"));
    if (Number.isInteger(gen) && gen >= 1 && gen <= 9) setGens([gen]);
  }, []);

  const pool = useMemo(() => cards.filter((c) => gens.includes(c.gen) && (prompt !== "entry" || c.entry)), [cards, gens, prompt]);
  const masteredInPool = pool.filter((c) => mastery.has(c.id)).length;

  function start(only?: StudyCard[]) {
    const source = only ?? (skipMastered && masteredInPool < pool.length ? pool.filter((c) => !mastery.has(c.id)) : pool);
    const deck = only ? shuffle(source) : shuffle(source).slice(0, deckSize);
    setQueue(deck);
    setTotal(deck.length);
    setFlipped(false);
    setMissed(new Set());
    setKnownFirstTry(0);
  }

  const current = queue?.[0];

  const grade = useCallback(
    (knew: boolean) => {
      if (!queue || !current) return;
      setExitDir(knew ? 1 : -1);
      const rest = queue.slice(1);
      if (!knew) {
        // A miss means it isn't mastered any more, even if it was before.
        setMastery((m) => {
          if (!m.has(current.id)) return m;
          const next = new Set(m);
          next.delete(current.id);
          saveMastery(next);
          return next;
        });
      }
      if (knew) {
        if (!missed.has(current.id)) {
          setKnownFirstTry((k) => k + 1);
          setMastery((m) => {
            const next = new Set(m).add(current.id);
            saveMastery(next);
            return next;
          });
        }
        setQueue(rest);
      } else {
        setMissed((m) => new Set(m).add(current.id));
        const at = Math.min(rest.length, 3 + Math.floor(Math.random() * 3));
        setQueue([...rest.slice(0, at), current, ...rest.slice(at)]);
      }
      setFlipped(false);
    },
    [queue, current, missed]
  );

  // Keyboard: space flips, ←/1 = missed, →/2 = knew it, Esc exits. Focused
  // links and buttons keep their own Enter / Space behaviour.
  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        setQueue(null);
        return;
      }
      const onCard = e.target instanceof HTMLElement && e.target.dataset.flashcard !== undefined;
      if (isInteractive(e.target) && !onCard) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        setFlipped((f) => !f);
      } else if (flipped && (e.key === "ArrowRight" || e.key === "2")) grade(true);
      else if (flipped && (e.key === "ArrowLeft" || e.key === "1")) grade(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, flipped, grade]);

  // --- setup ---------------------------------------------------------------
  if (!queue) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div className="space-y-2 text-center">
          <GraduationCap className="mx-auto h-10 w-10 text-primary" />
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">Study mode</h1>
          <p className="text-muted-foreground">Flip, recall, repeat. Cards you miss come back until you nail them.</p>
        </div>
        <div className="space-y-5 hud rounded-lg border bg-card p-6">
          <div className="space-y-2">
            <div className="hud-label">Generations</div>
            <div className="flex flex-wrap gap-1.5">
              {REGIONS.map((r, i) => {
                const g = i + 1;
                const inGen = cards.filter((c) => c.gen === g);
                const done = inGen.filter((c) => mastery.has(c.id)).length;
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setGens((cur) => (cur.includes(g) ? (cur.length > 1 ? cur.filter((x) => x !== g) : cur) : [...cur, g]))}
                    aria-pressed={gens.includes(g)}
                    className={cn(
                      "relative overflow-hidden rounded-md border px-3 py-2 text-left text-xs transition-colors",
                      gens.includes(g) ? "border-primary bg-primary/10" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span className="absolute inset-y-0 left-0 bg-success/15" style={{ width: `${(done / inGen.length) * 100}%` }} aria-hidden />
                    <span className="relative block font-semibold">Gen {g}</span>
                    <span className="relative block text-[10px] text-muted-foreground">
                      {r} · {done}/{inGen.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="space-y-2">
            <div className="hud-label">Card front</div>
            <div className="grid grid-cols-3 gap-2">
              {PROMPTS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPrompt(p.id)}
                  aria-pressed={prompt === p.id}
                  className={cn("rounded-lg border px-2 py-2.5 text-sm font-semibold", prompt === p.id ? "border-primary bg-primary/10" : "text-muted-foreground hover:text-foreground")}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="hud-label">Deck size</span>
            {DECK_SIZES.map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setDeckSize(n)}
                className={cn("rounded-sm border px-3 py-1.5 font-pixel text-[10px] uppercase", deckSize === n ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground")}
              >
                {n === Infinity ? "All" : n}
              </button>
            ))}
            <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={skipMastered} onChange={(e) => setSkipMastered(e.target.checked)} className="accent-[hsl(var(--primary))]" />
              Skip mastered
            </label>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Mastered in selection</span>
              <span className="tabular-nums">
                {masteredInPool}/{pool.length}
              </span>
            </div>
            <div className="meter">
              <motion.div className="h-full bg-success" animate={{ width: `${pool.length ? (masteredInPool / pool.length) * 100 : 0}%` }} />
            </div>
          </div>
          <Button size="lg" className="w-full text-base" onClick={() => start()} disabled={pool.length === 0}>
            Start studying
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground">Space to flip · → knew it · ← study again · Esc to exit · or swipe the card</p>
      </div>
    );
  }

  // --- finished ------------------------------------------------------------
  if (!current) {
    const missedCards = cards.filter((c) => missed.has(c.id));
    return (
      <motion.div className="mx-auto max-w-xl space-y-6 text-center" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
        <div className="text-6xl">🎓</div>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">Deck complete!</h1>
        <p className="text-muted-foreground">
          {knownFirstTry}/{total} on the first try · {missed.size} needed review
        </p>
        {missedCards.length > 0 && (
          <div className="flex flex-wrap justify-center gap-2">
            {missedCards.map((c) => (
              <Link key={c.id} href={`/pokemon/${c.slug}`} className="flex items-center gap-1 rounded-full border bg-card py-1 pl-1 pr-3 text-xs hover:border-primary/50">
                <img src={artUrl(c.id, 96)} alt="" className="h-7 w-7" /> {c.name}
              </Link>
            ))}
          </div>
        )}
        <div className="flex flex-wrap justify-center gap-2">
          {missedCards.length > 0 && (
            <Button onClick={() => start(missedCards)}>
              <RotateCcw className="h-4 w-4" /> Drill the misses
            </Button>
          )}
          <Button variant="outline" onClick={() => start()}>
            <Shuffle className="h-4 w-4" /> New deck
          </Button>
          <Link href={`/quiz/gen-${gens[0]}-pokemon-quiz`} className="inline-flex h-10 items-center rounded-md border px-4 text-sm font-medium hover:bg-accent">
            Test yourself →
          </Link>
        </div>
      </motion.div>
    );
  }

  // --- studying ------------------------------------------------------------
  const done = total - new Set(queue.map((c) => c.id)).size;
  return (
    <div className="mx-auto max-w-md space-y-5">
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => setQueue(null)} className="text-muted-foreground hover:text-foreground" aria-label="Exit study session">
          <X className="h-5 w-5" />
        </button>
        <div className="flex-1 meter">
          <motion.div className="h-full bg-primary" animate={{ width: `${(done / total) * 100}%` }} transition={{ type: "spring", stiffness: 120, damping: 20 }} />
        </div>
        <span className="text-xs tabular-nums text-muted-foreground">
          {done}/{total}
        </span>
      </div>

      <AnimatePresence mode="popLayout" custom={exitDir}>
        <FlashCard key={`${current.id}-${queue.length}`} card={current} prompt={prompt} flipped={flipped} onFlip={() => setFlipped((f) => !f)} onGrade={grade} />
      </AnimatePresence>

      <div className="grid grid-cols-2 gap-3">
        <Button size="lg" variant="outline" disabled={!flipped} onClick={() => grade(false)} className="border-destructive/40 text-destructive hover:bg-destructive/10">
          <RotateCcw className="h-4 w-4" /> Study again
        </Button>
        <Button size="lg" variant="success" disabled={!flipped} onClick={() => grade(true)}>
          <Check className="h-4 w-4" /> Knew it
        </Button>
      </div>
      <p className="text-center text-xs text-muted-foreground">{flipped ? "Swipe → if you knew it, ← to see it again" : "Tap the card or press Space to flip"}</p>
    </div>
  );
}

interface FlashCardProps {
  card: StudyCard;
  prompt: Prompt;
  flipped: boolean;
  onFlip: () => void;
  onGrade: (knew: boolean) => void;
}

function FlashCard({ card, prompt, flipped, onFlip, onGrade }: FlashCardProps) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-200, 200], [-14, 14]);
  const knewOpacity = useTransform(x, [20, 120], [0, 1]);
  const againOpacity = useTransform(x, [-120, -20], [1, 0]);
  const c1 = typeColor(card.types[0]);
  const c2 = typeColor(card.types[1] ?? card.types[0]);
  // A mouse drag still fires a click on release; it must not flip the card.
  const draggedRef = useRef(false);

  function onDragEnd(_: unknown, info: PanInfo) {
    // The click (if any) is dispatched before this timeout runs.
    setTimeout(() => (draggedRef.current = false), 0);
    if (!flipped) return;
    if (info.offset.x > 110) onGrade(true);
    else if (info.offset.x < -110) onGrade(false);
  }

  function onClick() {
    if (!draggedRef.current) onFlip();
  }

  return (
    <motion.div
      className="relative mx-auto aspect-[3/4] w-full max-w-sm cursor-pointer [perspective:1200px]"
      style={{ x, rotate }}
      drag={flipped ? "x" : false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.9}
      onDragStart={() => (draggedRef.current = true)}
      onDragEnd={onDragEnd}
      initial={{ opacity: 0, y: 40, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      variants={{ exit: (dir: 1 | -1) => ({ opacity: 0, x: dir * 280, rotate: dir * 18, transition: { duration: 0.25 } }) }}
      exit="exit"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          e.stopPropagation();
          onFlip();
        }
      }}
      role="button"
      tabIndex={0}
      data-flashcard=""
    >
      <motion.div
        className="relative h-full w-full [transform-style:preserve-3d]"
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ type: "spring", stiffness: 260, damping: 24 }}
      >
        {/* Front */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 rounded-lg border bg-card p-6 text-center shadow-2xl [backface-visibility:hidden]">
          <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{PROMPTS.find((p) => p.id === prompt)!.hint}</span>
          {prompt === "silhouette" && (
            <div className="spotlight flex aspect-square w-full items-center justify-center rounded-lg">
              <img src={artUrl(card.id, 256)} alt="Mystery silhouette" draggable={false} className="h-[85%] w-[85%] object-contain [filter:brightness(0)]" />
            </div>
          )}
          {prompt === "entry" && <p className="font-serif text-lg italic leading-relaxed">“{card.entry}”</p>}
          {prompt === "typing" && (
            <>
              <img src={artUrl(card.id, 256)} alt={card.name} draggable={false} className="h-48 w-48 object-contain" />
              <span className="text-2xl font-bold">{card.name}</span>
            </>
          )}
          <span className="text-xs text-muted-foreground">Gen {card.gen}</span>
        </div>

        {/* Back */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-hidden rounded-lg border p-6 text-center shadow-2xl [backface-visibility:hidden] [transform:rotateY(180deg)]"
          style={{ background: `radial-gradient(100% 80% at 50% 10%, ${c1}55, transparent 70%), linear-gradient(160deg, ${c2}33, hsl(var(--card)) 70%)` }}
        >
          <img src={artUrl(card.id, 256)} alt={card.name} draggable={false} className="h-44 w-44 object-contain drop-shadow-[0_12px_20px_rgba(0,0,0,0.5)]" />
          <div>
            <div className="font-mono text-xs text-muted-foreground">#{String(card.id).padStart(4, "0")}</div>
            <div className="text-3xl font-black">{card.name}</div>
            <div className="text-sm text-muted-foreground">The {card.genus}</div>
          </div>
          <div className="flex gap-1.5">
            {card.types.map((t) => (
              <TypeBadge key={t} type={t} />
            ))}
          </div>
          <Link href={`/pokemon/${card.slug}`} onClick={(e) => e.stopPropagation()} className="text-xs font-semibold text-primary hover:underline">
            Full Pokédex entry →
          </Link>
          <span className="sr-only">{card.types.map(capitalize).join(" / ")}</span>
        </div>
      </motion.div>

      {/* Swipe feedback */}
      <motion.div className="pointer-events-none absolute left-4 top-4 rounded-lg border-2 border-success px-3 py-1 text-lg font-black text-success" style={{ opacity: knewOpacity, rotate: -12 }}>
        KNEW IT
      </motion.div>
      <motion.div className="pointer-events-none absolute right-4 top-4 rounded-lg border-2 border-destructive px-3 py-1 text-lg font-black text-destructive" style={{ opacity: againOpacity, rotate: 12 }}>
        AGAIN
      </motion.div>
    </motion.div>
  );
}
