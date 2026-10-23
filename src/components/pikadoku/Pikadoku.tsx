"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MotionConfig } from "framer-motion";
import { Archive, BarChart3, ChevronDown, CircleHelp, Dices, Flag, Loader2, Settings, Swords, X } from "lucide-react";
import { getProgress, pdkBlock, recordPdkGame, savePdk, savePdkArchive, setTrainerName, useProgress, type BadgeDef } from "@/lib/progress";
import { useToday } from "@/lib/use-today";
import { dlePlayerId } from "@/lib/dle-player";
import { play } from "@/lib/sound";
import { pikadokuShareText, shareUrl, type PikadokuShareResult } from "@/lib/share";
import { rarityGrid } from "@/lib/pikadoku/share";
import { archiveKey, loadPdkArchive, savePdkArchiveLocal } from "@/lib/pikadoku/archive";
import { weekNumber, weekStart } from "@/lib/pikadoku/weeks";
import { challengeLabel, decodeChallenge, encodeChallenge, judgeChallenge } from "@/lib/pikadoku/challenge";
import { composeShare } from "@/lib/share/text";
import { connNumber } from "@/lib/connections/types";
import { EMPTY_PDK_PLAY } from "@/lib/pikadoku/play";
import {
  DEFAULT_PDK_SETTINGS,
  PDK_DIFFICULTIES,
  PDK_FAMILIES,
  PDK_FAMILY_LABELS,
  PDK_PP,
  type PdkBoardResponse,
  type PdkDifficulty,
  type PdkFamily,
  type PdkGridView,
  type PdkGuess,
  type PdkResultResponse,
  type PdkSettings,
} from "@/lib/pikadoku/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Popover } from "@/components/ui/popover";
import { ShareButton } from "@/components/share/ShareButton";
import { NewBadges, StreakFlame, useCelebration } from "@/components/connections/results";
import { PdkBoard, PdkPicker, SettingToggle, iconButton, useDex, type BoardCell, type DexName } from "./parts";
import { PdkArchiveSheet, PdkHowToSheet, PdkStatsSheet } from "./sheets";
import { cn } from "@/lib/utils";

type Mode = "daily" | "weekly" | "practice" | "archive";
type Target = { date: string; difficulty: PdkDifficulty; archive?: true } | { week: string; difficulty: "normal" } | { practice: string; difficulty: "normal"; settings: PdkSettings };
const PREFS_KEY = "pokeiq:pikadoku:prefs";
const SEEN_KEY = "pokeiq:pikadoku:howto-seen";
interface Prefs {
  difficulty: PdkDifficulty;
  settings: PdkSettings;
}
function loadPrefs(): Prefs {
  const base: Prefs = { difficulty: "normal", settings: DEFAULT_PDK_SETTINGS };
  try {
    const raw = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Prefs> | null;
    if (raw?.difficulty && PDK_DIFFICULTIES.includes(raw.difficulty)) base.difficulty = raw.difficulty;
    if (raw?.settings) base.settings = { ...DEFAULT_PDK_SETTINGS, ...raw.settings, families: raw.settings.families?.filter((f) => PDK_FAMILIES.includes(f)) ?? PDK_FAMILIES };
  } catch {
    // Private mode or bad data: the defaults.
  }
  return base;
}
function savePrefs(p: Prefs) {
  try {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    // Lasts this visit only.
  }
}

const newSeed = () => Math.random().toString(36).slice(2, 10).padEnd(8, "0");
const DIFF_LABEL: Record<PdkDifficulty, string> = { easy: "Easy", normal: "Normal", expert: "Expert" };
const DIFF_HINT: Record<PdkDifficulty, string> = { easy: "Broad categories, plenty of answers", normal: "The main grid: the leaderboard and score", expert: "Harder categories, as few as one answer a cell" };
const clockText = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;

interface Locked {
  id: number;
  pct: number | null;
}

export function Pikadoku() {
  const today = useToday();
  const progress = useProgress();
  const dex = useDex();
  const names = useMemo(() => new Map(dex.map((p) => [p.id, p.name])), [dex]);
  const [mode, setMode] = useState<Mode>("daily");
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [seed, setSeed] = useState<string | null>(null);
  /** Settings that came with a challenge link (they win over this device's until the next grid), and the result to beat. */
  const [linkSettings, setLinkSettings] = useState<PdkSettings | null>(null);
  const [challenge, setChallenge] = useState<{ solved: number; guesses: number } | null>(null);
  const [grid, setGrid] = useState<PdkGridView | null>(null);
  const [pp, setPp] = useState<number>(PDK_PP);
  const [start, setStart] = useState<string | undefined>();
  const [master, setMaster] = useState<string | null>(null);
  /** The live weekly grid's theme, from the server. */
  const [weeklyInfo, setWeeklyInfo] = useState<{ week: number; theme: string; blurb: string; monday: string; sunday: string } | null>(null);
  const [guesses, setGuesses] = useState<PdkGuess[]>([]);
  const [locked, setLocked] = useState<Record<number, Locked>>({});
  const [missCell, setMissCell] = useState<number | null>(null);
  const [picking, setPicking] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PdkResultResponse | null>(null);
  const [badges, setBadges] = useState<BadgeDef[]>([]);
  const [sheet, setSheet] = useState<"howto" | "stats" | "archive" | null>(null);
  /** The past daily being played from the archive. */
  const [archive, setArchive] = useState<{ date: string; difficulty: PdkDifficulty } | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showRank, setShowRank] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number>(0);
  const finishing = useRef(false);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => setPrefs(loadPrefs()), []);
  // First visit: the how-to opens once.
  useEffect(() => {
    try {
      if (!window.localStorage.getItem(SEEN_KEY)) setSheet("howto");
    } catch {
      // No storage: skip the first-visit sheet.
    }
  }, []);
  const closeSheet = () => {
    try {
      window.localStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Shown again next visit.
    }
    setSheet(null);
  };
  // A challenge link (/pikadoku?c=...) opens that exact Unlimited grid.
  useEffect(() => {
    const c = decodeChallenge(new URLSearchParams(window.location.search).get("c"));
    if (!c) return;
    setLinkSettings(c.settings);
    setChallenge(c.result);
    setSeed(c.seed);
    setMode("practice");
    window.history.replaceState(null, "", window.location.pathname);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);
  const patchPrefs = (patch: Partial<Prefs>) => {
    if (patch.settings) setLinkSettings(null);
    setPrefs((p) => {
      const next = { ...(p ?? loadPrefs()), ...patch };
      savePrefs(next);
      return next;
    });
  };

  const difficulty = prefs?.difficulty ?? "normal";
  const settings = linkSettings ?? prefs?.settings ?? DEFAULT_PDK_SETTINGS;
  const week = today ? weekStart(today) : null;
  /** Archive and weekly games are kept on this device apart from the daily results (and never move the streak). */
  const storeKey = mode === "weekly" ? (week ? `weekly:${week}` : null) : mode === "archive" ? (archive ? archiveKey(archive.date, archive.difficulty) : null) : today ? (difficulty === "normal" ? today : `${today}:${difficulty}`) : null;

  /** The request fields that name this grid. */
  const target = useMemo<Target | null>(
    () => (mode === "weekly" ? (week ? { week, difficulty: "normal" } : null) : mode === "archive" ? (archive ? { date: archive.date, difficulty: archive.difficulty, archive: true } : null) : mode === "daily" ? (today ? { date: today, difficulty } : null) : seed ? { practice: seed, difficulty: "normal", settings } : null),
    [mode, today, difficulty, seed, settings, archive, week]
  );
  const targetKey = target ? JSON.stringify(target) : null;

  const showToast = useCallback((text: string) => {
    window.clearTimeout(toastTimer.current);
    setToast(text);
    toastTimer.current = window.setTimeout(() => setToast(null), 2200);
  }, []);

  const post = useCallback(
    async (path: string, body: Record<string, unknown>) => {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...target, ...body }) });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(typeof data.error === "string" ? data.error : "Something went wrong.");
      return data;
    },
    [target]
  );

  const finish = useCallback(
    async (list: PdkGuess[], giveUp: boolean, name?: string) => {
      if (!target || finishing.current) return;
      finishing.current = true;
      try {
        const rankName = name || getProgress().name || undefined;
        const out = (await post("/api/pikadoku/result", { guesses: list, giveUp, player: dlePlayerId(), start, ...(rankName && { name: rankName }) })) as unknown as PdkResultResponse;
        setResult(out);
        setLocked(Object.fromEntries(Object.entries(out.locked).map(([c, id]) => [Number(c), { id, pct: out.pcts?.[Number(c)] ?? null }])));
        if (mode === "daily" && storeKey) {
          const fresh = savePdk(storeKey, { guesses: list, won: out.won, over: true, solved: out.solved, score: out.score, ms: Date.now() - startedAt.current });
          if (fresh.length) setBadges(fresh);
        } else if ((mode === "archive" || mode === "weekly") && storeKey) {
          // Archive and weekly games count toward the tallies, never the daily streak or results.
          const again = !!loadPdkArchive()[storeKey]?.over;
          const rec = { guesses: list, won: out.won, over: true, solved: out.solved, score: out.score };
          savePdkArchiveLocal(storeKey, rec);
          const fresh = again ? [] : savePdkArchive(rec);
          if (fresh.length) setBadges(fresh);
        } else {
          const fresh = recordPdkGame(out.won);
          if (fresh.length) setBadges(fresh);
        }
        play(out.won ? "fanfare" : "wrong");
      } catch (err) {
        setError((err as Error).message);
        finishing.current = false;
      }
    },
    [target, post, start, mode, storeKey]
  );

  // Load the grid (and, for a daily, where this device left off).
  useEffect(() => {
    if (!target || !targetKey) return;
    let live = true;
    setGrid(null);
    setResult(null);
    setLocked({});
    setGuesses([]);
    setBadges([]);
    setError(null);
    setShowRank(false);
    setElapsed(0);
    finishing.current = false;
    startedAt.current = Date.now();
    (async () => {
      try {
        const qs = new URLSearchParams();
        if ("practice" in target) {
          const s = target.settings;
          qs.set("practice", target.practice);
          qs.set("pp", s.unlimitedPP ? "1" : "0");
          qs.set("guard", s.softLockGuard ? "1" : "0");
          qs.set("single", s.allowSingle ? "1" : "0");
          qs.set("fam", s.families.join(","));
        } else if ("week" in target) {
          qs.set("week", target.week);
        } else {
          qs.set("date", target.date);
          qs.set("difficulty", target.difficulty);
        }
        const res = await fetch(`/api/pikadoku?${qs}`, { cache: "no-store" });
        const data = (await res.json()) as { grid?: PdkGridView; pp?: number; start?: string; error?: string; master?: { by: string }; weekly?: { week: number; theme: string; blurb: string; monday: string; sunday: string } };
        if (!live) return;
        if (!res.ok || !data.grid) return setError(data.error ?? "Couldn't load the grid.");
        setGrid(data.grid);
        setPp(data.pp ?? 0);
        setStart(data.start);
        setMaster(data.master?.by ?? null);
        setWeeklyInfo(data.weekly ?? null);
        const saved = mode === "daily" && storeKey ? pdkBlock(getProgress()).results[storeKey] : (mode === "archive" || mode === "weekly") && storeKey ? loadPdkArchive()[storeKey] : undefined;
        if (saved?.guesses.length) {
          setGuesses(saved.guesses);
          const r = await fetch("/api/pikadoku", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...target, guesses: saved.guesses }) });
          const rep = (await r.json()) as { locked?: Record<number, number>; over?: boolean };
          if (!live || !r.ok || !rep.locked) return;
          setLocked(Object.fromEntries(Object.entries(rep.locked).map(([c, id]) => [Number(c), { id, pct: null }])));
          if (rep.over || saved.over) void finishRef.current(saved.guesses, false);
        }
      } catch {
        if (live) setError("Couldn't load the grid. Check your connection.");
      }
    })();
    return () => {
      live = false;
    };
    // The grid reloads when the target changes, nothing else.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);
  const finishRef = useRef(finish);
  useEffect(() => {
    finishRef.current = finish;
  }, [finish]);

  // Unlimited's timer.
  useEffect(() => {
    if (mode !== "practice" || !settings.timer || result || !grid) return;
    const id = window.setInterval(() => setElapsed(Date.now() - startedAt.current), 500);
    return () => window.clearInterval(id);
  }, [mode, settings.timer, result, grid]);

  const used = useMemo(() => new Set(Object.values(locked).map((l) => l.id)), [locked]);
  const lockedCount = Object.keys(locked).length;
  const spent = guesses.length;
  const left = pp > 0 ? Math.max(0, pp - spent) : null;
  const over = !!result;
  /** PokeDoku's UNIQ: 100 per unfilled cell, a locked pick counts its rarity (lower is better). Without rarity data, the cell count. */
  const lockedList = Object.values(locked);
  const rarityKnown = lockedList.every((l) => l.pct !== null);
  const uniq = rarityKnown ? lockedList.reduce((a, l) => a + (l.pct ?? 100), 0) + (9 - lockedList.length) * 100 : null;
  const tapRank = () => {
    if (result) setShowRank(true);
    document.getElementById("pdk-board")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  async function pick(p: DexName) {
    if (picking === null || busy || !target) return;
    const cell = picking;
    setBusy(true);
    setError(null);
    try {
      const out = (await post("/api/pikadoku", { guesses, next: { cell, id: p.id } })) as { valid: boolean; softlock?: boolean; pct: number | null };
      setPicking(null);
      if (out.softlock) {
        showToast("That would leave the grid unsolvable. Try another Pokémon.");
        return;
      }
      const list = [...guesses, { cell, id: p.id }];
      setGuesses(list);
      const nextLocked = out.valid ? { ...locked, [cell]: { id: p.id, pct: out.pct } } : locked;
      if (out.valid) {
        setLocked(nextLocked);
        play("correct");
      } else {
        setMissCell(cell);
        window.setTimeout(() => setMissCell(null), 700);
        showToast(`${p.name} doesn't fit there.`);
        play("wrong");
      }
      const done = Object.keys(nextLocked).length === 9 || (pp > 0 && list.length >= pp);
      if (mode === "daily" && storeKey) savePdk(storeKey, { guesses: list, won: false, over: false, solved: Object.keys(nextLocked).length, score: null });
      else if ((mode === "archive" || mode === "weekly") && storeKey) savePdkArchiveLocal(storeKey, { guesses: list, won: false, over: false, solved: Object.keys(nextLocked).length, score: null });
      if (done) await finish(list, false);
    } catch (err) {
      setError((err as Error).message);
      setPicking(null);
    } finally {
      setBusy(false);
    }
  }

  async function giveUp() {
    if (!window.confirm("Give up and see the answers?")) return;
    setBusy(true);
    await finish(guesses, true);
    setBusy(false);
  }

  function newPractice() {
    setLinkSettings(null);
    setChallenge(null);
    setMode("practice");
    setSeed(newSeed());
  }

  useCelebration(result ? (result.won ? "perfect" : null) : null);

  // The leaderboard (today's Normal grid), with a friends tab.
  const [boardScope, setBoardScope] = useState<"all" | "friends">("all");
  const [board, setBoard] = useState<PdkBoardResponse | null>(null);
  useEffect(() => {
    if (!today || (mode !== "daily" && mode !== "weekly")) return;
    let live = true;
    const which = mode === "weekly" ? `week=${weekStart(today)}` : `date=${today}&difficulty=${difficulty}`;
    fetch(`/api/pikadoku/leaderboard?${which}${boardScope === "friends" ? "&scope=friends" : ""}`)
      .then((r) => (r.ok ? (r.json() as Promise<PdkBoardResponse>) : null))
      .then((b) => live && setBoard(b))
      .catch(() => live && setBoard(null));
    return () => {
      live = false;
    };
  }, [today, mode, difficulty, boardScope, result]);

  const [nameDraft, setNameDraft] = useState("");
  const cells: BoardCell[] = Array.from({ length: 9 }, (_, i) => ({ id: locked[i]?.id ?? null, pct: locked[i]?.pct ?? null, miss: missCell === i }));
  const block = pdkBlock(progress ?? getProgress());
  /** The rarity-coloured result: colours only, never a Pokémon. */
  const shareResult = (): PikadokuShareResult => ({
    game: "pikadoku",
    ...(mode === "weekly" && week ? { weekly: weekNumber(week) } : mode === "daily" && today ? { daily: connNumber(today) } : mode === "archive" && archive ? { daily: connNumber(archive.date), archive: true as const } : {}),
    difficulty: mode === "daily" ? difficulty : mode === "archive" && archive ? archive.difficulty : "normal",
    grid: rarityGrid((i) => !!locked[i], result?.pcts ?? Array.from({ length: 9 }, (_, i) => locked[i]?.pct ?? null)),
    ...(result?.score != null && { score: result.score }),
    ...(mode === "daily" && block.streak > 1 && { streak: block.streak }),
  });
  const shareText = () => {
    const r = shareResult();
    return pikadokuShareText(r, shareUrl(r));
  };
  /** "Share this grid": a link that deals the same Unlimited grid, with this game's result to beat once it's over. */
  const challengeText = () => {
    if (!seed) return "";
    const mine = result ? { solved: result.solved, guesses: guesses.length } : null;
    const url = `${window.location.origin}/pikadoku?c=${encodeChallenge({ seed, settings, result: mine })}`;
    return composeShare({ title: "Pikadoku (Unlimited) challenge", score: mine ? challengeLabel(mine) : undefined, lines: [mine ? "Can you beat me on the same grid?" : "Play the same grid with me:"], url });
  };
  const verdict = result && challenge && mode === "practice" ? judgeChallenge({ solved: result.solved, guesses: guesses.length }, challenge) : null;

  const rankName = progress?.name ?? "";
  const heading = mode === "weekly" && week ? `Weekly #${weekNumber(week)}${weeklyInfo ? ` · ${weeklyInfo.theme}` : ""}` : mode === "archive" && archive ? `Archive #${connNumber(archive.date)} · ${DIFF_LABEL[archive.difficulty]}` : mode === "daily" && today ? `Daily #${connNumber(today)} · ${DIFF_LABEL[difficulty]}` : "Unlimited";

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto max-w-3xl space-y-5">
        <div className="space-y-4 text-center">
          <div className="space-y-2">
            <p className="hud-label text-screen" data-testid="pdk-title">
              {heading}
            </p>
            <h1 className="font-display text-4xl font-bold uppercase tracking-tight">Pikadoku</h1>
            <p className="text-sm text-muted-foreground">Pokémon Sudoku: one Pokémon for each cell, matching its row and its column.</p>
          </div>
          <div className="flex justify-center">
            <div className="flex flex-wrap justify-center rounded-md border border-foreground/15 bg-card p-0.5" role="radiogroup" aria-label="Pikadoku mode">
              {(
                [
                  { id: "daily", label: "Daily Puzzle", title: "Today's grid, the same for everyone", on: () => setMode("daily") },
                  { id: "practice", label: "Unlimited", title: "A fresh grid every time", on: () => (seed ? setMode("practice") : newPractice()) },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={m.id === "daily" ? mode !== "practice" : mode === m.id}
                  title={m.title}
                  onClick={m.on}
                  data-testid={`pdk-mode-${m.id}`}
                  className={cn(
                    "min-w-[5.5rem] rounded px-3 py-1.5 font-display text-sm font-semibold uppercase tracking-wider transition-colors sm:min-w-24 sm:px-4",
                    (m.id === "daily" ? mode !== "practice" : mode === m.id) ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {m.label}
                </button>
              ))}
              <a
                href="#pdk-duel"
                title="Tic Tac Toe: take turns claiming cells against a friend or a stranger"
                className="flex min-w-[5.5rem] items-center justify-center gap-1.5 rounded px-3 py-1.5 font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground sm:min-w-24 sm:px-4"
              >
                <Swords className="h-3.5 w-3.5" aria-hidden /> Tic Tac Toe
              </a>
            </div>
          </div>
          <div className="flex items-center justify-center gap-1" role="toolbar" aria-label="Pikadoku options">
            <button type="button" className={iconButton} onClick={() => setSheet("howto")} aria-label="How to play" title="How to play">
              <CircleHelp className="h-5 w-5" />
            </button>
            <button type="button" className={iconButton} onClick={() => setSheet("stats")} aria-label="Statistics" title="Statistics">
              <BarChart3 className="h-5 w-5" />
            </button>
            <button type="button" className={cn(iconButton, mode === "practice" && "text-screen")} onClick={newPractice} aria-pressed={mode === "practice"} aria-label="New Unlimited grid" title="New Unlimited grid">
              <Dices className="h-5 w-5" />
            </button>
            <div className="relative flex items-center">
              <button type="button" className={cn(iconButton, settingsOpen && "bg-screen/10 text-foreground")} onClick={() => setSettingsOpen((o) => !o)} aria-expanded={settingsOpen} aria-haspopup="dialog" aria-label="Settings" title="Settings">
                <Settings className="h-5 w-5" />
              </button>
              <Popover open={settingsOpen} onClose={() => setSettingsOpen(false)} label="Pikadoku settings" className="w-[24rem] max-w-[calc(100vw-2rem)] space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="hud-label pt-1">Unlimited settings</p>
                  <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close settings" className="rounded-md p-1 text-muted-foreground hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <SettingToggle label="Unlimited PP" description="No cap on guesses: keep going until the grid is full." checked={settings.unlimitedPP} onChange={() => patchPrefs({ settings: { ...settings, unlimitedPP: !settings.unlimitedPP } })} />
                <SettingToggle label="Soft-lock guard" description="Refuses a pick that would leave the other cells impossible to finish." checked={settings.softLockGuard} onChange={() => patchPrefs({ settings: { ...settings, softLockGuard: !settings.softLockGuard } })} />
                <SettingToggle label="Allow single-answer cells" description="Cells may have only one valid Pokémon." checked={settings.allowSingle} onChange={() => patchPrefs({ settings: { ...settings, allowSingle: !settings.allowSingle } })} />
                <SettingToggle label="Timer" description="A running clock above the grid." checked={settings.timer} onChange={() => patchPrefs({ settings: { ...settings, timer: !settings.timer } })} />
                <div>
                  <p className="text-sm font-semibold">Categories</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Category families">
                    {PDK_FAMILIES.map((f: PdkFamily) => {
                      const on = settings.families.includes(f);
                      return (
                        <button
                          key={f}
                          type="button"
                          aria-pressed={on}
                          data-testid={`pdk-family-${f}`}
                          onClick={() => {
                            const families = on ? settings.families.filter((x) => x !== f) : [...settings.families, f];
                            if (families.length) patchPrefs({ settings: { ...settings, families } });
                          }}
                          className={cn("rounded-full border px-2.5 py-1 text-xs font-semibold", on ? "border-primary bg-primary/15" : "border-foreground/15 text-muted-foreground")}
                        >
                          {PDK_FAMILY_LABELS[f]}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Changes apply to the next Unlimited grid.</p>
                <Button type="button" size="sm" onClick={() => (setSettingsOpen(false), newPractice())}>
                  New Unlimited grid
                </Button>
              </Popover>
            </div>
          </div>
        </div>

        {mode === "weekly" && weeklyInfo && (
          <p className="mx-auto max-w-md rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-center text-sm" data-testid="pdk-weekly">
            <b>{weeklyInfo.theme}</b>: {weeklyInfo.blurb} Live until Sunday {weeklyInfo.sunday}. Doesn&apos;t count toward your daily streak.
          </p>
        )}
        {mode === "archive" && archive && (
          <p className="mx-auto max-w-md rounded-md border border-screen/40 bg-screen/[0.06] px-3 py-2 text-center text-sm" data-testid="pdk-archive-note">
            Archive: #{connNumber(archive.date)} ({archive.date}), {DIFF_LABEL[archive.difficulty]}. For fun: it never counts toward the daily board or your streak.
          </p>
        )}
        {mode === "practice" && challenge && (
          <p className="mx-auto max-w-md rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-center text-sm font-semibold" data-testid="pdk-challenge">
            Challenge: beat {challengeLabel(challenge)}
          </p>
        )}
        {mode === "practice" && (
          <p className="mx-auto max-w-md rounded-md border border-screen/40 bg-screen/[0.06] px-3 py-2 text-center text-sm" data-testid="pdk-unlimited">
            Unlimited: a fresh grid every time, never counted toward your streak.{settings.timer && <b className="ml-2 tabular-nums">{clockText(elapsed)}</b>}
          </p>
        )}

        {mode === "daily" && master && (
          <p className="mx-auto max-w-md rounded-md border border-warning/50 bg-warning/10 px-3 py-2 text-center text-sm font-semibold" data-testid="pdk-master">
            Master Puzzle by {master}
          </p>
        )}

        <div className="mx-auto grid max-w-xl grid-cols-4 items-center gap-2 rounded-md border border-foreground/15 bg-card px-2 py-2 text-center" aria-live="polite" data-testid="pdk-stats-bar">
          <button type="button" onClick={tapRank} disabled={mode !== "daily" && mode !== "weekly"} className="rounded px-1 hover:bg-primary/5 disabled:pointer-events-none" data-testid="pdk-uniq" aria-label="Uniqueness score, tap for rank">
            <span className="hud-label block">UNIQ</span>
            <b className="block font-display text-xl tabular-nums leading-tight">{uniq ?? `${lockedCount}/9`}</b>
            {(mode === "daily" || mode === "weekly") && <span className="block text-[10px] text-muted-foreground">tap for rank</span>}
          </button>
          <span data-testid="pdk-filled">
            <span className="hud-label block">PTS</span>
            <b className="block font-display text-xl tabular-nums leading-tight">{lockedCount}</b>
          </span>
          <span data-testid="pdk-pp">
            <span className="hud-label block">PP</span>
            <b className="block font-display text-xl tabular-nums leading-tight">
              {left === null ? "∞" : left}
              {left !== null && <span className="text-sm font-semibold text-muted-foreground">/{pp}</span>}
            </b>
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => void giveUp()} disabled={busy || over || !grid} data-testid="pdk-giveup">
            <Flag className="h-4 w-4" aria-hidden /> Give up
          </Button>
        </div>

        {error && !grid && (
          <p className="text-center text-sm text-destructive" role="alert">
            {error}
          </p>
        )}
        <PdkBoard grid={grid} cells={cells} names={names} onCell={(c) => setPicking(c)} disabled={over || busy} />
        {toast && (
          <p className="text-center text-sm font-semibold" role="status" data-testid="pdk-toast">
            {toast}
          </p>
        )}
        {error && grid && (
          <p className="text-center text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {!over && grid && mode === "practice" && (
          <div className="flex flex-wrap justify-center gap-2">
            <ShareButton getText={challengeText} kind="pikadoku-challenge" label="Share this grid" variant="outline" size="sm" />
          </div>
        )}

        <div className="space-y-2 text-center">
          <button type="button" onClick={() => setMoreOpen((o) => !o)} aria-expanded={moreOpen} data-testid="pdk-more" className="inline-flex items-center gap-1 rounded-md px-3 py-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
            More <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", moreOpen && "rotate-180")} aria-hidden />
          </button>
          {moreOpen && (
            <div className="flex flex-wrap items-center justify-center gap-3" data-testid="pdk-more-panel">
              <div className="flex gap-1" role="radiogroup" aria-label="Daily difficulty">
                {PDK_DIFFICULTIES.map((d) => (
                  <button
                    key={d}
                    type="button"
                    role="radio"
                    aria-checked={mode === "daily" && difficulty === d}
                    title={DIFF_HINT[d]}
                    data-testid={`pdk-diff-${d}`}
                    onClick={() => (patchPrefs({ difficulty: d }), setMode("daily"))}
                    className={cn("rounded border px-3 py-1 text-xs font-semibold uppercase tracking-wider", mode === "daily" && difficulty === d ? "border-primary bg-primary/15 text-foreground" : "border-foreground/15 text-muted-foreground hover:text-foreground")}
                  >
                    {DIFF_LABEL[d]}
                  </button>
                ))}
              </div>
              <button type="button" data-testid="pdk-mode-weekly" title="A themed grid that is live Monday to Sunday, with its own board" onClick={() => setMode("weekly")} className={cn("rounded border px-3 py-1 text-xs font-semibold uppercase tracking-wider", mode === "weekly" ? "border-primary bg-primary/15 text-foreground" : "border-foreground/15 text-muted-foreground hover:text-foreground")}>
                Weekly
              </button>
              <button type="button" onClick={() => setSheet("archive")} disabled={!today} data-testid="pdk-archive-btn" className={cn("inline-flex items-center gap-1 rounded border px-3 py-1 text-xs font-semibold uppercase tracking-wider", mode === "archive" ? "border-primary bg-primary/15 text-foreground" : "border-foreground/15 text-muted-foreground hover:text-foreground disabled:opacity-40")}>
                <Archive className="h-3.5 w-3.5" aria-hidden /> Archive
              </button>
            </div>
          )}
        </div>

        {result && (
          <Card data-testid="pdk-result">
            <CardContent className="space-y-4 p-6 text-center">
              <p className="hud-label text-screen">{result.won ? "Grid complete" : `${result.solved} of 9 cells`}</p>
              <p className="font-display text-3xl font-bold" data-testid="pdk-score">
                {result.score === null ? "Score hidden" : `Score ${result.score}`}
              </p>
              <p className="text-xs text-muted-foreground">Uniqueness score: the sum of the share of players who picked your answers. Lower is better.{result.score === null && " Rarity is off for now."}</p>
              {(mode === "daily" || mode === "weekly") && result.counted && (
                <div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowRank((s) => !s)} data-testid="pdk-rank-btn">
                    Tap for rank
                  </Button>
                  {showRank && (
                    <p className="mt-2 text-sm" data-testid="pdk-rank">
                      {result.rank ? `You're #${result.rank.position} of ${result.rank.total} on ${mode === "weekly" ? "this week's" : `today's ${DIFF_LABEL[difficulty]}`} board.` : "The board is off right now."}
                    </p>
                  )}
                </div>
              )}
              {mode === "daily" && block.streak > 0 && <StreakFlame streak={block.streak} best={block.best} />}
              <NewBadges badges={badges} />
              {(mode === "daily" || mode === "weekly") && result.counted && !rankName && (
                <form
                  className="mx-auto flex max-w-xs gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const n = nameDraft.trim();
                    if (!n) return;
                    setTrainerName(n);
                    finishing.current = false;
                    void finish(guesses, false, n);
                  }}
                >
                  <input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} maxLength={24} placeholder="Trainer name to rank" aria-label="Trainer name to rank" className="min-w-0 flex-1 rounded-md border border-foreground/20 bg-card px-3 py-1.5 text-sm" />
                  <Button type="submit" size="sm">
                    Rank me
                  </Button>
                </form>
              )}
              {verdict && challenge && (
                <p className="text-sm font-semibold" data-testid="pdk-challenge-result">
                  {verdict === "beat" ? `You beat ${challengeLabel(challenge)}!` : verdict === "tied" ? `You tied ${challengeLabel(challenge)}.` : `Not quite: you needed to beat ${challengeLabel(challenge)}.`}
                </p>
              )}
              <div className="flex flex-wrap justify-center gap-2">
                <ShareButton getText={shareText} kind="pikadoku" label="Share result" />
                {mode === "practice" && <ShareButton getText={challengeText} kind="pikadoku-challenge" label="Share this grid" variant="outline" data-testid="pdk-share-grid" />}
                {mode === "practice" && (
                  <Button type="button" onClick={newPractice}>
                    <Dices className="h-4 w-4" aria-hidden /> New grid
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {result && (
          <section className="space-y-3" aria-label="Answers" data-testid="pdk-reveal">
            <h2 className="font-display text-xl font-bold uppercase">All the answers</h2>
            {result.reveal.misses.length > 0 && (
              <ul className="space-y-1 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm" data-testid="pdk-misses">
                {result.reveal.misses.map((m, i) => (
                  <li key={i}>{m.reason}</li>
                ))}
              </ul>
            )}
            {result.reveal.cells.map((c, i) => (
              <details key={i} className="rounded-md border border-foreground/10 p-3" data-testid={`pdk-reveal-${i}`}>
                <summary className="cursor-pointer text-sm font-semibold">
                  {grid?.rows[Math.floor(i / 3)].label} × {grid?.cols[i % 3].label} <span className="text-muted-foreground">({c.total} valid)</span>
                </summary>
                <ul className="mt-2 flex flex-wrap gap-1.5 text-xs">
                  {c.answers.map((a) => (
                    <li key={a.id} className={cn("rounded border px-2 py-0.5", locked[i]?.id === a.id ? "border-primary bg-primary/15 font-bold" : "border-foreground/15")}>
                      {a.name}
                      {a.pct !== null && <span className="ml-1 tabular-nums text-muted-foreground">{a.pct}%</span>}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </section>
        )}

        {(mode === "daily" || mode === "weekly") && (
          <section id="pdk-board" className="space-y-2" aria-label="Leaderboard" data-testid="pdk-board">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-xl font-bold uppercase">{mode === "weekly" ? `This week's board · ${weeklyInfo?.theme ?? "Weekly"}` : `Today's board · ${DIFF_LABEL[difficulty]}`}</h2>
              <div className="flex gap-1" role="tablist" aria-label="Leaderboard scope">
                {(["all", "friends"] as const).map((s) => (
                  <button key={s} type="button" role="tab" aria-selected={boardScope === s} onClick={() => setBoardScope(s)} className={cn("rounded border px-2.5 py-1 text-xs font-semibold uppercase", boardScope === s ? "border-primary bg-primary/15" : "border-foreground/15 text-muted-foreground")}>
                    {s === "all" ? "Everyone" : "Friends"}
                  </button>
                ))}
              </div>
            </div>
            {!board ? (
              <p className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading
              </p>
            ) : board.signedIn === false ? (
              <p className="py-3 text-center text-sm text-muted-foreground">Sign in to see how your friends did.</p>
            ) : !board.rows ? (
              <p className="py-3 text-center text-sm text-muted-foreground">The leaderboard is off right now.</p>
            ) : board.rows.length === 0 ? (
              <p className="py-3 text-center text-sm text-muted-foreground">Nobody is on the board yet. Finish a grid with a trainer name to rank.</p>
            ) : (
              <ol className="divide-y divide-foreground/10 rounded-md border border-foreground/10 text-sm">
                {board.rows.map((r, i) => (
                  <li key={i} className={cn("flex items-center gap-3 px-3 py-1.5", r.you && "bg-primary/10 font-semibold")}>
                    <span className="w-6 tabular-nums text-muted-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{r.name}</span>
                    <span className="tabular-nums">{r.solved}/9</span>
                    <span className="w-16 text-right tabular-nums">{r.score}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}
      </div>

      {picking !== null && grid && (
        <PdkPicker
          dex={dex}
          used={used}
          busy={busy}
          title={`${grid.rows[Math.floor(picking / 3)].label} × ${grid.cols[picking % 3].label}`}
          onPick={(p) => void pick(p)}
          onClose={() => setPicking(null)}
        />
      )}
      {sheet === "archive" && today && (
        <PdkArchiveSheet
          today={today}
          archive={loadPdkArchive()}
          onPlay={(date, d) => {
            setSheet(null);
            setArchive({ date, difficulty: d });
            setMode("archive");
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "howto" && <PdkHowToSheet onClose={closeSheet} />}
      {sheet === "stats" && <PdkStatsSheet streak={block.streak} best={block.best} play={{ ...EMPTY_PDK_PLAY, ...progress?.pdkPlay }} onClose={() => setSheet(null)} />}
    </MotionConfig>
  );
}
