"use client";

/* eslint-disable @next/next/no-img-element -- tiny sprites/silhouettes; next/image adds nothing here */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { track } from "@vercel/analytics";
import { BarChart3, CalendarDays, CircleHelp, Dices, Lightbulb, RefreshCw, Settings, Timer, X } from "lucide-react";
import { dailyNumber } from "@/lib/daily";
import { dleBlock, getProgress, saveDle, useProgress } from "@/lib/progress";
import { useToday } from "@/lib/use-today";
import { play } from "@/lib/sound";
import { buildPokedleShare, pokedleShareResult, shareUrl } from "@/lib/share";
import { dleStats } from "@/lib/dle-stats";
import { archiveRecords, getArchiveRecord, getDlePrefs, saveArchiveRecord, setDlePrefs, useApplyDlePrefs, useDlePrefs } from "@/lib/dle-local";
import { DLE_COLUMNS, DLE_HINT_COST, DLE_HINT_EMOJI, DLE_HINT_KINDS, DLE_HINT_LABEL, DLE_SQUIRDLE_FROM, dleScore, type DleHint, type DleResponse } from "@/lib/dle-types";
import {
  DLE_FORMAT_LABEL,
  DLE_TIMER_MS,
  bonusText,
  dailyRules,
  dleRules,
  rulesBonus,
  rulesTags,
  type DleDailyFormat,
  type DleRules,
  type DleSettings,
} from "@/lib/dle-format";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Popover } from "@/components/ui/popover";
import { InfoTip } from "@/components/ui/tooltip";
import { NextDailyCountdown } from "@/components/NextDailyCountdown";
import { ShareButton } from "@/components/share/ShareButton";
import { Board, GuessInput, clueText, type NameEntry } from "./parts";
import { DexPanel, type DexPick } from "./DexPanel";
import { AssistPicker } from "./AssistPicker";
import { RulesChip, SettingsPanel } from "./SettingsPanel";
import { dexClues } from "@/lib/dle-dex";
import { DLE_ASSIST_INFO, dleAssistOf, multiplierText, type DleAssist } from "@/lib/dle-assist";
import { ArchiveSheet, HowToSheet, StatsSheet } from "./sheets";
import { cn } from "@/lib/utils";

/** The daily (in a format), a past Classic daily from the archive (never counted), or a practice puzzle under the player's settings. */
type Target = { kind: "daily"; date: string; format: DleDailyFormat } | { kind: "archive"; date: string } | { kind: "practice"; seed: string; settings: DleSettings };
type Mode = Target["kind"];

/** A finished daily, for a community panel (percentiles, how others did) to mount beside the result. */
export interface PokedleFinished {
  date: string;
  /** Which daily: each format has its own results. */
  format: DleDailyFormat;
  number: number;
  solved: boolean;
  guesses: number;
  hard: boolean;
  hints: DleHint[];
  /** The Pokédex assist level it was played at. */
  assist: DleAssist;
  /** Points, at that level's multiplier. */
  score: number;
  /** The guesses that counted, in order (Pokémon ids). */
  guessIds: number[];
}

/** How the result compares with everyone's, for the share text (see buildPokedleShare). */
export type PokedleShareCommunity = { percentile: number; players: number };

/** A daily's results on this device: Classic's or the Squirdle-style daily's. */
const resultsOf = (format: DleDailyFormat) => dleBlock(getProgress(), format).results;

/**
 * `community` renders beside a finished daily; it can hand back the
 * player's percentile with `setShare` (undefined: none) for the share text.
 */
export function Pokedle({
  names,
  community,
}: {
  names: NameEntry[];
  community?: (finished: PokedleFinished, setShare: (community: PokedleShareCommunity | undefined) => void) => React.ReactNode;
}) {
  const progress = useProgress();
  const prefs = useDlePrefs();
  useApplyDlePrefs();
  const [mode, setMode] = useState<Mode>("daily");
  /** The daily's format on screen: Classic or Squirdle-style. */
  const [format, setFormat] = useState<DleDailyFormat>("classic");
  // Local date, known only after mount (the page is prerendered). `date` is
  // the daily (or archive) puzzle on screen; a daily follows `today` across
  // midnight unless it's mid-solve.
  const today = useToday();
  const [date, setDate] = useState<string | null>(null);
  const [practiceSeed, setPracticeSeed] = useState(() => Math.random().toString(36).slice(2, 10));
  /** A practice game's settings: the player's, until the first guess fixes them for the game. */
  const [practiceSettings, setPracticeSettings] = useState<DleSettings | null>(null);
  const [guesses, setGuesses] = useState<number[]>([]);
  const [hints, setHints] = useState<DleHint[]>([]);
  const [hard, setHard] = useState(false);
  /** The Pokédex assist level: picked before the first guess, fixed after. */
  const [assist, setAssist] = useState<DleAssist>("off");
  const [state, setState] = useState<DleResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<"howto" | "stats" | "archive" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  /** The community panel's percentile for the share, with the finished game it belongs to. */
  const [shareStanding, setShareStanding] = useState<{ key: string; community?: PokedleShareCommunity } | null>(null);
  /** What a screen reader hears after each guess. */
  const [announce, setAnnounce] = useState("");
  /** A timed practice game: when its clock started (the first guess), and now. */
  const [clockStart, setClockStart] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** Latest request id: responses to superseded requests (mode switches) are ignored. */
  const reqRef = useRef(0);
  const seenTodayRef = useRef<string | null>(null);
  /** Only a guess the player just made should make a sound (not restores). */
  const guessedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** A Pokémon clicked in the Pokédex beside the board, for the guess box. */
  const [fill, setFill] = useState<{ name: string; n: number } | null>(null);
  /** A clue clicked on the board, for the Full Pokédex's filters. */
  const [pick, setPick] = useState<(DexPick & { n: number }) | null>(null);

  // A practice game not yet started follows the player's settings.
  const settings = practiceSettings ?? prefs?.settings ?? null;
  const target: Target | null =
    mode === "practice" ? (settings ? { kind: "practice", seed: practiceSeed, settings } : null) : date ? (mode === "daily" ? { kind: "daily", date, format } : { kind: "archive", date }) : null;
  const gameKey = mode === "practice" ? `practice:${practiceSeed}` : `${mode}:${format}:${date}`;
  /** The rules on screen: the server's once it has answered, else what this game will be played by. */
  const rules: DleRules = state?.rules ?? (mode === "practice" ? dleRules(settings ?? {}) : dailyRules(mode === "archive" ? "classic" : format));

  /**
   * Sends every guess so far (and the hints used) and shows the clues. A
   * daily is saved to progress (under its format), an archive game to its
   * own store. If the server turns the latest move down (a hard-mode misfit,
   * a dropped connection), `undo` puts the game back as it was.
   */
  const evaluate = useCallback(
    async (
      list: number[],
      t: Target,
      opts: { hints: DleHint[]; hard: boolean; assist: DleAssist; timedOut?: boolean; undo?: { guesses: number[]; hints: DleHint[]; name?: string } }
    ) => {
      const id = ++reqRef.current;
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/pokedle", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(t.kind === "practice" ? { practiceSeed: t.seed, settings: t.settings } : { date: t.date, ...(t.kind === "daily" && t.format !== "classic" && { format: t.format }) }),
            guesses: list,
            hints: opts.hints,
            hard: opts.hard,
            assist: opts.assist,
            ...(opts.timedOut && { timedOut: true }),
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Request failed");
        const result = body as DleResponse;
        const record = { guesses: list, solved: result.solved, over: result.over, hard: opts.hard, hints: opts.hints, assist: opts.assist };
        // A daily guess is saved even if the player has since switched modes.
        if (t.kind === "daily") {
          const wasOver = resultsOf(t.format)[t.date]?.over;
          saveDle(t.date, record, t.format);
          if (result.over && !wasOver)
            track("pokedle_complete", { solved: result.solved, guesses: list.length, hard: opts.hard, hints: opts.hints.length, assist: opts.assist, format: t.format });
        } else if (t.kind === "archive") {
          saveArchiveRecord(t.date, record);
        }
        if (id !== reqRef.current) return;
        setState(result);
        if (guessedRef.current) {
          const row = result.rows.at(-1);
          if (row) {
            const clues = DLE_COLUMNS.flatMap((c) => (row.cells[c.key] ? [clueText(c.label, row.cells[c.key]!)] : [])).join(", ");
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

  /** Opens a daily (or a past Classic one from the archive) where it was left. */
  const loadDate = useCallback(
    (d: string, kind: "daily" | "archive", fmt: DleDailyFormat = "classic") => {
      // The Squirdle-style daily began on DLE_SQUIRDLE_FROM; the archive is Classic's.
      const f: DleDailyFormat = kind === "archive" || d < DLE_SQUIRDLE_FROM ? "classic" : fmt;
      reqRef.current++;
      setMode(kind);
      setFormat(f);
      setDate(d);
      setState(null);
      setLoading(false);
      setError(null);
        setClockStart(null);
      // An archive game picks up from the daily if that was played (it's saved apart from then on).
      const saved = kind === "daily" ? resultsOf(f)[d] : (getArchiveRecord(d) ?? resultsOf("classic")[d]);
      const list = saved?.guesses ?? [];
      const h = saved?.hints ?? [];
      const isHard = list.length ? saved?.hard === true : getDlePrefs().hard;
      // A game under way keeps the level it started with (an old record: the Notebook, the only level there was).
      const level = list.length ? dleAssistOf(saved?.assist) : getDlePrefs().assist;
      setGuesses(list);
      setHints(h);
      setHard(isHard);
      setAssist(level);
      if (list.length) void evaluate(list, kind === "daily" ? { kind, date: d, format: f } : { kind, date: d }, { hints: h, hard: isHard, assist: level });
    },
    [evaluate]
  );

  const guessedIds = useMemo(() => new Set(guesses), [guesses]);
  const panelClues = useMemo(() => dexClues(state?.rows ?? []), [state]);
  const over = state?.over ?? false;
  const statsFormat: DleDailyFormat = mode === "daily" ? format : "classic";
  const stats = useMemo(
    () => (progress && today ? dleStats(dleBlock(progress, statsFormat).results, today, dailyRules(statsFormat).maxGuesses) : null),
    [progress, today, statsFormat]
  );

  // Restore the daily once local storage is available, and roll over to the
  // new puzzle at local midnight (unless one is mid-solve).
  useEffect(() => {
    if (!today || !progress) return;
    const prev = seenTodayRef.current;
    if (prev === today) return;
    seenTodayRef.current = today;
    if (prev === null) loadDate(today, "daily", getDlePrefs().dailyFormat);
    else if (mode === "daily" && (guesses.length === 0 || over)) loadDate(today, "daily", format);
  }, [today, progress, mode, format, guesses.length, over, loadDate]);

  // How to play, on a first visit.
  const howToShown = useRef(false);
  useEffect(() => {
    if (!prefs || howToShown.current) return;
    howToShown.current = true;
    if (!prefs.seenHowToDemo) setSheet("howto");
  }, [prefs]);

  // A timed practice game: the clock runs from the first guess; when it runs out, the game is over.
  const timerMs = mode === "practice" ? DLE_TIMER_MS[rules.timer] : 0;
  const clockLeft = timerMs && clockStart !== null ? Math.max(0, clockStart + timerMs - now) : timerMs;
  useEffect(() => {
    if (!timerMs || clockStart === null || over) return;
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, [timerMs, clockStart, over]);
  useEffect(() => {
    if (!timerMs || clockStart === null || over || loading || !target || clockLeft > 0) return;
    void evaluate(guesses, target, { hints, hard, assist, timedOut: true });
    // Once, when the clock reaches zero.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clockLeft === 0, timerMs, clockStart, over, loading]);

  function submitGuess(entry: NameEntry): boolean {
    if (over || loading || !target) return false;
    if (timerMs && clockStart !== null && clockLeft <= 0) return false;
    guessedRef.current = true;
    const next = [...guesses, entry[0]];
    setGuesses(next);
    if (target.kind === "practice" && !practiceSettings) setPracticeSettings(target.settings);
    if (timerMs && clockStart === null) {
      setClockStart(Date.now());
      setNow(Date.now());
    }
    void evaluate(next, target, { hints, hard, assist, undo: { guesses, hints, name: entry[1] } });
    return true;
  }

  function takeHint(hint: DleHint) {
    if (over || loading || !target || guesses.length === 0 || hints.includes(hint) || !rules.hints) return;
    const next = [...hints, hint];
    setHints(next);
    track("pokedle_hint", { hint, mode });
    void evaluate(guesses, target, { hints: next, hard, assist, undo: { guesses, hints } });
  }

  function toggleHard() {
    if (guesses.length > 0) return;
    setHard(!hard);
    setDlePrefs({ hard: !hard });
  }

  function pickAssist(level: DleAssist) {
    if (guesses.length > 0) return;
    setAssist(level);
    setDlePrefs({ assist: level });
  }

  function pickSettings(next: DleSettings) {
    if (guesses.length > 0) return;
    setDlePrefs({ settings: next });
    setState(null);
  }

  function pickFormat(f: DleDailyFormat) {
    if (!today) return;
    setDlePrefs({ dailyFormat: f });
    loadDate(today, "daily", f);
  }

  /** A new practice puzzle; `openSettings` shows its settings (from the toolbar, where the player is choosing one). */
  function newPractice(openSettings = false) {
    reqRef.current++; // drop any in-flight daily response
    setMode("practice");
    setPracticeSeed(Math.random().toString(36).slice(2, 10));
    setPracticeSettings(null);
    setGuesses([]);
    setHints([]);
    setHard(getDlePrefs().hard);
    setAssist(getDlePrefs().assist);
    setState(null);
    setLoading(false);
    setError(null);
    setClockStart(null);
    if (openSettings) setSettingsOpen(true);
    else setTimeout(() => inputRef.current?.focus(), 50);
  }

  function backToDaily() {
    const d = today ?? date;
    if (d) loadDate(d, "daily", format);
  }

  const finishedKey = over && state && date && mode === "daily" ? `${format}|${date}|${state.rows.map((r) => r.id).join(",")}` : null;
  const setShare = useCallback(
    (community: PokedleShareCommunity | undefined) => setShareStanding(finishedKey ? { key: finishedKey, community } : null),
    [finishedKey]
  );

  const dexLabel = assist === "off" ? "No dex" : DLE_ASSIST_INFO[assist].label;

  /** The share text: the board as colours, and a link that carries it (/s/…) for the preview card. */
  function shareTextNow(): string {
    if (!state) return "";
    const daily = mode !== "practice" && date;
    const input = {
      number: daily ? dailyNumber(date) : undefined,
      max: rules.maxGuesses,
      // A daily's settings are fixed: its format says it all. A practice game says what it was played by.
      tags: daily ? [DLE_FORMAT_LABEL[rules.format]] : rulesTags(rules).filter((t) => !/ guesses$/.test(t)),
      squirdle: rules.format === "squirdle",
      format: rules.format,
      rows: state.rows.map((r) => rules.columns.flatMap((c) => (r.cells[c] ? [r.cells[c]!.status] : []))),
      solved: state.solved,
      hard,
      hints,
      assist,
      streak: stats?.playStreak ?? 0,
      colourBlind: prefs?.colourBlind,
      archive: mode === "archive",
      community: mode === "daily" && shareStanding?.key === finishedKey ? shareStanding.community : undefined,
    };
    return buildPokedleShare({ ...input, url: shareUrl(pokedleShareResult(input)) });
  }

  const closeSheet = useCallback(() => {
    setSheet(null);
  }, []);
  /** "Don't show again": the first-visit pop-up stays closed on this device. */
  const closeHowToForever = useCallback(() => {
    setDlePrefs({ seenHowTo: true, seenHowToDemo: true });
    setSheet(null);
  }, []);

  const dailyDone = stats?.doneToday ?? false;
  const score = state ? (state.score ?? dleScore(state.rows.length, state.solved, hints, assist, rulesBonus(rules))) : 0;
  const finished: PokedleFinished | null =
    over && state && date && mode === "daily"
      ? { date, format, number: dailyNumber(date), solved: state.solved, guesses: state.rows.length, hard, hints, assist, score, guessIds: state.rows.map((r) => r.id) }
      : null;
  const title =
    mode === "practice"
      ? "Pokédle · Practice"
      : date
        ? `Pokédle #${dailyNumber(date)}${mode === "daily" && format === "squirdle" ? " · Stats" : ""}${mode === "archive" ? ` · Archive (${date})` : ""}`
        : "Pokédle";
  const iconButton =
    "relative rounded-md p-2 text-muted-foreground transition-colors hover:bg-screen/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";
  const locked = guesses.length > 0;
  const bonus = bonusText(rules);
  const timeUp = Boolean(timerMs) && clockStart !== null && clockLeft <= 0;
  /** The one setting worth flagging beside the gear: hard mode first, else a Pokédex level other than the default. */
  const settingsBadge = hard ? "Hard" : assist !== "off" ? DLE_ASSIST_INFO[assist].label : null;

  return (
    // The game, and beside it (below on smaller screens) the reference Pokédex.
    <div className={cn("mx-auto grid max-w-3xl grid-cols-1 gap-6", assist !== "off" && "xl:max-w-none xl:grid-cols-[minmax(0,1fr)_30rem] xl:items-start")}>
      <div className="min-w-0 space-y-5">
        <div className="space-y-4 text-center">
          <div className="space-y-2">
            <p className="hud-label text-screen">{title}</p>
            <h1 className="font-display text-4xl font-bold uppercase tracking-tight">Guess the mystery Pokémon</h1>
          </div>
          <div className="flex justify-center">
            <div className="flex rounded-md border border-foreground/15 bg-card p-0.5" role="radiogroup" aria-label="Daily format">
              {(["classic", "squirdle"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  role="radio"
                  aria-checked={mode === "daily" && format === f}
                  aria-label={f === "classic" ? "Classic daily" : "Stats daily"}
                  title={f === "classic" ? "Today's Classic puzzle" : "Today's Stats puzzle"}
                  onClick={() => pickFormat(f)}
                  disabled={!today || (f === "squirdle" && !!today && today < DLE_SQUIRDLE_FROM)}
                  className={cn(
                    "min-w-24 rounded px-4 py-1.5 font-display text-sm font-semibold uppercase tracking-wider transition-colors",
                    mode === "daily" && format === f ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {DLE_FORMAT_LABEL[f]}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center justify-center gap-1" role="toolbar" aria-label="Pokédle options">
            <button type="button" className={iconButton} onClick={() => setSheet("howto")} aria-label="How to play" title="How to play">
              <CircleHelp className="h-5 w-5" />
            </button>
            <button type="button" className={iconButton} onClick={() => setSheet("stats")} aria-label="Statistics" title="Statistics" disabled={!stats}>
              <BarChart3 className="h-5 w-5" />
            </button>
            <button type="button" className={iconButton} onClick={() => setSheet("archive")} aria-label="Archive of past dailies" title="Archive of past dailies" disabled={!today}>
              <CalendarDays className="h-5 w-5" />
            </button>
            <button
              type="button"
              className={cn(iconButton, mode === "practice" && "text-screen")}
              onClick={() => newPractice(true)}
              aria-pressed={mode === "practice"}
              aria-label="Practice puzzles (any format and settings)"
              title="Practice puzzles: any format and settings"
            >
              <Dices className="h-5 w-5" />
            </button>
            <div className="relative flex items-center">
              <button
                type="button"
                className={cn(iconButton, settingsOpen && "bg-screen/10 text-foreground")}
                onClick={() => setSettingsOpen((o) => !o)}
                aria-expanded={settingsOpen}
                aria-haspopup="dialog"
                aria-label="Settings"
                title="Settings"
              >
                <Settings className="h-5 w-5" />
              </button>
              {settingsBadge && (
                <span className="ml-0.5 rounded-sm border border-foreground/15 px-1.5 py-0.5 font-pixel text-[9px] uppercase tracking-wider text-muted-foreground" data-testid="settings-badge">
                  {settingsBadge}
                </span>
              )}
              <Popover open={settingsOpen} onClose={closeSettings} label="Pokédle settings" className={cn("space-y-4", mode === "practice" && !locked ? "w-[38rem]" : "w-[28rem]")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <p className="hud-label">This game</p>
                    <RulesChip rules={rules} dex={dexLabel} hard={hard} />
                  </div>
                  <button type="button" onClick={closeSettings} aria-label="Close settings" className="rounded-md p-1 text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {locked && <p className="text-xs text-muted-foreground">Set before the first guess: these stay as they are for this game.</p>}
                <div className="space-y-1.5">
                  <p className="hud-label">Pokédex assist</p>
                  <AssistPicker value={assist} onChange={pickAssist} disabled={locked} className="[&>div>span]:hidden [&>div]:justify-start [&>p]:text-left" />
                </div>
                <div className="space-y-2 border-t pt-3">
                  <SettingToggle
                    label="Hard mode"
                    description="Every guess must fit the gen and type clues so far. Your share gets a *."
                    checked={hard}
                    onChange={toggleHard}
                    disabled={locked}
                  />
                  <SettingToggle
                    label="Colour-blind colours"
                    description="Orange and blue in place of green and yellow."
                    checked={prefs?.colourBlind ?? false}
                    onChange={() => setDlePrefs({ colourBlind: !prefs?.colourBlind })}
                  />
                </div>
                {mode === "practice" && settings && !locked && (
                  <div className="space-y-1.5 border-t pt-3">
                    <p className="hud-label">Practice puzzle</p>
                    <SettingsPanel value={settings} onChange={pickSettings} />
                  </div>
                )}
              </Popover>
            </div>
          </div>
        </div>

        {mode === "archive" && (
          <p className="mx-auto max-w-md rounded-md border border-screen/40 bg-screen/[0.06] px-3 py-2 text-center text-sm">
            Archive: a past Classic daily, just for fun. It doesn&apos;t count toward your streaks or stats.{" "}
            <button type="button" onClick={backToDaily} className="font-semibold text-primary hover:underline">
              Back to today&apos;s
            </button>
          </p>
        )}

        {stats?.atRisk && !over && (
          <p className="mx-auto max-w-md rounded-md border border-orange-400/50 bg-orange-400/10 px-3 py-2 text-center text-sm font-semibold text-orange-400" role="status">
            🔥 Your {stats.playStreak}-day streak is at risk: finish today&apos;s {statsFormat === "squirdle" ? "Stats daily" : "Pokédle"} to keep it.
            {stats.freezes > 0 && <span className="block text-xs font-normal">A 🧊 freeze would cover one missed day.</span>}
            {mode !== "daily" && (
              <button type="button" onClick={backToDaily} className="ml-1 underline">
                Play it now
              </button>
            )}
          </p>
        )}

        {timerMs > 0 && !over && (
          <p className={cn("text-center font-display text-2xl font-bold tabular-nums", clockLeft <= 10_000 && clockStart !== null && "text-destructive")} role="timer" aria-label="Time left">
            <Timer className="mr-1 inline h-5 w-5" aria-hidden />
            {Math.floor(Math.ceil(clockLeft / 1000) / 60)}:{String(Math.ceil(clockLeft / 1000) % 60).padStart(2, "0")}
            {clockStart === null && <span className="ml-2 text-xs font-normal text-muted-foreground">starts with your first guess</span>}
          </p>
        )}

        {!over && (
          <div className="space-y-3">
            <GuessInput
              // A new puzzle starts with an empty box.
              key={gameKey}
              inputRef={inputRef}
              names={names}
              exclude={guessedIds}
              disabled={!target || timeUp}
              placeholder={timeUp ? "Time's up" : `Guess ${guesses.length + 1} of ${rules.maxGuesses}: type a Pokémon…`}
              onGuess={submitGuess}
              fill={fill}
            />
            {guesses.length > 0 && rules.hints && (
              <div className="flex flex-wrap items-center justify-center gap-2" data-testid="hints">
                <span className="hud-label flex items-center gap-1">
                  <Lightbulb className="h-3.5 w-3.5 text-primary" aria-hidden /> Hints
                </span>
                {DLE_HINT_KINDS.map((h) =>
                  hints.includes(h) ? (
                    h === "silhouette" && state?.hints.silhouetteUrl ? (
                      <img key={h} src={state.hints.silhouetteUrl} alt="Silhouette hint" className="spotlight h-12 w-12 rounded-md object-contain p-0.5" />
                    ) : h === "genus" && state?.hints.genus ? (
                      <span key={h} className="rounded-full border border-screen/40 bg-screen/[0.06] px-3 py-1 text-xs font-semibold">
                        {DLE_HINT_EMOJI[h]} {state.hints.genus}
                      </span>
                    ) : null
                  ) : (
                    <button
                      key={h}
                      type="button"
                      onClick={() => takeHint(h)}
                      disabled={loading}
                      className="rounded-full border border-foreground/15 bg-card px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors hover:border-screen/50 hover:text-foreground disabled:opacity-50"
                    >
                      {DLE_HINT_EMOJI[h]} {DLE_HINT_LABEL[h]} <span className="tabular-nums text-destructive/80">−{DLE_HINT_COST[h]}</span>
                    </button>
                  )
                )}
                <InfoTip label="About hints">Hints are optional: each costs the points shown, and shows on your result and your share.</InfoTip>
              </div>
            )}
          </div>
        )}

        {error && (
          <p className="text-center text-sm text-destructive" role="alert">
            {error}
          </p>
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
                  <div className="text-2xl font-bold">{state.solved ? `Got it in ${state.rows.length}!` : state.timedOut ? "Time's up!" : "So close!"}</div>
                  <div className="text-muted-foreground">
                    It was <b className="text-foreground">{state.answer.name}</b>, the {state.answer.genus}.
                  </div>
                  <div className="mt-2 font-semibold tabular-nums">
                    {score.toLocaleString("en-US")} points
                    {hard && <span className="ml-2 text-destructive">Hard mode *</span>}
                  </div>
                  <div className="text-xs text-muted-foreground" data-testid="assist-result">
                    {DLE_ASSIST_INFO[assist].emoji} Pokédex: {DLE_ASSIST_INFO[assist].label} {multiplierText(assist)}
                    {bonus && ` · harder board ${bonus}`}
                  </div>
                  <div className="text-xs text-muted-foreground" data-testid="rules-result">
                    {rulesTags(rules, { dex: dexLabel, hard }).join(" · ")}
                  </div>
                  {hints.length > 0 && (
                    <div className="text-xs text-muted-foreground">
                      Hints used: {hints.map((h) => `${DLE_HINT_EMOJI[h]} ${DLE_HINT_LABEL[h]} −${DLE_HINT_COST[h]}`).join(", ")}
                    </div>
                  )}
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <ShareButton getText={shareTextNow} label="Share" kind="pokedle" />
                  <Button variant={mode === "practice" ? "default" : "outline"} onClick={() => newPractice()}>
                    <RefreshCw className="h-4 w-4" /> {mode === "practice" ? "New puzzle" : "Practice mode"}
                  </Button>
                </div>
                {mode === "practice" && (
                  <Button variant="outline" className="w-full" onClick={backToDaily}>
                    Today&apos;s Pokédle
                  </Button>
                )}
                {mode !== "practice" && today && (date !== today || mode === "archive") && !dailyDone && (
                  <Button className="w-full" onClick={backToDaily}>
                    Play today&apos;s Pokédle
                  </Button>
                )}
                {mode === "daily" && <NextDailyCountdown label="Next Pokédle in" />}
                {mode === "daily" && stats && stats.playStreak > 0 && (
                  <p className="text-sm font-semibold text-orange-400">
                    🔥 {stats.playStreak}-day {format === "squirdle" ? "Stats " : ""}play streak{stats.freezes > 0 && ` · 🧊 ${stats.freezes}`}
                  </p>
                )}
                {mode !== "daily" && <p className="text-xs text-muted-foreground">{mode === "archive" ? "Archive" : "Practice"} games don&apos;t count toward streaks or stats.</p>}
              </CardContent>
            </Card>
            {finished && community?.(finished, setShare)}
          </motion.section>
        )}

        {state && state.rows.length > 0 && (
          <Board
            rows={state.rows}
            columns={rules.columns}
            close={rules.close}
            onClue={assist === "full" ? (column, guessId, cell) => setPick((p) => ({ column, guessId, status: cell.status, value: cell.value, n: (p?.n ?? 0) + 1 })) : undefined}
          />
        )}
      </div>
      {/* A new puzzle (the day's, a past one or another practice one) starts with every filter cleared. Pokédex off: no Pokédex. */}
      {/* Only once the game (and its level) is known, so a lighter level never loads a heavier Pokédex first. */}
      {target && assist !== "off" && (
        <DexPanel
          key={`${gameKey}|${assist}`}
          assist={assist}
          className="xl:sticky xl:top-20"
          gens={rules.gens.length ? rules.gens : undefined}
          close={rules.close}
          guessed={guessedIds}
          clues={panelClues}
          pick={pick}
          onPick={over || !target ? undefined : (name) => setFill((f) => ({ name, n: (f?.n ?? 0) + 1 }))}
        />
      )}

      {sheet === "howto" && <HowToSheet onClose={closeSheet} onNever={closeHowToForever} />}
      {sheet === "stats" && stats && progress && today && (
        <StatsSheet
          stats={stats}
          title={statsFormat === "squirdle" ? "Stats daily statistics" : undefined}
          todayGuesses={(() => {
            const r = dleBlock(progress, statsFormat).results[today];
            return r?.over ? (r.solved ? r.guesses.length : 0) : null;
          })()}
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

/** A setting that's on or off: its name and line, and a switch. */
function SettingToggle({ label, description, checked, onChange, disabled }: { label: string; description: string; checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <label className={cn("flex items-center justify-between gap-4", disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer")}>
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={onChange}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed",
          checked ? "border-primary bg-primary" : "border-foreground/20 bg-shade/30"
        )}
      >
        <span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full bg-foreground transition-[left]", checked ? "left-[1.1rem] bg-primary-foreground" : "left-0.5")} />
      </button>
    </label>
  );
}
