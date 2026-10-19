"use client";

/* eslint-disable @next/next/no-img-element -- tiny sprites/silhouettes; next/image adds nothing here */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { track } from "@vercel/analytics";
import { BarChart3, CalendarDays, Check, CircleHelp, Contrast, Lightbulb, RefreshCw, Share2, ShieldAlert } from "lucide-react";
import { dailyNumber } from "@/lib/daily";
import { getProgress, saveDle, useProgress } from "@/lib/progress";
import { shareOrCopy } from "@/lib/share";
import { useToday } from "@/lib/use-today";
import { play } from "@/lib/sound";
import { buildPokedleShare } from "@/lib/dle-share";
import { dleStats } from "@/lib/dle-stats";
import { archiveRecords, getArchiveRecord, getDlePrefs, saveArchiveRecord, setDlePrefs, useApplyDlePrefs, useDlePrefs } from "@/lib/dle-local";
import {
  DLE_COLUMNS,
  DLE_HINT_COST,
  DLE_HINT_EMOJI,
  DLE_HINT_KINDS,
  DLE_HINT_LABEL,
  DLE_MAX_GUESSES,
  dleScore,
  type DleHint,
  type DleResponse,
} from "@/lib/dle-types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { NextDailyCountdown } from "@/components/NextDailyCountdown";
import { CopyFallback } from "@/components/quiz/CopyFallback";
import { Board, GuessInput, clueText, type NameEntry } from "./parts";
import { DexPanel, type Clue } from "./DexPanel";
import { ArchiveSheet, HowToSheet, StatsSheet } from "./sheets";
import { cn } from "@/lib/utils";

/** The daily, a past daily from the archive (never counted), or a practice puzzle. */
type Target = { kind: "daily"; date: string } | { kind: "archive"; date: string } | { kind: "practice"; seed: string };
type Mode = Target["kind"];

/** A finished daily, for a community panel (percentiles, how others did) to mount beside the result. */
export interface PokedleFinished {
  date: string;
  number: number;
  solved: boolean;
  guesses: number;
  hard: boolean;
  hints: DleHint[];
  score: number;
}

export function Pokedle({ names, community }: { names: NameEntry[]; community?: (finished: PokedleFinished) => React.ReactNode }) {
  const progress = useProgress();
  const prefs = useDlePrefs();
  useApplyDlePrefs();
  const [mode, setMode] = useState<Mode>("daily");
  // Local date, known only after mount (the page is prerendered). `date` is
  // the daily (or archive) puzzle on screen; a daily follows `today` across
  // midnight unless it's mid-solve.
  const today = useToday();
  const [date, setDate] = useState<string | null>(null);
  const [practiceSeed, setPracticeSeed] = useState(() => Math.random().toString(36).slice(2, 10));
  const [guesses, setGuesses] = useState<number[]>([]);
  const [hints, setHints] = useState<DleHint[]>([]);
  const [hard, setHard] = useState(false);
  const [state, setState] = useState<DleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"howto" | "stats" | "archive" | null>(null);
  /** What a screen reader hears after each guess. */
  const [announce, setAnnounce] = useState("");
  /** Latest request id: responses to superseded requests (mode switches) are ignored. */
  const reqRef = useRef(0);
  const seenTodayRef = useRef<string | null>(null);
  /** Only a guess the player just made should make a sound (not restores). */
  const guessedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** A Pokémon clicked in the Pokédex beside the board, for the guess box. */
  const [fill, setFill] = useState<{ name: string; n: number } | null>(null);
  /** A clue clicked on the board, for the Pokédex's filters. */
  const [clue, setClue] = useState<(Clue & { n: number }) | null>(null);

  const target: Target | null = mode === "practice" ? { kind: "practice", seed: practiceSeed } : date ? { kind: mode, date } : null;
  const gameKey = mode === "practice" ? `practice:${practiceSeed}` : `${mode}:${date}`;

  /**
   * Sends every guess so far (and the hints used) and shows the clues. A
   * daily is saved to progress, an archive game to its own store. If the
   * server turns the latest move down (a hard-mode misfit, a dropped
   * connection), `undo` puts the game back as it was.
   */
  const evaluate = useCallback(
    async (list: number[], t: Target, opts: { hints: DleHint[]; hard: boolean; undo?: { guesses: number[]; hints: DleHint[]; name?: string } }) => {
      const id = ++reqRef.current;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/pokedle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(t.kind === "practice" ? { practiceSeed: t.seed } : { date: t.date }),
            guesses: list,
            hints: opts.hints,
            hard: opts.hard,
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Request failed");
        const result = body as DleResponse;
        const record = { guesses: list, solved: result.solved, over: result.over, hard: opts.hard, hints: opts.hints };
        // A daily guess is saved even if the player has since switched modes.
        if (t.kind === "daily") {
          const wasOver = getProgress().dle.results[t.date]?.over;
          saveDle(t.date, record);
          if (result.over && !wasOver) track("pokedle_complete", { solved: result.solved, guesses: list.length, hard: opts.hard, hints: opts.hints.length });
        } else if (t.kind === "archive") {
          saveArchiveRecord(t.date, record);
        }
        if (id !== reqRef.current) return;
        setState(result);
        if (guessedRef.current) {
          const row = result.rows.at(-1);
          if (row) {
            const clues = DLE_COLUMNS.map((c) => clueText(c.label, row.cells[c.key])).join(", ");
            const end = result.solved ? ` Solved! It was ${row.name}.` : result.over ? ` Out of guesses. It was ${result.answer?.name}.` : "";
            setAnnounce(`Guess ${result.rows.length}, ${row.name}: ${clues}.${end}`);
          }
          play(result.solved ? "fanfare" : result.over ? "wrong" : "click");
        }
        guessedRef.current = false;
      } catch (err) {
        guessedRef.current = false;
        if (id !== reqRef.current) return;
        setError(err instanceof Error ? err.message : "Something went wrong");
        if (opts.undo) {
          setGuesses(opts.undo.guesses);
          setHints(opts.undo.hints);
          const name = opts.undo.name;
          if (name) setFill((f) => ({ name, n: (f?.n ?? 0) + 1 }));
        }
      } finally {
        if (id === reqRef.current) setLoading(false);
      }
    },
    []
  );

  /** Opens a daily (or a past one from the archive) where it was left. */
  const loadDate = useCallback(
    (d: string, kind: "daily" | "archive") => {
      reqRef.current++;
      setMode(kind);
      setDate(d);
      setState(null);
      setLoading(false);
      setError(null);
      setCopyFallback(null);
      // An archive game picks up from the daily if that was played (it's saved apart from then on).
      const saved = kind === "daily" ? getProgress().dle.results[d] : (getArchiveRecord(d) ?? getProgress().dle.results[d]);
      const list = saved?.guesses ?? [];
      const h = saved?.hints ?? [];
      const isHard = list.length ? saved?.hard === true : getDlePrefs().hard;
      setGuesses(list);
      setHints(h);
      setHard(isHard);
      if (list.length) void evaluate(list, { kind, date: d }, { hints: h, hard: isHard });
    },
    [evaluate]
  );

  const guessedIds = useMemo(() => new Set(guesses), [guesses]);
  const over = state?.over ?? false;
  const stats = useMemo(() => (progress && today ? dleStats(progress.dle.results, today) : null), [progress, today]);

  // Restore the daily once local storage is available, and roll over to the
  // new puzzle at local midnight (unless one is mid-solve).
  useEffect(() => {
    if (!today || !progress) return;
    const prev = seenTodayRef.current;
    if (prev === today) return;
    seenTodayRef.current = today;
    if (prev === null || (mode === "daily" && (guesses.length === 0 || over))) loadDate(today, "daily");
  }, [today, progress, mode, guesses.length, over, loadDate]);

  // How to play, on a first visit.
  useEffect(() => {
    if (prefs && progress && !prefs.seenHowTo && Object.keys(progress.dle.results).length === 0) setSheet("howto");
  }, [prefs, progress]);

  function submitGuess(entry: NameEntry): boolean {
    if (over || loading || !target) return false;
    guessedRef.current = true;
    const next = [...guesses, entry[0]];
    setGuesses(next);
    void evaluate(next, target, { hints, hard, undo: { guesses, hints, name: entry[1] } });
    return true;
  }

  function takeHint(hint: DleHint) {
    if (over || loading || !target || guesses.length === 0 || hints.includes(hint)) return;
    const next = [...hints, hint];
    setHints(next);
    track("pokedle_hint", { hint, mode });
    void evaluate(guesses, target, { hints: next, hard, undo: { guesses, hints } });
  }

  function toggleHard() {
    if (guesses.length > 0) return;
    setHard(!hard);
    setDlePrefs({ hard: !hard });
  }

  function newPractice() {
    reqRef.current++; // drop any in-flight daily response
    setMode("practice");
    setPracticeSeed(Math.random().toString(36).slice(2, 10));
    setGuesses([]);
    setHints([]);
    setHard(getDlePrefs().hard);
    setState(null);
    setLoading(false);
    setError(null);
    setCopyFallback(null);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function backToDaily() {
    const d = today ?? date;
    if (d) loadDate(d, "daily");
  }

  async function share() {
    if (!state || !date || mode === "practice") return;
    const text = buildPokedleShare({
      number: dailyNumber(date),
      rows: state.rows.map((r) => DLE_COLUMNS.map((c) => r.cells[c.key].status)),
      solved: state.solved,
      hard,
      hints,
      streak: stats?.playStreak ?? 0,
      url: `${window.location.origin}/pokedle`,
      colourBlind: prefs?.colourBlind,
      archive: mode === "archive",
    });
    const outcome = await shareOrCopy(text);
    if (outcome === "failed") {
      setCopyFallback(text);
    } else if (outcome !== "cancelled") {
      setCopyFallback(null);
      setCopied(true);
      track("share", { kind: "pokedle", via: outcome, variant: mode });
      setTimeout(() => setCopied(false), 2500);
    }
  }

  const closeSheet = useCallback(() => {
    if (sheet === "howto") setDlePrefs({ seenHowTo: true });
    setSheet(null);
  }, [sheet]);

  const dailyDone = stats?.doneToday ?? false;
  const score = state ? dleScore(state.rows.length, state.solved, hints) : 0;
  const finished: PokedleFinished | null =
    over && state && date && mode === "daily"
      ? { date, number: dailyNumber(date), solved: state.solved, guesses: state.rows.length, hard, hints, score }
      : null;
  const title = mode === "practice" ? "Pokédle · Practice" : date ? `Pokédle #${dailyNumber(date)}${mode === "archive" ? ` · Archive (${date})` : ""}` : "Pokédle";
  const iconButton = "rounded-md p-2 text-muted-foreground hover:bg-screen/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    // The game, and beside it (below on smaller screens) the reference Pokédex.
    <div className="mx-auto grid max-w-3xl grid-cols-1 gap-6 xl:max-w-none xl:grid-cols-[minmax(0,1fr)_30rem] xl:items-start">
      <div className="min-w-0 space-y-6">
        <div className="space-y-2 text-center">
          <div className="flex items-center justify-center gap-1">
            <p className="hud-label text-screen">{title}</p>
          </div>
          <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">Guess the mystery Pokémon</h1>
          <div className="flex flex-wrap items-center justify-center gap-1" role="toolbar" aria-label="Pokédle options">
            <button type="button" className={iconButton} onClick={() => setSheet("howto")} aria-label="How to play" title="How to play">
              <CircleHelp className="h-5 w-5" />
            </button>
            <button type="button" className={iconButton} onClick={() => setSheet("stats")} aria-label="Statistics" title="Statistics" disabled={!stats}>
              <BarChart3 className="h-5 w-5" />
            </button>
            <button type="button" className={iconButton} onClick={() => setSheet("archive")} aria-label="Archive of past dailies" title="Archive" disabled={!today}>
              <CalendarDays className="h-5 w-5" />
            </button>
            <button
              type="button"
              className={cn(iconButton, prefs?.colourBlind && "text-screen")}
              onClick={() => setDlePrefs({ colourBlind: !prefs?.colourBlind })}
              aria-pressed={prefs?.colourBlind ?? false}
              aria-label="Colour-blind colours (orange and blue)"
              title="Colour-blind colours"
            >
              <Contrast className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={toggleHard}
              disabled={guesses.length > 0}
              aria-pressed={hard}
              title={guesses.length > 0 ? "Hard mode is set before the first guess" : "Every guess must fit every clue so far"}
              className={cn(
                "ml-1 flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold transition-colors disabled:cursor-not-allowed",
                hard ? "border-destructive/60 bg-destructive/10 text-destructive" : "border-foreground/15 text-muted-foreground hover:text-foreground"
              )}
            >
              <ShieldAlert className="h-3.5 w-3.5" aria-hidden /> Hard mode {hard ? "on" : "off"}
            </button>
          </div>
          <p className="text-sm text-muted-foreground">
            {DLE_MAX_GUESSES} guesses. 🟩 match · 🟨 right type, wrong slot, or close (dashed, with ▲▼) · ▲▼ the answer is higher / lower.
          </p>
        </div>

        {mode === "archive" && (
          <p className="mx-auto max-w-md rounded-md border border-screen/40 bg-screen/[0.06] px-3 py-2 text-center text-sm">
            Archive: a past daily, just for fun. It doesn&apos;t count toward your streaks or stats.{" "}
            <button type="button" onClick={backToDaily} className="font-semibold text-primary hover:underline">
              Back to today&apos;s
            </button>
          </p>
        )}

        {stats?.atRisk && !over && (
          <p className="mx-auto max-w-md rounded-md border border-orange-400/50 bg-orange-400/10 px-3 py-2 text-center text-sm font-semibold text-orange-400" role="status">
            🔥 Your {stats.playStreak}-day streak is at risk: finish today&apos;s Pokédle to keep it.
            {stats.freezes > 0 && <span className="block text-xs font-normal">A 🧊 freeze would cover one missed day.</span>}
            {mode !== "daily" && (
              <button type="button" onClick={backToDaily} className="ml-1 underline">
                Play it now
              </button>
            )}
          </p>
        )}

        {!over && (
          <GuessInput
            // A new puzzle starts with an empty box.
            key={gameKey}
            inputRef={inputRef}
            names={names}
            exclude={guessedIds}
            disabled={!target}
            placeholder={`Guess ${guesses.length + 1} of ${DLE_MAX_GUESSES}: type a Pokémon…`}
            onGuess={submitGuess}
            fill={fill}
          />
        )}

        {error && (
          <p className="text-center text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {!over && guesses.length > 0 && (
          <div className="mx-auto flex max-w-md items-center gap-4 rounded-md border bg-card p-3 text-sm">
            <Lightbulb className="h-5 w-5 shrink-0 text-primary" aria-hidden />
            {state?.hints.silhouetteUrl && <img src={state.hints.silhouetteUrl} alt="Silhouette hint" className="spotlight h-20 w-20 rounded-lg object-contain p-1" />}
            <div className="min-w-0 flex-1 space-y-1.5 text-muted-foreground">
              {state?.hints.genus && <div className="font-medium text-foreground">{state.hints.genus}</div>}
              <div className="flex flex-wrap gap-1.5">
                {DLE_HINT_KINDS.filter((h) => !hints.includes(h)).map((h) => (
                  <Button key={h} size="sm" variant="outline" onClick={() => takeHint(h)} disabled={loading}>
                    {DLE_HINT_EMOJI[h]} {DLE_HINT_LABEL[h]} −{DLE_HINT_COST[h]}
                  </Button>
                ))}
              </div>
              <p className="text-xs">{hints.length < DLE_HINT_KINDS.length ? "Hints are optional: each costs points and shows on your result and share." : "Both hints used."}</p>
            </div>
          </div>
        )}

        <div className="sr-only" aria-live="polite" role="status">
          {announce}
        </div>

        {/* The finished state: the result, sharing, what's next, and room for a community panel. */}
        {over && state?.answer && (
          <motion.section aria-label="Result" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="space-y-4">
            <Card className={cn("mx-auto max-w-md", state.solved ? "border-success/50" : "border-destructive/40")}>
              <CardContent className="space-y-4 p-6 text-center">
                <img src={state.answer.imageUrl} alt={state.answer.name} className="mx-auto h-36 w-36 object-contain" />
                <div>
                  <div className="text-2xl font-bold">{state.solved ? `Got it in ${state.rows.length}!` : "So close!"}</div>
                  <div className="text-muted-foreground">
                    It was <b className="text-foreground">{state.answer.name}</b>, the {state.answer.genus}.
                  </div>
                  <div className="mt-2 font-semibold tabular-nums">
                    {score.toLocaleString("en-US")} points
                    {hard && <span className="ml-2 text-destructive">Hard mode *</span>}
                  </div>
                  {hints.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Hints used: {hints.map((h) => `${DLE_HINT_EMOJI[h]} ${DLE_HINT_LABEL[h]} −${DLE_HINT_COST[h]}`).join(", ")}
                    </div>
                  )}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {mode !== "practice" ? (
                    <Button onClick={share}>
                      {copied ? <Check className="h-4 w-4" /> : <Share2 className="h-4 w-4" />} {copied ? "Copied!" : "Share"}
                    </Button>
                  ) : (
                    <Button variant="outline" onClick={backToDaily}>
                      Today&apos;s Pokédle
                    </Button>
                  )}
                  <Button variant={mode === "practice" ? "default" : "outline"} onClick={newPractice}>
                    <RefreshCw className="h-4 w-4" /> {mode === "practice" ? "New puzzle" : "Practice mode"}
                  </Button>
                </div>
                {mode !== "practice" && today && (date !== today || mode === "archive") && !dailyDone && (
                  <Button className="w-full" onClick={backToDaily}>
                    Play today&apos;s Pokédle
                  </Button>
                )}
                {copyFallback && <CopyFallback text={copyFallback} />}
                {mode === "daily" && <NextDailyCountdown label="Next Pokédle in" />}
                {mode === "daily" && stats && stats.playStreak > 0 && (
                  <p className="text-sm font-semibold text-orange-400">
                    🔥 {stats.playStreak}-day play streak{stats.freezes > 0 && ` · 🧊 ${stats.freezes}`}
                  </p>
                )}
                {mode !== "daily" && <p className="text-xs text-muted-foreground">{mode === "archive" ? "Archive" : "Practice"} games don&apos;t count toward streaks or stats.</p>}
              </CardContent>
            </Card>
            {finished && community?.(finished)}
          </motion.section>
        )}

        {state && state.rows.length > 0 && (
          <Board rows={state.rows} onClue={(column, guessId, status) => setClue((c) => ({ column, guessId, status, n: (c?.n ?? 0) + 1 }))} />
        )}

        {!over && mode === "daily" && (
          <p className="text-center text-xs text-muted-foreground">
            {dailyDone ? "Want more? " : "After today's puzzle: "}
            <button type="button" onClick={newPractice} className={dailyDone ? "text-primary hover:underline" : "underline decoration-dotted hover:text-foreground"}>
              practice puzzles
            </button>
            {" · "}
            <button type="button" onClick={() => setSheet("archive")} className={dailyDone ? "text-primary hover:underline" : "underline decoration-dotted hover:text-foreground"} disabled={!today}>
              the archive
            </button>
          </p>
        )}
      </div>
      {/* A new puzzle (the day's, a past one or another practice one) starts with every filter cleared. */}
      <DexPanel
        key={gameKey}
        className="xl:sticky xl:top-20"
        guessed={guessedIds}
        clue={clue}
        onPick={over || !target ? undefined : (name) => setFill((f) => ({ name, n: (f?.n ?? 0) + 1 }))}
      />

      {sheet === "howto" && <HowToSheet onClose={closeSheet} />}
      {sheet === "stats" && stats && (
        <StatsSheet
          stats={stats}
          todayGuesses={today && progress?.dle.results[today]?.over ? (progress.dle.results[today].solved ? progress.dle.results[today].guesses.length : 0) : null}
          onClose={closeSheet}
        />
      )}
      {sheet === "archive" && today && progress && (
        <ArchiveSheet
          today={today}
          daily={progress.dle.results}
          archive={archiveRecords()}
          onPlay={(d) => {
            setSheet(null);
            loadDate(d, "archive");
          }}
          onClose={closeSheet}
        />
      )}
    </div>
  );
}
