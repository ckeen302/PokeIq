"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "framer-motion";
import { track } from "@vercel/analytics";
import { BarChart3, CalendarDays, CircleHelp, Dices, Infinity as InfinityIcon, Lightbulb, PencilLine, RefreshCw, Settings, Shuffle, Swords, Timer, X } from "lucide-react";
import { connBlock, getProgress, recordConnGame, saveConn, setTrainerName, useProgress, type BadgeDef, type ConnRecord } from "@/lib/progress";
import { parsePracticeSeed } from "@/lib/connections/pack-seed";
import { useToday } from "@/lib/use-today";
import { play } from "@/lib/sound";
import { dlePlayerId } from "@/lib/dle-player";
import { clock, connectionsShareText, shareUrl, type ConnectionsShareResult } from "@/lib/share";
import { connArchive, connStats, getConnPrefs, rememberStart, saveConnArchive, setConnPrefs, startFor, useConnPrefs, type ConnPrefs } from "@/lib/connections/local";
import {
  CONN_MAX_MISTAKES,
  CONN_SIZES,
  connMaxMistakes,
  connNumber,
  guessKey,
  type ConnSize,
  type ConnBoardResponse,
  type ConnBoardRow,
  type ConnBoardStanding,
  type ConnDaySummary,
  type ConnGuessResponse,
  type ConnLevel,
  type ConnPuzzleResponse,
  type ConnResultResponse,
  type ConnTile,
} from "@/lib/connections/types";
import type { ConnChallenge, ConnGroupStats, ConnHintResponse, ConnScore } from "@/lib/connections/social";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Popover } from "@/components/ui/popover";
import { ShareButton } from "@/components/share/ShareButton";
import { GridTile, GroupBar, GuessHistory, MistakeDots, WhyPanel, type TileMotion } from "./parts";
import { ConnArchiveSheet, ConnHowToSheet, ConnStatsSheet } from "./sheets";
import { ChallengeBanner, ChallengeResult, FeedbackPanel, GroupStats } from "./social";
import { ComeBackTomorrow, DailyLeaderboard, KeyHints, NewBadges, PerfectBanner, StreakFlame, useCelebration } from "./results";
import { cn } from "@/lib/utils";
import { CUSTOM_SEED_RE, customSeed } from "@/lib/connections/custom";

/** Today's daily, a past daily from the archive (never counted), or a practice puzzle. */
type Target = { kind: "daily"; date: string } | { kind: "archive"; date: string } | { kind: "practice"; seed: string };
type Mode = Target["kind"];

/** A practice seed, with Unlimited's board size and difficulty in front ("s5-hard-x7k2abcd"): the server reads them back from there. */
const newSeed = (level: ConnPrefs["level"] = "normal", pack: ConnPrefs["pack"] = "all", size: ConnSize = 4) =>
  `${size === 5 ? "s5-" : ""}${pack === "all" ? "" : `${pack}-`}${level}-${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;
const SIZE_WORDS = { 4: "four", 5: "five" } as const;
const SIZE_SQUARES = { 4: "Sixteen", 5: "Twenty-five" } as const;
const LEVELS: { id: ConnPrefs["level"]; label: string; hint: string }[] = [
  { id: "easy", label: "Easy", hint: "Two straightforward groups, no tricky one" },
  { id: "normal", label: "Normal", hint: "One group of each colour, like the daily" },
  { id: "hard", label: "Hard", hint: "No easy group, two tricky ones" },
];
const TOAST_MS = 1600;
/** How long a right guess's tiles bounce before they become a bar. */
const JUMP_MS = 620;
/** Between groups revealed after a loss. */
const REVEAL_MS = 750;

const query = (t: Target): Record<string, string> => (t.kind === "practice" ? { practice: t.seed } : { date: t.date });

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** `customId`: a community puzzle (/connections/c/<id>) to open first instead of the daily. */
export function Connections({ customId }: { customId?: string } = {}) {
  const progress = useProgress();
  const prefs = useConnPrefs();
  const today = useToday();
  const [target, setTarget] = useState<Target | null>(null);
  const [puzzle, setPuzzle] = useState<ConnPuzzleResponse | null>(null);
  /** The grid's current order (shuffling changes it). */
  const [order, setOrder] = useState<number[]>([]);
  const [selected, setSelected] = useState<number[]>([]);
  const [guesses, setGuesses] = useState<number[][]>([]);
  const [state, setState] = useState<ConnGuessResponse | null>(null);
  /** After a loss, how many of the missing groups have been revealed so far. */
  const [revealed, setRevealed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const [tileMotion, setTileMotion] = useState<{ kind: Exclude<TileMotion, null>; ids: number[]; n: number } | null>(null);
  const [sheet, setSheet] = useState<"howto" | "stats" | "archive" | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [summary, setSummary] = useState<ConnDaySummary | null>(null);
  const [board, setBoard] = useState<ConnBoardStanding | null>(null);
  const [boardRows, setBoardRows] = useState<ConnBoardRow[] | null>(null);
  /** Badges the game just finished earned. */
  const [fresh, setFresh] = useState<BadgeDef[]>([]);
  /** Confetti for a game won just now (not one restored on a reload). */
  const [celebrate, setCelebrate] = useState<"perfect" | "solved" | null>(null);
  const [announce, setAnnounce] = useState("");
  /** The one hint: a Pokémon of the easiest group not found yet (the server keeps the record). */
  const [hint, setHint] = useState<{ id: number; level: ConnLevel } | null>(null);
  const [hintBusy, setHintBusy] = useState(false);
  /** The game used the hint (so the results screen and share card say so). */
  const [usedHint, setUsedHint] = useState(false);
  const [groupStats, setGroupStats] = useState<ConnGroupStats | null>(null);
  const [mine, setMine] = useState<ConnScore | null>(null);
  /** A friend's "Beat my time" link. */
  const [challenge, setChallenge] = useState<ConnChallenge | null>(null);
  /** Time on this game: what's banked, and when the running stretch began (null: not running). */
  const [elapsed, setElapsed] = useState({ banked: 0, since: null as number | null });
  const [now, setNow] = useState(() => Date.now());
  const reqRef = useRef(0);
  const seenTodayRef = useRef<string | null>(null);
  const loadedRef = useRef(false);
  const tileRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const toastTimer = useRef<number | undefined>(undefined);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  const mode: Mode = target?.kind ?? "daily";
  const symbols = prefs?.symbols ?? true;
  const level = prefs?.level ?? "normal";
  const pickedSize: ConnSize = prefs?.size === 5 ? 5 : 4;
  /** This board's side: the puzzle's, else its seed's (Unlimited), else 4: the daily is always 4×4. */
  const size: ConnSize = puzzle?.size ?? (target?.kind === "practice" ? (parsePracticeSeed(target.seed).size ?? 4) : 4);
  const over = state?.over ?? false;
  const won = state?.won ?? false;
  const foundLevels = useMemo(() => new Set((state?.found ?? []).map((g) => g.level)), [state]);
  /** The bars on screen: groups found, then (after a loss) the missing ones revealed so far, easiest first. */
  const bars = useMemo(() => {
    if (!state) return [];
    const missing = over && !won ? (state.reveal ?? []).filter((g) => !foundLevels.has(g.level)).slice(0, revealed) : [];
    return [...state.found, ...missing];
  }, [state, over, won, foundLevels, revealed]);
  const placed = useMemo(() => new Set(bars.flatMap((b) => b.members.map((m) => m.id))), [bars]);
  const tilesById = useMemo(() => new Map((puzzle?.tiles ?? []).map((t) => [t.id, t])), [puzzle]);
  const remaining = order.filter((id) => !placed.has(id)).map((id) => tilesById.get(id)!).filter(Boolean);
  const missingCount = over && !won ? size - (state?.found.length ?? 0) : 0;
  const revealDone = over && (won || revealed >= missingCount);
  const mistakesLeft = connMaxMistakes(size) - (state?.mistakes ?? 0);
  const ms = elapsed.banked + (elapsed.since !== null ? now - elapsed.since : 0);

  const stats = useMemo(() => (progress && today ? connStats(connBlock(progress).results, today) : null), [progress, today]);

  // ---- Saving ----------------------------------------------------------------

  /** Saves the game where its mode keeps it; a daily's first finish returns the badges it earned. */
  const save = useCallback((t: Target, record: ConnRecord): BadgeDef[] => {
    if (t.kind === "daily") return saveConn(t.date, record);
    if (t.kind === "archive") saveConnArchive(t.date, record);
    return [];
  }, []);

  // ---- Loading a puzzle ------------------------------------------------------

  const load = useCallback(async (t: Target) => {
    const id = ++reqRef.current;
    // A new puzzle (Next puzzle, a mode, the archive) starts at the top; the first one loads where the page opened.
    if (loadedRef.current) window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
    loadedRef.current = true;
    setTarget(t);
    setPuzzle(null);
    setOrder([]);
    setSelected([]);
    setState(null);
    setRevealed(0);
    setError(null);
    setSummary(null);
    setBoard(null);
    setBoardRows(null);
    setHint(null);
    setUsedHint(false);
    setGroupStats(null);
    setMine(null);
    setFresh([]);
    setCelebrate(null);
    setTileMotion(null);
    setBusy(true);
    const saved = t.kind === "practice" ? undefined : t.kind === "daily" ? connBlock(getProgress()).results[t.date] : (connArchive()[t.date] ?? connBlock(getProgress()).results[t.date]);
    const list = saved?.guesses ?? [];
    setGuesses(list);
    setUsedHint(!!saved?.hinted);
    setElapsed({ banked: saved?.ms ?? 0, since: null });
    try {
      const res = await fetch(`/api/connections?${new URLSearchParams(query(t))}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Couldn't load the puzzle. Try again.");
      if (id !== reqRef.current) return;
      const p = body as ConnPuzzleResponse;
      // The first deal of the day times the game for the leaderboard (a reload doesn't restart the clock).
      if (t.kind === "daily") rememberStart(t.date, p.start);
      setPuzzle(p);
      setOrder(p.tiles.map((x) => x.id));
      if (list.length) {
        const r = await fetch("/api/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...query(t), guesses: list }) });
        const restored = await r.json();
        if (!r.ok) throw new Error(restored.error ?? "Couldn't restore your game.");
        if (id !== reqRef.current) return;
        setState(restored as ConnGuessResponse);
        setRevealed(5);
      }
      // A hint taken before a reload: the server hands back the same Pokémon.
      if (t.kind === "daily" && saved?.hinted && !saved.over) {
        const h = await fetch("/api/connections/hint", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: t.date, player: dlePlayerId(), guesses: list }) });
        const hb = h.ok ? ((await h.json()) as ConnHintResponse) : null;
        if (id === reqRef.current && hb?.available) setHint(hb.hint);
      }
    } catch (err) {
      if (id === reqRef.current) setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      if (id === reqRef.current) setBusy(false);
    }
  }, []);

  // Today's daily once local storage is ready; roll over at midnight unless mid-game.
  useEffect(() => {
    if (!today || !progress) return;
    const prev = seenTodayRef.current;
    if (prev === today) return;
    seenTodayRef.current = today;
    if (prev === null && customId) void load({ kind: "practice", seed: customSeed(customId) });
    else if (prev === null || (mode === "daily" && (guesses.length === 0 || over))) void load({ kind: "daily", date: today });
  }, [today, progress, mode, guesses.length, over, load, customId]);

  // How to play, on a first visit.
  useEffect(() => {
    if (prefs && progress && !prefs.seenHowTo && Object.keys(connBlock(progress).results).length === 0) setSheet("howto");
  }, [prefs, progress]);

  // The clock: runs while a started game is open and visible.
  const started = guesses.length > 0 || selected.length > 0;
  useEffect(() => {
    if (!puzzle || over || !started) return;
    const resume = () => setElapsed((e) => (e.since === null && document.visibilityState === "visible" ? { ...e, since: Date.now() } : e));
    const pause = () => setElapsed((e) => (e.since !== null ? { banked: e.banked + Date.now() - e.since, since: null } : e));
    resume();
    const onVis = () => (document.visibilityState === "visible" ? resume() : pause());
    document.addEventListener("visibilitychange", onVis);
    const tick = setInterval(() => setNow(Date.now()), 500);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearInterval(tick);
      pause();
    };
  }, [puzzle, over, started]);

  // After a loss, reveal the missing groups one by one, easiest first.
  useEffect(() => {
    if (!over || won || revealed >= missingCount) return;
    const t = setTimeout(() => setRevealed((r) => r + 1), revealed === 0 ? 500 : REVEAL_MS);
    return () => clearTimeout(t);
  }, [over, won, revealed, missingCount]);

  // A finished daily: record it for the day's stats (and get them back).
  const finishedDaily = over && target?.kind === "daily" ? target.date : null;
  /**
   * Sends the finished daily: the server replays it for the day's stats and
   * the leaderboard (timed by its own start token), then the board loads. A
   * trainer can send it again with a name to get ranked.
   */
  const sendResult = useCallback(
    async (date: string, list: number[][], name?: string) => {
      try {
        const r = await fetch("/api/connections/result", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date, player: dlePlayerId(), guesses: list, start: startFor(date), ...((name || getProgress().name) && { name: name || getProgress().name }) }),
        });
        const body = r.ok ? ((await r.json()) as ConnResultResponse) : null;
        if (!body) return;
        if (body.available) setSummary(body.summary);
        setGroupStats(body.groups ?? null);
        if (body.hinted) setUsedHint(true);
        setMine(body.mine ?? null);
        setBoard(body.board ?? null);
        if (body.board && !("unranked" in body.board && body.board.unranked === "off")) {
          const b = await fetch(`/api/connections/leaderboard?date=${date}`, { cache: "no-store" });
          if (b.ok) setBoardRows(((await b.json()) as ConnBoardResponse).rows);
        }
      } catch {
        // No stats or board today: the game doesn't need them.
      }
    },
    []
  );
  useEffect(() => {
    if (!finishedDaily || !guesses.length) return;
    void sendResult(finishedDaily, guesses);
    // Once per finished daily (the guesses are final by then).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finishedDaily]);

  /** A name to rank under, from the results screen: it becomes the trainer name too. */
  async function rankAs(name: string) {
    if (!finishedDaily) return;
    if (!getProgress().name) setTrainerName(name);
    await sendResult(finishedDaily, guesses, name);
  }

  // ---- Playing ---------------------------------------------------------------

  // A friend's "Beat my time" link (/connections?beat=<token>): the server says whose result it is.
  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("beat");
    if (!token) return;
    fetch(`/api/connections/beat?token=${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? (r.json() as Promise<ConnChallenge>) : null))
      .then((c) => c && setChallenge(c))
      .catch(() => undefined);
  }, []);

  /** The optional hint (today's daily only, one per puzzle): the server picks the Pokémon and remembers it. */
  async function takeHint() {
    if (!target || target.kind !== "daily" || !puzzle || over || busy || hintBusy || usedHint) return;
    setHintBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/connections/hint", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date: target.date, player: dlePlayerId(), guesses }) });
      const body = (await r.json()) as ConnHintResponse & { error?: string };
      if (!r.ok) throw new Error(body.error ?? "Couldn't get a hint.");
      if (!body.available) return showToast("Hints aren't available right now.");
      setHint(body.hint);
      setUsedHint(true);
      save(target, { guesses, solved: false, over: false, mistakes: state?.mistakes ?? 0, ms: Math.round(ms), hinted: true });
      setAnnounce(`Hint: ${tilesById.get(body.hint.id)?.name ?? "one Pokémon"} belongs to the easiest group left. It is marked on the grid.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't get a hint.");
    } finally {
      setHintBusy(false);
    }
  }

  function showToast(text: string) {
    window.clearTimeout(toastTimer.current);
    setToast((t) => ({ text, n: (t?.n ?? 0) + 1 }));
    toastTimer.current = window.setTimeout(() => setToast(null), TOAST_MS);
  }
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  function toggle(id: number) {
    if (over || busy || !puzzle) return;
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < size ? [...s, id] : s));
  }

  function shuffle() {
    setOrder((o) => {
      const rest = o.filter((id) => !placed.has(id));
      for (let i = rest.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [rest[i], rest[j]] = [rest[j], rest[i]];
      }
      return [...o.filter((id) => placed.has(id)), ...rest];
    });
  }

  async function submit() {
    if (!target || !puzzle || over || busy || selected.length !== size) return;
    const pick = [...selected];
    if (guesses.some((g) => guessKey(g) === guessKey(pick))) {
      showToast("Already guessed!");
      setAnnounce("Already guessed. That doesn't cost a mistake.");
      return;
    }
    const next = [...guesses, pick];
    const id = ++reqRef.current;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...query(target), guesses: next }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Couldn't check that guess.");
      if (id !== reqRef.current) return;
      const result = body as ConnGuessResponse;
      const last = result.results.at(-1);
      const elapsedMs = elapsed.banked + (elapsed.since !== null ? Date.now() - elapsed.since : 0);
      const earned = save(target, { guesses: next, solved: result.won, over: result.over, mistakes: result.mistakes, ms: Math.round(elapsedMs), ...(usedHint && { hinted: true }) });
      setGuesses(next);
      if (result.over && !state?.over) {
        // Unlimited and the archive count toward the tallies and badges too (never the streak).
        const badges = target.kind === "daily" ? earned : recordConnGame(result.won, result.mistakes, target.kind === "practice" && parsePracticeSeed(target.seed).difficulty === "hard");
        setFresh(badges);
        setCelebrate(result.won ? (result.mistakes === 0 ? "perfect" : "solved") : null);
        if (target.kind === "daily") track("connections_complete", { won: result.won, mistakes: result.mistakes });
      }
      const reduced = reducedMotion();
      if (last?.kind === "correct") {
        const group = result.found.at(-1)!;
        setTileMotion({ kind: "jump", ids: pick, n: Date.now() });
        play("correct");
        setAnnounce(`Correct: ${group.label}. ${group.members.map((m) => m.name).join(", ")}.${result.won ? " Puzzle solved!" : ""}`);
        await new Promise((r) => setTimeout(r, reduced ? 0 : JUMP_MS));
        if (id !== reqRef.current) return;
        setTileMotion(null);
        setSelected([]);
        setState(result);
        if (result.won) play("fanfare");
      } else {
        setTileMotion({ kind: "shake", ids: pick, n: Date.now() });
        play("wrong");
        const oneAway = last?.kind === "one-away";
        if (oneAway) showToast("One away…");
        const left = connMaxMistakes(size) - result.mistakes;
        setAnnounce(`${oneAway ? "One away. " : "Not a group. "}${result.over ? "No mistakes left: here are the groups." : `${left} mistake${left === 1 ? "" : "s"} left.`}`);
        setState(result);
        if (result.over) setSelected([]);
        window.setTimeout(() => setTileMotion((m) => (m?.kind === "shake" ? null : m)), 450);
      }
    } catch (err) {
      if (id === reqRef.current) setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      if (id === reqRef.current) setBusy(false);
    }
  }

  // Keyboard: arrows move between tiles, Enter submits a full selection, Esc deselects.
  function onTileKey(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const cols = size;
    const move = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key];
    if (move !== undefined) {
      e.preventDefault();
      const nextIndex = Math.min(remaining.length - 1, Math.max(0, index + move));
      tileRefs.current[nextIndex]?.focus();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (selected.length === size) void submit();
      else toggle(remaining[index].id);
    }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheet || settingsOpen || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select")) return;
      if (e.key === "Escape" && selected.length) setSelected([]);
      // S shuffles, while there's a grid to shuffle.
      else if ((e.key === "s" || e.key === "S") && puzzle && !over) shuffle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---- Modes -----------------------------------------------------------------

  function newPractice(level: ConnPrefs["level"] = getConnPrefs().level, boardSize: ConnSize = getConnPrefs().size === 5 ? 5 : 4) {
    void load({ kind: "practice", seed: newSeed(level, "all", boardSize) });
  }

  function backToDaily() {
    if (today) void load({ kind: "daily", date: today });
  }

  const closeSheet = useCallback(() => {
    if (sheet === "howto") setConnPrefs({ seenHowTo: true });
    setSheet(null);
  }, [sheet]);

  // ---- Results ---------------------------------------------------------------

  /** Each guess as its tiles' groups (known once it's over). */
  const historyRows = useMemo<ConnLevel[][]>(() => {
    if (!state?.reveal) return [];
    const levelOf = new Map(state.reveal.flatMap((g) => g.members.map((m) => [m.id, g.level] as const)));
    return guesses.map((g) => g.map((id) => levelOf.get(id) ?? 0));
  }, [state, guesses]);

  const daily = target && target.kind !== "practice" ? target : null;
  const streak = stats?.playStreak ?? 0;
  // The name you rank under: the server's answer (your username when signed in), else your trainer name.
  const rankName = board && "position" in board && board.name ? board.name : progress?.name || null;
  useCelebration(revealDone && celebrate ? celebrate : null);

  function shareTextNow(): string {
    const result: ConnectionsShareResult = {
      game: "connections",
      ...(daily && { daily: connNumber(daily.date) }),
      ...(daily?.kind === "archive" && { archive: true }),
      solved: won,
      rows: historyRows.map((r) => r.join("")),
      ...(ms >= 1000 && { seconds: Math.round(ms / 1000) }),
      ...(daily?.kind === "daily" && streak > 0 && { streak }),
      ...(usedHint && { hinted: true }),
    };
    return connectionsShareText(result, shareUrl(result));
  }

  /** A community puzzle: plays like practice, with its own byline and votes above the grid (see the page). */
  const isCustom = target?.kind === "practice" && CUSTOM_SEED_RE.test(target.seed);
  const title = isCustom ? "PokéConnections · Community puzzle" : mode === "practice" ? "PokéConnections · Practice" : daily ? `PokéConnections #${connNumber(daily.date)}${mode === "archive" ? ` · Archive (${daily.date})` : ""}` : "PokéConnections";
  const iconButton =
    "relative rounded-md p-2 text-muted-foreground transition-colors hover:bg-screen/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";
  const motionFor = (id: number): TileMotion => (tileMotion?.ids.includes(id) ? tileMotion.kind : null);
  const todayRecord = today && progress ? connBlock(progress).results[today] : undefined;

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="space-y-4 text-center">
          <div className="space-y-2">
            <p className="hud-label text-screen" data-testid="conn-title">
              {title}
            </p>
            <h1 className="font-display text-4xl font-bold uppercase tracking-tight">Find the {SIZE_WORDS[size]} groups</h1>
            <p className="text-sm text-muted-foreground">
              {SIZE_SQUARES[size]} Pokémon, {SIZE_WORDS[size]} hidden links. Every Pokémon fits exactly one.
            </p>
          </div>
          <div className="flex justify-center">
            <div className="flex flex-wrap justify-center rounded-md border border-foreground/15 bg-card p-0.5" role="radiogroup" aria-label="PokéConnections mode">
              {(
                [
                  { id: "daily", label: "Daily", title: "Today's puzzle, the same for everyone", on: backToDaily, disabled: !today },
                  { id: "practice", label: "Unlimited", title: "A fresh puzzle every time, as many as you like", on: () => newPractice() },
                  { id: "archive", label: "Archive", title: "Every past daily", on: () => setSheet("archive"), disabled: !today },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={mode === m.id}
                  title={m.title}
                  onClick={m.on}
                  disabled={"disabled" in m && m.disabled}
                  className={cn(
                    "min-w-[5.5rem] rounded px-3 py-1.5 font-display text-sm font-semibold uppercase tracking-wider transition-colors sm:min-w-24 sm:px-4",
                    mode === m.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {m.label}
                </button>
              ))}
              <a
                href="#duel"
                title="Race a friend or a stranger to the four groups"
                className="flex min-w-[5.5rem] items-center justify-center gap-1.5 rounded px-3 py-1.5 font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground sm:min-w-24 sm:px-4"
              >
                <Swords className="h-3.5 w-3.5" aria-hidden /> Duel
              </a>
              <a
                href="/connections/create"
                title="Build your own puzzle and share a link"
                data-testid="conn-create-link"
                className="flex min-w-[5.5rem] items-center justify-center gap-1.5 rounded px-3 py-1.5 font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground sm:min-w-24 sm:px-4"
              >
                <PencilLine className="h-3.5 w-3.5" aria-hidden /> Create
              </a>
            </div>
          </div>
          <div className="flex items-center justify-center gap-1" role="toolbar" aria-label="PokéConnections options">
            <button type="button" className={iconButton} onClick={() => setSheet("howto")} aria-label="How to play" title="How to play">
              <CircleHelp className="h-5 w-5" />
            </button>
            <button type="button" className={iconButton} onClick={() => setSheet("stats")} aria-label="Statistics" title="Statistics" disabled={!stats}>
              <BarChart3 className="h-5 w-5" />
            </button>
            <button type="button" className={iconButton} onClick={() => setSheet("archive")} aria-label="Archive of past dailies" title="Archive of past dailies" disabled={!today}>
              <CalendarDays className="h-5 w-5" />
            </button>
            <button type="button" className={cn(iconButton, mode === "practice" && "text-screen")} onClick={() => newPractice()} aria-pressed={mode === "practice"} aria-label="New practice puzzle" title="New practice puzzle (unlimited)">
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
              <Popover open={settingsOpen} onClose={closeSettings} label="PokéConnections settings" className="w-[24rem] max-w-[calc(100vw-2rem)] space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="hud-label pt-1">Settings</p>
                  <button type="button" onClick={closeSettings} aria-label="Close settings" className="rounded-md p-1 text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <SettingToggle
                  label="Group symbols"
                  description="● ▲ ■ ◆ on each group as well as its colour (easier with colour blindness)."
                  checked={symbols}
                  onChange={() => setConnPrefs({ symbols: !getConnPrefs().symbols })}
                />
                <SettingToggle label="Show the clock" description="A running timer above the grid. Your time is on your result either way." checked={prefs?.showTimer ?? false} onChange={() => setConnPrefs({ showTimer: !getConnPrefs().showTimer })} />
              </Popover>
            </div>
          </div>
        </div>

        {mode === "archive" && (
          <p className="mx-auto max-w-md rounded-md border border-screen/40 bg-screen/[0.06] px-3 py-2 text-center text-sm">
            Archive: a past daily, just for fun. It doesn&apos;t count toward your streaks or stats.{" "}
            <button type="button" onClick={backToDaily} className="font-semibold text-primary hover:underline">
              Back to today&apos;s
            </button>
          </p>
        )}
        {isCustom && (
          <p className="mx-auto max-w-md rounded-md border border-screen/40 bg-screen/[0.06] px-3 py-2 text-center text-sm" data-testid="conn-community">
            A puzzle made by another trainer. It doesn&apos;t count toward your streak.{" "}
            <a href="/connections/community" className="font-semibold text-primary hover:underline">
              More community puzzles
            </a>
          </p>
        )}
        {mode === "practice" && !isCustom && (
          <div className="mx-auto max-w-md space-y-2 rounded-md border border-screen/40 bg-screen/[0.06] px-3 py-2.5 text-center text-sm" data-testid="conn-unlimited">
            <p>Unlimited: a fresh puzzle every time, never counted toward your streak.</p>
            <div className="flex items-center justify-center gap-2">
              <span className="hud-label">Difficulty</span>
              <div className="flex gap-1" role="radiogroup" aria-label="Unlimited difficulty">
                {LEVELS.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    role="radio"
                    aria-checked={level === l.id}
                    title={l.hint}
                    onClick={() => {
                      if (level === l.id) return;
                      setConnPrefs({ level: l.id });
                      // A new puzzle at that level, unless this one is under way.
                      if (guesses.length === 0 || over) newPractice(l.id);
                    }}
                    className={cn(
                      "h-8 rounded-sm border px-2.5 font-pixel text-[10px] uppercase tracking-wider transition-colors",
                      level === l.id ? "border-primary bg-primary text-primary-foreground" : "border-foreground/10 bg-shade/20 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                    )}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-center gap-2">
              <span className="hud-label">Board</span>
              <div className="flex gap-1" role="radiogroup" aria-label="Unlimited board size" data-testid="conn-size">
                {CONN_SIZES.map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={pickedSize === n}
                    title={n === 4 ? "Sixteen Pokémon, four groups of four, four mistakes" : "Twenty-five Pokémon, five groups of five, five mistakes"}
                    data-testid={`conn-size-${n}`}
                    onClick={() => {
                      if (pickedSize === n) return;
                      setConnPrefs({ size: n });
                      // A new puzzle at that size, unless this one is under way.
                      if (guesses.length === 0 || over) newPractice(level, n);
                    }}
                    className={cn(
                      "h-8 rounded-sm border px-2.5 font-pixel text-[10px] uppercase tracking-wider transition-colors",
                      pickedSize === n ? "border-primary bg-primary text-primary-foreground" : "border-foreground/10 bg-shade/20 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                    )}
                  >
                    {n}×{n}
                  </button>
                ))}
              </div>
            </div>
            {guesses.length > 0 && !over && <p className="text-xs text-muted-foreground">A new difficulty or board size starts with your next puzzle.</p>}
          </div>
        )}
        {mode === "daily" && stats?.atRisk && !over && (
          <p className="mx-auto max-w-md rounded-md border border-orange-400/50 bg-orange-400/10 px-3 py-2 text-center text-sm font-semibold text-orange-400" role="status">
            🔥 Your {stats.playStreak}-day streak is at risk: finish today&apos;s puzzle to keep it.
          </p>
        )}

        {/* The board: found groups as bars on top, the tiles still in play below. */}
        <div className="relative">
          <AnimatePresence>
            {toast && (
              <motion.div
                key={toast.n}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="pointer-events-none absolute inset-x-0 top-[40%] z-20 flex justify-center"
                role="status"
                aria-live="assertive"
                data-testid="conn-toast"
              >
                <span className="rounded-md bg-foreground px-5 py-2.5 font-display text-base font-bold uppercase tracking-wider text-background shadow-[0_10px_30px_rgb(0_0_0/0.45)]">{toast.text}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {!puzzle ? (
            <div className={cn("grid gap-2 sm:gap-2.5", size === 5 ? "grid-cols-5" : "grid-cols-4")} aria-busy="true" aria-label="Loading the puzzle">
              {Array.from({ length: size * size }, (_, i) => (
                <div key={i} className={cn("animate-pulse rounded-lg border bg-card", size === 5 ? "h-[5.5rem] sm:h-[6.75rem]" : "h-[7.25rem] sm:h-[8.25rem]")} />
              ))}
            </div>
          ) : (
            <LayoutGroup>
              <div className="space-y-2 sm:space-y-2.5">
                {bars.map((g) => (
                  <GroupBar key={g.level} group={g} symbols={symbols} revealed={!foundLevels.has(g.level)} compact={size === 5} />
                ))}
                {remaining.length > 0 && (
                  <div className={cn("grid gap-2 sm:gap-2.5", size === 5 ? "grid-cols-5" : "grid-cols-4")} data-testid="conn-grid" data-size={size} aria-label="Pokémon to group">
                    {remaining.map((t: ConnTile, i) => (
                      <GridTile
                        key={t.id}
                        ref={(el) => {
                          tileRefs.current[i] = el;
                        }}
                        tile={t}
                        index={i}
                        selected={selected.includes(t.id)}
                        disabled={over || (busy && !tileMotion)}
                        motionKind={motionFor(t.id)}
                        order={tileMotion ? tileMotion.ids.indexOf(t.id) : 0}
                        onToggle={() => toggle(t.id)}
                        onKeyDown={(e) => onTileKey(e, i)}
                        hinted={hint?.id === t.id}
                        compact={size === 5}
                      />
                    ))}
                  </div>
                )}
              </div>
            </LayoutGroup>
          )}
        </div>

        {error && (
          <p className="text-center text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <div className="sr-only" aria-live="polite" role="status">
          {announce}
        </div>

        {!over && puzzle && (
          <div className="space-y-4">
            <MistakeDots left={mistakesLeft} max={connMaxMistakes(size)} />
            <div className="flex flex-wrap items-center justify-center gap-2.5">
              <Button variant="outline" onClick={shuffle} disabled={busy} className="rounded-full sm:min-w-28">
                <Shuffle className="h-4 w-4" aria-hidden /> Shuffle
              </Button>
              <Button variant="outline" onClick={() => setSelected([])} disabled={busy || selected.length === 0} className="rounded-full sm:min-w-28">
                Deselect all
              </Button>
              <Button onClick={() => void submit()} disabled={busy || selected.length !== size} className="rounded-full sm:min-w-28" data-testid="conn-submit">
                Submit
              </Button>
              {mode === "daily" && (
                <Button
                  variant="outline"
                  onClick={() => void takeHint()}
                  disabled={busy || hintBusy || usedHint}
                  className="rounded-full sm:min-w-28"
                  title="Reveals one Pokémon from the easiest group left. Once per puzzle, and you rank below everyone who played without it."
                  data-testid="conn-hint"
                >
                  <Lightbulb className="h-4 w-4" aria-hidden /> {usedHint ? "Hint used" : "Hint"}
                </Button>
              )}
            </div>
            {challenge && daily?.kind === "daily" && challenge.date === daily.date && <ChallengeBanner challenge={challenge} />}
            <KeyHints />
            {prefs?.showTimer && (
              <p className="flex items-center justify-center gap-1.5 font-mono text-sm tabular-nums text-muted-foreground" role="timer" aria-label="Time">
                <Timer className="h-4 w-4" aria-hidden /> {clock(ms / 1000)}
              </p>
            )}
          </div>
        )}

        {/* The finished game: result, history, sharing, what's next, and why. */}
        {revealDone && state?.reveal && (
          <motion.section aria-label="Result" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-6 pt-2" data-testid="conn-result">
            <Card className={cn("mx-auto max-w-md", won ? "border-success/50" : "border-destructive/40")}>
              <CardContent className="space-y-5 p-6 text-center">
                <div>
                  {won && state.mistakes === 0 ? (
                    <PerfectBanner />
                  ) : (
                    <div className="font-display text-3xl font-bold uppercase tracking-tight">{won ? (state.mistakes === connMaxMistakes(size) - 1 ? "Phew!" : "Solved!") : "Next time!"}</div>
                  )}
                  <p className="text-sm text-muted-foreground">
                    {won ? (state.mistakes === 0 ? `All ${SIZE_WORDS[size]} groups, not a single mistake.` : `You found all ${SIZE_WORDS[size]} groups.`) : `You found ${state.found.length} of ${size} groups.`}
                  </p>
                </div>
                {mode === "daily" && stats && <StreakFlame streak={streak} best={Math.max(stats.bestPlayStreak, streak)} />}
                <NewBadges badges={fresh} />
                <GuessHistory rows={historyRows} symbols={symbols} />
                <dl className="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <dt className="text-[11px] text-muted-foreground">Mistakes</dt>
                    <dd className="font-display text-2xl font-bold tabular-nums">
                      {state.mistakes}/{connMaxMistakes(size)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted-foreground">Time</dt>
                    <dd className="font-display text-2xl font-bold tabular-nums">{ms >= 1000 ? clock(ms / 1000) : "–"}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted-foreground">Groups</dt>
                    <dd className="font-display text-2xl font-bold tabular-nums">
                      {state.found.length}/{size}
                    </dd>
                  </div>
                </dl>
                {usedHint && mode === "daily" && (
                  <p className="rounded-md border border-warning/40 bg-warning/[0.08] px-3 py-2 text-sm" data-testid="conn-hinted">
                    <Lightbulb className="mr-1 inline h-4 w-4" aria-hidden /> You used the hint. Hinted games rank below every hint-free game on the leaderboard.
                  </p>
                )}
                {mode === "daily" && <GroupStats stats={groupStats} />}
                {mode === "daily" && challenge && daily && challenge.date === daily.date && (
                  <ChallengeResult challenge={challenge} mine={mine ?? (won ? { mistakes: state.mistakes, ms, hinted: usedHint } : null)} />
                )}
                {mode === "daily" && summary && summary.players > 0 && (
                  <p className="rounded-md border bg-shade/30 px-3 py-2 text-sm" data-testid="conn-community">
                    <b>{Math.round((100 * summary.solved) / summary.players)}%</b> of {summary.players.toLocaleString("en-US")} trainer{summary.players === 1 ? "" : "s"} solved today&apos;s ·{" "}
                    <b>{Math.round((100 * summary.perfect) / summary.players)}%</b> got it perfect
                  </p>
                )}
                {mode === "practice" ? (
                  <div className="space-y-2">
                    <Button size="lg" className="h-14 w-full text-base" onClick={() => newPractice()} data-testid="conn-next">
                      <RefreshCw className="h-5 w-5" aria-hidden /> Next puzzle ▶
                    </Button>
                    <ShareButton getText={shareTextNow} label="Share" kind="connections" variant="outline" className="w-full" />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <ShareButton getText={shareTextNow} label="Share" kind="connections" className="w-full" />
                    <div className="grid gap-2 sm:grid-cols-2">
                      <Button size="lg" variant="success" onClick={() => newPractice()} data-testid="conn-play-unlimited">
                        <InfinityIcon className="h-5 w-5" aria-hidden /> Play unlimited
                      </Button>
                      <a href="#duel" className={cn(buttonVariants({ size: "lg", variant: "outline" }))} data-testid="conn-duel-link">
                        <Swords className="h-5 w-5" aria-hidden /> Duel a friend
                      </a>
                    </div>
                  </div>
                )}
                {mode !== "daily" && today && !todayRecord?.over && (
                  <Button className="w-full" onClick={backToDaily}>
                    Play today&apos;s PokéConnections
                  </Button>
                )}
                {mode === "daily" && daily && <DailyLeaderboard date={daily.date} standing={board} rows={boardRows} you={rankName} onName={rankAs} />}
                {daily && <FeedbackPanel date={daily.date} guesses={guesses} groups={state.reveal} />}
                {mode === "daily" && daily && <ComeBackTomorrow next={connNumber(daily.date) + 1} />}
                {mode !== "daily" && <p className="text-xs text-muted-foreground">{mode === "archive" ? "Archive" : "Practice"} games don&apos;t count toward streaks or stats.</p>}
              </CardContent>
            </Card>
            <WhyPanel groups={state.reveal} symbols={symbols} />
          </motion.section>
        )}
      </div>

      {sheet === "howto" && <ConnHowToSheet onClose={closeSheet} />}
      {sheet === "stats" && stats && <ConnStatsSheet stats={stats} todayMistakes={todayRecord?.over ? (todayRecord.solved ? todayRecord.mistakes : CONN_MAX_MISTAKES) : null} onClose={closeSheet} />}
      {sheet === "archive" && today && progress && (
        <ConnArchiveSheet
          today={today}
          daily={connBlock(progress).results}
          archive={connArchive()}
          onPlay={(d) => {
            setSheet(null);
            void load({ kind: "archive", date: d });
          }}
          onClose={closeSheet}
        />
      )}
    </MotionConfig>
  );
}

/** A setting that's on or off: its name and line, and a switch (Pokédle's). */
function SettingToggle({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: () => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4">
      <span className="min-w-0">
        <span className="block text-sm font-semibold">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={onChange}
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          checked ? "border-primary bg-primary" : "border-foreground/20 bg-shade/30"
        )}
      >
        <span className={cn("absolute top-0.5 h-3.5 w-3.5 rounded-full bg-foreground transition-[left]", checked ? "left-[1.1rem] bg-primary-foreground" : "left-0.5")} />
      </button>
    </label>
  );
}
