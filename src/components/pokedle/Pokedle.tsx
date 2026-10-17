"use client";

/* eslint-disable @next/next/no-img-element -- tiny sprites/silhouettes; next/image adds nothing here */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { track } from "@vercel/analytics";
import { ArrowDown, ArrowUp, Check, Lightbulb, RefreshCw, Share2 } from "lucide-react";
import { dailyNumber } from "@/lib/daily";
import { currentStreak, getProgress, saveDle, useProgress } from "@/lib/progress";
import { shareOrCopy, shareText } from "@/lib/share";
import { useToday } from "@/lib/use-today";
import { play } from "@/lib/sound";
import {
  DLE_COLUMNS,
  DLE_HINTS,
  DLE_MAX_GUESSES,
  type CellStatus,
  type DleCell,
  type DleResponse,
} from "@/lib/dle-types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NextDailyCountdown } from "@/components/NextDailyCountdown";
import { CopyFallback } from "@/components/quiz/CopyFallback";
import { cn } from "@/lib/utils";

type NameEntry = [id: number, name: string, gen: number];

const spriteUrl = (id: number) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;

const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const CELL_STYLES: Record<CellStatus, string> = {
  match: "bg-success/90 text-success-foreground border-success",
  partial: "bg-yellow-500/85 text-yellow-950 border-yellow-400",
  higher: "bg-secondary text-foreground border-foreground/10",
  lower: "bg-secondary text-foreground border-foreground/10",
  miss: "bg-muted/60 text-muted-foreground border-foreground/5",
};

type Target = { kind: "daily"; date: string } | { kind: "practice"; seed: string };

const SHARE_EMOJI: Record<CellStatus, string> = { match: "🟩", partial: "🟨", higher: "🔼", lower: "🔽", miss: "⬛" };

export function Pokedle({ names }: { names: NameEntry[] }) {
  const progress = useProgress();
  const [mode, setMode] = useState<"daily" | "practice">("daily");
  // Local date, known only after mount (the page is prerendered). `date` is
  // the daily puzzle on screen; it follows `today` across midnight unless a
  // puzzle is mid-solve.
  const today = useToday();
  const [date, setDate] = useState<string | null>(null);
  const [practiceSeed, setPracticeSeed] = useState(() => Math.random().toString(36).slice(2, 10));
  const [guesses, setGuesses] = useState<number[]>([]);
  const [state, setState] = useState<DleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  /** Latest request id: responses to superseded requests (mode switches) are ignored. */
  const reqRef = useRef(0);
  const seenTodayRef = useRef<string | null>(null);
  /** Only a guess the player just made should make a sound (not restores). */
  const guessedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const evaluate = useCallback(async (list: number[], target: Target) => {
    const id = ++reqRef.current;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/pokedle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          target.kind === "daily" ? { date: target.date, guesses: list } : { practiceSeed: target.seed, guesses: list }
        ),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Request failed");
      const result = body as DleResponse;
      // A daily guess is saved even if the player has since switched modes.
      if (target.kind === "daily") {
        saveDle(target.date, { guesses: list, solved: result.solved, over: result.over });
        if (result.over) track("pokedle_complete", { solved: result.solved, guesses: list.length });
      }
      if (id !== reqRef.current) return;
      setState(result);
      if (guessedRef.current) play(result.solved ? "fanfare" : result.over ? "wrong" : "click");
      guessedRef.current = false;
    } catch (err) {
      if (id === reqRef.current) setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      if (id === reqRef.current) setLoading(false);
    }
  }, []);

  const loadDaily = useCallback(
    (d: string) => {
      reqRef.current++;
      setMode("daily");
      setDate(d);
      setState(null);
      setLoading(false);
      setCopyFallback(null);
      const saved = getProgress().dle.results[d]?.guesses ?? [];
      setGuesses(saved);
      if (saved.length) void evaluate(saved, { kind: "daily", date: d });
    },
    [evaluate]
  );

  const guessedIds = useMemo(() => new Set(guesses), [guesses]);
  const suggestions = useMemo(() => {
    const q = normalize(query);
    if (!q) return [];
    const starts: NameEntry[] = [];
    const contains: NameEntry[] = [];
    for (const entry of names) {
      if (guessedIds.has(entry[0])) continue;
      const n = normalize(entry[1]);
      if (n.startsWith(q)) starts.push(entry);
      else if (n.includes(q)) contains.push(entry);
    }
    return [...starts, ...contains].slice(0, 7);
  }, [query, names, guessedIds]);

  const over = state?.over ?? false;

  // Restore the daily once local storage is available, and roll over to the
  // new puzzle at local midnight (unless one is mid-solve).
  useEffect(() => {
    if (!today || !progress) return;
    const prev = seenTodayRef.current;
    if (prev === today) return;
    seenTodayRef.current = today;
    if (prev === null || (mode === "daily" && (guesses.length === 0 || over))) loadDaily(today);
  }, [today, progress, mode, guesses.length, over, loadDaily]);

  function submitGuess(entry: NameEntry | undefined) {
    if (!entry || over || loading) return;
    if (mode === "daily" && !date) return;
    guessedRef.current = true;
    const next = [...guesses, entry[0]];
    setGuesses(next);
    setQuery("");
    setHighlight(0);
    void evaluate(next, mode === "daily" ? { kind: "daily", date: date! } : { kind: "practice", seed: practiceSeed });
  }

  function newPractice() {
    reqRef.current++; // drop any in-flight daily response
    setMode("practice");
    setPracticeSeed(Math.random().toString(36).slice(2, 10));
    setGuesses([]);
    setState(null);
    setLoading(false);
    setQuery("");
    setCopyFallback(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function backToDaily() {
    const d = today ?? date;
    if (d) loadDaily(d);
  }

  async function share() {
    if (!state || !date) return;
    const rows = state.rows.map((r) => DLE_COLUMNS.map((c) => SHARE_EMOJI[r.cells[c.key].status]).join(""));
    const header = `PokéIQ Pokédle #${dailyNumber(date)} ${state.solved ? state.rows.length : "X"}/${DLE_MAX_GUESSES}`;
    const text = [header, ...rows].join("\n");
    const url = `${window.location.origin}/pokedle`;
    const outcome = await shareOrCopy(text, url);
    if (outcome === "failed") {
      setCopyFallback(shareText(text, url));
    } else if (outcome !== "cancelled") {
      setCopyFallback(null);
      setCopied(true);
      track("share", { kind: "pokedle", via: outcome });
      setTimeout(() => setCopied(false), 2500);
    }
  }

  const misses = state ? state.rows.filter((r) => !r.solved).length : 0;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="space-y-2 text-center">
        <p className="hud-label text-screen">
          {mode === "practice" ? "Pokédle · Practice" : date ? `Pokédle #${dailyNumber(date)}` : "Pokédle"}
        </p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">Guess the mystery Pokémon</h1>
        <p className="text-sm text-muted-foreground">
          {DLE_MAX_GUESSES} guesses. 🟩 match · 🟨 right type, wrong slot · ▲▼ the answer is higher / lower.
        </p>
      </div>

      {!over && (
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
                submitGuess(suggestions[highlight]);
              }
            }}
            placeholder={`Guess ${guesses.length + 1} of ${DLE_MAX_GUESSES} — type a Pokémon…`}
            autoComplete="off"
            spellCheck={false}
            disabled={mode === "daily" && !date}
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
                      onClick={() => submitGuess(entry)}
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
      )}

      {error && <p className="text-center text-sm text-destructive">{error}</p>}

      {!over && (state?.hints.silhouetteUrl || state?.hints.genus || guesses.length > 0) && (
        <div className="mx-auto flex max-w-md items-center gap-4 rounded-md border bg-card p-3 text-sm">
          <Lightbulb className="h-5 w-5 shrink-0 text-primary" aria-hidden />
          {state?.hints.silhouetteUrl ? (
            <img src={state.hints.silhouetteUrl} alt="Silhouette hint" className="spotlight h-20 w-20 rounded-lg object-contain p-1" />
          ) : null}
          <div className="space-y-0.5 text-muted-foreground">
            <div>{state?.hints.silhouetteUrl ? "Silhouette unlocked" : `Silhouette hint after ${DLE_HINTS.silhouette} misses (${Math.min(misses, DLE_HINTS.silhouette)}/${DLE_HINTS.silhouette})`}</div>
            <div>
              {state?.hints.genus ? (
                <span className="font-medium text-foreground">{state.hints.genus}</span>
              ) : (
                `Category hint after ${DLE_HINTS.genus} misses`
              )}
            </div>
          </div>
        </div>
      )}

      {over && state?.answer && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}>
          <Card className={cn("mx-auto max-w-md", state.solved ? "border-success/50" : "border-destructive/40")}>
            <CardContent className="space-y-4 p-6 text-center">
              <img src={state.answer.imageUrl} alt={state.answer.name} className="mx-auto h-36 w-36 object-contain" />
              <div>
                <div className="text-2xl font-bold">{state.solved ? `Got it in ${state.rows.length}!` : "So close!"}</div>
                <div className="text-muted-foreground">
                  It was <b className="text-foreground">{state.answer.name}</b>, the {state.answer.genus}.
                </div>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {mode === "daily" ? (
                  <Button onClick={share}>
                    {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />} {copied ? "Copied!" : "Share"}
                  </Button>
                ) : (
                  <Button variant="outline" onClick={backToDaily}>Today&apos;s Pokédle</Button>
                )}
                <Button variant={mode === "daily" ? "outline" : "default"} onClick={newPractice}>
                  <RefreshCw className="h-4 w-4" /> {mode === "daily" ? "Practice mode" : "New puzzle"}
                </Button>
              </div>
              {mode === "daily" && today && date !== today && (
                <Button className="w-full" onClick={backToDaily}>
                  Play today&apos;s Pokédle
                </Button>
              )}
              {copyFallback && <CopyFallback text={copyFallback} />}
              {mode === "daily" && <NextDailyCountdown label="Next Pokédle in" />}
              {mode === "daily" && progress && today && currentStreak(progress.dle.last, progress.dle.streak, today) > 0 && (
                <p className="text-sm font-semibold text-orange-400">
                  🔥 {currentStreak(progress.dle.last, progress.dle.streak, today)}-day solve streak
                </p>
              )}
            </CardContent>
          </Card>
        </motion.div>
      )}

      {state && state.rows.length > 0 && <Board rows={state.rows} />}

      {!over && mode === "daily" && (
        <p className="text-center text-xs text-muted-foreground">
          Want more?{" "}
          <button type="button" onClick={newPractice} className="text-primary hover:underline">
            Play unlimited practice puzzles
          </button>
        </p>
      )}
    </div>
  );
}

function Board({ rows }: { rows: DleResponse["rows"] }) {
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
