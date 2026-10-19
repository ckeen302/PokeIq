"use client";

/* eslint-disable @next/next/no-img-element -- tiny sprites/silhouettes; next/image adds nothing here */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { track } from "@vercel/analytics";
import { Check, Lightbulb, RefreshCw, Share2 } from "lucide-react";
import { dailyNumber } from "@/lib/daily";
import { currentStreak, getProgress, saveDle, useProgress } from "@/lib/progress";
import { shareOrCopy, shareText } from "@/lib/share";
import { useToday } from "@/lib/use-today";
import { play } from "@/lib/sound";
import { DLE_COLUMNS, DLE_HINTS, DLE_MAX_GUESSES, type CellStatus, type DleResponse } from "@/lib/dle-types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NextDailyCountdown } from "@/components/NextDailyCountdown";
import { CopyFallback } from "@/components/quiz/CopyFallback";
import { Board, GuessInput, type NameEntry } from "./parts";
import { DexPanel } from "./DexPanel";
import { cn } from "@/lib/utils";

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
  const [copied, setCopied] = useState(false);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  /** Latest request id: responses to superseded requests (mode switches) are ignored. */
  const reqRef = useRef(0);
  const seenTodayRef = useRef<string | null>(null);
  /** Only a guess the player just made should make a sound (not restores). */
  const guessedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** A Pokémon clicked in the Pokédex beside the board, for the guess box. */
  const [fill, setFill] = useState<{ name: string; n: number } | null>(null);

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

  function submitGuess(entry: NameEntry): boolean {
    if (over || loading) return false;
    if (mode === "daily" && !date) return false;
    guessedRef.current = true;
    const next = [...guesses, entry[0]];
    setGuesses(next);
    void evaluate(next, mode === "daily" ? { kind: "daily", date: date! } : { kind: "practice", seed: practiceSeed });
    return true;
  }

  function newPractice() {
    reqRef.current++; // drop any in-flight daily response
    setMode("practice");
    setPracticeSeed(Math.random().toString(36).slice(2, 10));
    setGuesses([]);
    setState(null);
    setLoading(false);
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
    // The game, and beside it (below on smaller screens) the reference Pokédex.
    <div className="mx-auto grid max-w-3xl gap-6 xl:max-w-none xl:grid-cols-[minmax(0,1fr)_30rem] xl:items-start">
      <div className="min-w-0 space-y-6">
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
          <GuessInput
            // A new puzzle starts with an empty box.
            key={mode === "daily" ? date : practiceSeed}
            inputRef={inputRef}
            names={names}
            exclude={guessedIds}
            disabled={mode === "daily" && !date}
            placeholder={`Guess ${guesses.length + 1} of ${DLE_MAX_GUESSES} — type a Pokémon…`}
            onGuess={submitGuess}
            fill={fill}
          />
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
      {/* A new puzzle (the day's, or another practice one) starts with every filter cleared. */}
      <DexPanel
        key={mode === "daily" ? date : practiceSeed}
        className="xl:sticky xl:top-20"
        guessed={guessedIds}
        onPick={over || (mode === "daily" && !date) ? undefined : (name) => setFill((f) => ({ name, n: (f?.n ?? 0) + 1 }))}
      />
    </div>
  );
}
