"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Eye, Flag, Loader2, Pause, Play, RotateCcw, SkipForward, Sparkles, Timer, Trophy } from "lucide-react";
import { buildMatcher } from "@/lib/name-em-all/match";
import { NEA_PATH, standardMinutes } from "@/lib/name-em-all/categories";
import { DEFAULT_SETTINGS, loadBests, loadSave, loadSettings, recordBest, storeSave, storeSettings, type NeaSave, type NeaSettings } from "@/lib/name-em-all/local";
import { neaClock, neaShareText } from "@/lib/name-em-all/share";
import { NEA_MODES, type NeaMode, type NeaResultResponse, type NeaTarget } from "@/lib/name-em-all/types";
import { dlePlayerId } from "@/lib/dle-player";
import { useAccount } from "@/lib/account";
import { play, unlockAudio } from "@/lib/sound";
import { Button } from "@/components/ui/button";
import { NeaShareButton } from "./NeaShare";
import { SlotGrid, Sprite, Toggle, groupSlots, type SlotState, type SpriteStyle } from "./parts";
import { outsiderMap, useNameInput } from "./use-name-input";
import { cn } from "@/lib/utils";

/**
 * Name 'em All: type the name of every Pokémon in a category. Each one
 * fills its slot the instant it's spelled right. Setup (mode, timer, hints,
 * options, resume), the game (counter, clock, pause, name box, hints, the
 * grid), and the end (missed ones revealed and linked, share, and the
 * signed-in trainer's personal best kept for their profile).
 */

export interface NameEmAllProps {
  category: { id: string; label: string };
  targets: NeaTarget[];
  outsiders: string[];
  /** The daily's date: settings are fixed and the day has its own board. */
  daily?: string;
}

type Phase = "setup" | "playing" | "paused" | "over";
type OverReason = "clear" | "time" | "gaveup";

const TIMER_CHOICES = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120];
const SILHOUETTE_MS = 20_000;
const CYCLE_MS = 6_000;

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function NameEmAll({ category, targets, outsiders, daily }: NameEmAllProps) {
  const total = targets.length;
  const scope = daily ? `daily:${daily}` : category.id;
  const standard = standardMinutes(total);
  const matcher = useMemo(() => buildMatcher(targets), [targets]);
  const outsidersMap = useMemo(() => outsiderMap(outsiders), [outsiders]);
  const groups = useMemo(() => groupSlots(targets), [targets]);
  const account = useAccount();

  // ---- settings ---------------------------------------------------------------------
  const [settings, setSettings] = useState<NeaSettings>({ ...DEFAULT_SETTINGS, minutes: standard });
  const [saved, setSaved] = useState<NeaSave | null>(null);
  const [best, setBest] = useState<{ named: number; ms: number } | null>(null);
  useEffect(() => {
    const s = loadSettings();
    setSettings((cur) => ({ ...cur, ...s, minutes: standard, ...(daily && { mode: "regular" as NeaMode }) }));
    setSaved(loadSave(scope, total));
    setBest(loadBests()[scope] ?? null);
  }, [scope, total, standard, daily]);
  const set = <K extends keyof NeaSettings>(k: K, v: NeaSettings[K]) =>
    setSettings((s) => {
      const next = { ...s, [k]: v };
      storeSettings(next);
      return next;
    });

  // ---- the run ----------------------------------------------------------------------
  const [phase, setPhase] = useState<Phase>("setup");
  const [named, setNamed] = useState<number[]>([]);
  const [times, setTimes] = useState<number[]>([]);
  const [queue, setQueue] = useState<number[]>([]);
  const [fresh, setFresh] = useState<number | null>(null);
  const [overReason, setOverReason] = useState<OverReason | null>(null);
  const [finalMs, setFinalMs] = useState(0);
  const [newBest, setNewBest] = useState(false);
  const [confirmGiveUp, setConfirmGiveUp] = useState(false);
  const [silhouette, setSilhouette] = useState<number | null>(null);
  const [spriteStyle, setSpriteStyle] = useState<SpriteStyle>("pixel");
  const namedSet = useRef(new Set<number>());
  const banked = useRef(0);
  const since = useRef<number | null>(null);
  const flags = useRef({ paused: false, hints: false, resumed: false });
  const startToken = useRef<Promise<string | null> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const live = phase === "playing";

  const elapsed = useCallback(() => banked.current + (since.current !== null ? performance.now() - since.current : 0), []);
  const limitMs = settings.minutes ? settings.minutes * 60_000 : null;
  const current = settings.mode !== "regular" && phase !== "over" ? (queue[0] ?? null) : null;

  const persist = useCallback(
    (next: Partial<NeaSave> = {}) => {
      if (!settings.save) return;
      storeSave(scope, { v: 1, settings, named, times, elapsed: elapsed(), queue: settings.mode === "regular" ? undefined : queue, savedAt: Date.now(), ...next });
    },
    [settings, scope, named, times, queue, elapsed]
  );

  const finish = useCallback(
    (reason: OverReason, at?: number) => {
      const ms = at ?? elapsed();
      banked.current = ms;
      since.current = null;
      setFinalMs(ms);
      setOverReason(reason);
      setPhase("over");
      setConfirmGiveUp(false);
      storeSave(scope, null);
      const count = namedSet.current.size;
      setNewBest(recordBest(scope, { named: count, total, ms }));
      if (settings.sound) play(reason === "clear" ? "fanfare" : "close");
    },
    [elapsed, scope, total, settings.sound]
  );

  const accept = useCallback(
    (slot: number, viaHelper: boolean) => {
      if (namedSet.current.has(slot)) return;
      const at = elapsed();
      namedSet.current.add(slot);
      if (viaHelper) flags.current.hints = true;
      setNamed((n) => [...n, slot]);
      setTimes((t) => [...t, at]);
      setQueue((q) => q.filter((s) => s !== slot));
      setFresh(slot);
      setSilhouette((s) => (s === slot ? null : s));
      if (namedSet.current.size === total) finish("clear", at);
      else if (settings.sound) play("correct");
    },
    [elapsed, total, finish, settings.sound]
  );

  const input = useNameInput({
    matcher,
    targets,
    outsiders: outsidersMap,
    label: category.label,
    isNamed: (s) => namedSet.current.has(s),
    allowed: (s) => settings.mode === "regular" || s === queue[0],
    spelling: settings.spelling && live,
    onAccept: accept,
  });

  // Save as the run goes (each name, and every few seconds), and when the page goes away.
  useEffect(() => {
    if (phase === "playing" || phase === "paused") persist();
  }, [named, phase, persist]);
  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => persist(), 5000);
    const away = () => persist();
    window.addEventListener("pagehide", away);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("pagehide", away);
    };
  }, [live, persist]);

  // Sprites: alternate pixel sprites and artwork.
  useEffect(() => {
    if (!settings.cycleSprites) return setSpriteStyle("pixel");
    const id = window.setInterval(() => setSpriteStyle((s) => (s === "pixel" ? "art" : "pixel")), CYCLE_MS);
    return () => window.clearInterval(id);
  }, [settings.cycleSprites]);

  // Silhouette hint: the asked-for slot in Chaos and Dex order, else a random open one (next on demand, or every 20 s).
  const pickSilhouette = useCallback(() => {
    if (current !== null) return setSilhouette(current);
    const open = targets.map((_, i) => i).filter((i) => !namedSet.current.has(i));
    setSilhouette(open.length ? open[Math.floor(Math.random() * open.length)] : null);
  }, [current, targets]);
  useEffect(() => {
    if (!live || !settings.silhouette) return;
    flags.current.hints = true;
    if (current !== null || silhouette === null || namedSet.current.has(silhouette)) pickSilhouette();
  }, [live, settings.silhouette, current, silhouette, pickSilhouette]);
  useEffect(() => {
    if (!live || !settings.silhouette || !settings.autoCycle || current !== null) return;
    const id = window.setInterval(pickSilhouette, SILHOUETTE_MS);
    return () => window.clearInterval(id);
  }, [live, settings.silhouette, settings.autoCycle, current, pickSilhouette]);

  useEffect(() => {
    if (fresh === null) return;
    const t = window.setTimeout(() => setFresh(null), 400);
    return () => window.clearTimeout(t);
  }, [fresh]);

  // ---- starting -----------------------------------------------------------------------
  function begin(resume: NeaSave | null) {
    unlockAudio();
    const s = resume ? { ...resume.settings, ...(daily && { mode: "regular" as NeaMode, minutes: standard }) } : settings;
    if (resume) setSettings(s);
    const order = targets.map((_, i) => i);
    const doneSet = new Set(resume?.named ?? []);
    namedSet.current = doneSet;
    setNamed(resume?.named ?? []);
    setTimes(resume?.times ?? []);
    const rest = order.filter((i) => !doneSet.has(i));
    setQueue(resume?.queue?.filter((i) => !doneSet.has(i)) ?? (s.mode === "chaos" ? shuffle(rest) : rest));
    banked.current = resume?.elapsed ?? 0;
    since.current = performance.now();
    flags.current = { paused: false, hints: false, resumed: !!resume };
    setOverReason(null);
    setSilhouette(null);
    setNewBest(false);
    input.reset();
    setPhase("playing");
    // The server's clock for a ranked run (Regular, fresh start).
    startToken.current =
      !resume && s.mode === "regular"
        ? fetch("/api/name-em-all/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, player: dlePlayerId() }) })
            .then((r) => (r.ok ? r.json() : null))
            .then((d: { token?: string } | null) => d?.token ?? null)
            .catch(() => null)
        : null;
    requestAnimationFrame(() => {
      // The sticky bar counts as in view wherever it is: scroll the game's own top under the site header instead.
      const game = document.querySelector<HTMLElement>('[data-testid="nea-game"]');
      if (game) window.scrollTo({ top: Math.max(0, game.getBoundingClientRect().top + window.scrollY - 64) });
      inputRef.current?.focus({ preventScroll: true });
    });
  }

  function pause() {
    if (phase !== "playing") return;
    banked.current = elapsed();
    since.current = null;
    flags.current.paused = true;
    setPhase("paused");
    persist({ elapsed: banked.current });
  }
  function resume() {
    since.current = performance.now();
    setPhase("playing");
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  }
  function skip() {
    setQueue((q) => (q.length > 1 ? [...q.slice(1), q[0]] : q));
    input.reset();
    if (settings.sound) play("click");
    inputRef.current?.focus({ preventScroll: true });
  }

  // ---- the end --------------------------------------------------------------------------
  const ranked = phase === "over" && settings.mode === "regular" && !flags.current.paused && !flags.current.hints && !flags.current.resumed && startToken.current !== null;
  const [post, setPost] = useState<{ state: "idle" | "posting" | "done" | "error"; res?: NeaResultResponse; error?: string }>({ state: "idle" });

  const submit = useCallback(
    async (body: Record<string, unknown>) => {
      setPost({ state: "posting" });
      try {
        const res = await fetch("/api/name-em-all/result", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ player: dlePlayerId(), ...body }) });
        const data = (await res.json().catch(() => ({}))) as NeaResultResponse & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Couldn't post the result.");
        setPost({ state: "done", res: data });
      } catch (err) {
        setPost({ state: "error", error: err instanceof Error ? err.message : "Couldn't post the result." });
      }
    },
    []
  );

  useEffect(() => {
    if (phase !== "over" || !ranked || post.state !== "idle") return;
    // No leaderboards: a signed-in trainer's checked run goes on their profile as a personal best.
    if (!account.user) return setPost({ state: "done", res: { saved: false, signIn: true, counted: 0 } });
    void (async () => {
      const token = await startToken.current;
      if (!token) return setPost({ state: "done", res: { saved: false, reason: "Couldn't reach the server to time this run.", counted: 0 } });
      await submit({ scope, token, named, times, ms: Math.round(finalMs) });
    })();
  }, [phase, ranked, post.state, submit, scope, named, times, finalMs, account.user]);

  // ---- the grid ---------------------------------------------------------------------------
  const nameSet = useMemo(() => new Set(named), [named]);
  const stateOf = useCallback(
    (slot: number): SlotState => (nameSet.has(slot) ? "named" : phase === "over" ? "missed" : slot === current ? "current" : "open"),
    [nameSet, phase, current]
  );
  const grid = useMemo(
    () => <SlotGrid targets={targets} groups={groups} stateOf={stateOf} style={spriteStyle} shiny={settings.shiny} fresh={fresh} />,
    [targets, groups, stateOf, spriteStyle, settings.shiny, fresh]
  );

  // The end: bring the result into view (the player may be deep in the grid).
  useEffect(() => {
    if (phase !== "over") return;
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>('[data-testid="nea-results"]');
      if (!el) return;
      // Below the site header and the game's sticky bar (scrollIntoView can move the visual viewport on phones instead).
      const bar = (hudRef.current?.offsetHeight ?? 0) + 56 + 12;
      window.scrollTo({ top: Math.max(0, el.getBoundingClientRect().top + window.scrollY - bar), behavior: "smooth" });
    });
  }, [phase]);

  // Keep the asked-for slot in view in Chaos and Dex order.
  useEffect(() => {
    if (current === null || phase !== "playing") return;
    const el = document.querySelector<HTMLElement>(`[data-testid="nea-grid"] [data-state="current"]`);
    if (!el) return;
    const r = el.getBoundingClientRect();
    const hud = hudRef.current?.getBoundingClientRect().bottom ?? 0;
    if (r.top < hud || r.bottom > window.innerHeight) window.scrollTo({ top: Math.max(0, r.top + window.scrollY - (window.innerHeight + hud) / 2 + r.height / 2), behavior: "smooth" });
  }, [current, phase]);

  const count = named.length;
  const pct = total ? (count / total) * 100 : 0;
  const shareText = neaShareText({ label: category.label, named: count, total, ms: overReason === "clear" ? finalMs : finalMs, mode: settings.mode, daily, url: typeof window === "undefined" ? undefined : `${window.location.origin}${daily ? `${NEA_PATH}/daily` : `${NEA_PATH}/${category.id}`}` });

  // ---- render -------------------------------------------------------------------------------
  if (phase === "setup") {
    const setup = (
      <Setup
        settings={settings}
        set={set}
        standard={standard}
        total={total}
        saved={saved}
        best={best}
        daily={daily}
        onStart={() => {
          storeSave(scope, null);
          setSaved(null);
          begin(null);
        }}
        onResume={() => saved && begin(saved)}
      />
    );
    return setup;
  }

  const over = phase === "over";
  return (
    <div className="space-y-4" data-testid="nea-game" data-phase={phase}>
      <div ref={hudRef} className="sticky top-14 z-30 -mx-4 scroll-mt-14 border-b border-border/70 bg-background/95 px-4 pb-2.5 pt-2 backdrop-blur sm:mx-0 sm:rounded-b-lg sm:border-x" data-testid="nea-hud">
        <div className="flex items-center gap-3">
          <p className="shrink-0 font-display font-bold tabular-nums leading-none" aria-live="polite" data-testid="nea-count">
            <span className="text-3xl sm:text-4xl">{count}</span>
            <span className="text-lg text-muted-foreground sm:text-xl"> / {total}</span>
          </p>
          <div className="meter min-w-0 flex-1" aria-hidden>
            <div className="h-full bg-success shadow-[0_0_8px_hsl(var(--success))] transition-[width] duration-300" style={{ width: `${pct}%` }} />
          </div>
          {!over && <Clock elapsed={elapsed} limitMs={limitMs} running={live} onTimeUp={() => finish("time", limitMs ?? undefined)} />}
          {over && (
            <span className="flex shrink-0 items-center gap-1 font-display text-lg font-bold tabular-nums">
              <Timer className="h-4 w-4 text-muted-foreground" aria-hidden />
              {neaClock(finalMs)}
            </span>
          )}
          {!over && (
            <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={phase === "paused" ? resume : pause} aria-label={phase === "paused" ? "Resume" : "Pause"} data-testid="nea-pause">
              {phase === "paused" ? <Play className="h-4 w-4" aria-hidden /> : <Pause className="h-4 w-4" aria-hidden />}
            </Button>
          )}
        </div>

        {!over && (
          <div className="mt-2 flex items-stretch gap-2">
            {settings.silhouette && (
              <button
                type="button"
                onClick={current === null ? pickSilhouette : undefined}
                className="screen flex h-11 w-11 shrink-0 items-center justify-center rounded-md sm:h-12 sm:w-12"
                aria-label={current === null ? "Silhouette hint: show another" : "Silhouette hint"}
                title={current === null ? "Show another" : undefined}
                data-testid="nea-silhouette"
              >
                {silhouette !== null && <Sprite id={targets[silhouette].id} style="pixel" shiny={false} size={44} silhouette className="relative z-[3]" />}
              </button>
            )}
            <div className="relative min-w-0 flex-1">
              {current !== null && (
                <span className="hud-label pointer-events-none absolute -top-1.5 left-2 z-10 bg-background px-1 text-screen">
                  {settings.mode === "dex" ? "Next up" : "Name"} No. {String(targets[current].num).padStart(3, "0")}
                </span>
              )}
              <input
                ref={inputRef}
                value={input.text}
                onChange={input.onChange}
                onKeyDown={input.onKeyDown}
                disabled={phase !== "playing"}
                placeholder={phase === "paused" ? "Paused" : current !== null ? "Who's this one?" : "Type a Pokémon's name…"}
                aria-label="Name a Pokémon"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                enterKeyHint="done"
                className="h-11 w-full rounded-md border-2 border-input bg-card px-3 text-base font-semibold outline-none transition-colors placeholder:font-normal focus:border-screen sm:h-12 sm:text-lg"
                data-testid="nea-input"
              />
            </div>
            {current !== null && (
              <Button variant="outline" className="h-11 shrink-0 px-3 sm:h-12" onClick={skip} disabled={phase !== "playing"} aria-label="Skip this one" data-testid="nea-skip">
                <SkipForward className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Skip</span>
              </Button>
            )}
            {confirmGiveUp ? (
              <Button variant="destructive" className="h-11 shrink-0 px-3 sm:h-12" onClick={() => finish("gaveup")} data-testid="nea-giveup-confirm">
                Reveal?
              </Button>
            ) : (
              <Button variant="ghost" className="h-11 shrink-0 px-2.5 sm:h-12" onClick={() => setConfirmGiveUp(true)} aria-label="Give up" data-testid="nea-giveup">
                <Flag className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Give up</span>
              </Button>
            )}
          </div>
        )}

        {!over && (
          <div className="mt-1.5 flex h-5 items-center gap-2 overflow-hidden text-xs" aria-live="polite">
            {input.suggestion !== null ? (
              <button type="button" onClick={input.acceptSuggestion} className="truncate font-semibold text-warning underline-offset-2 hover:underline" data-testid="nea-suggestion">
                Did you mean {targets[input.suggestion].name}? Tap or press Enter
              </button>
            ) : input.feedback ? (
              <span key={input.feedback.n} className={cn("truncate font-semibold animate-in fade-in", input.feedback.kind === "dup" ? "text-muted-foreground" : "text-destructive")}>
                {input.feedback.text}
              </span>
            ) : confirmGiveUp ? (
              <span className="truncate text-muted-foreground">
                Give up and see the ones you missed?{" "}
                <button className="underline" onClick={() => setConfirmGiveUp(false)}>
                  Keep going
                </button>
              </span>
            ) : (
              <span className="truncate text-muted-foreground">
                {settings.mode === "regular" ? "Any order. Names count as soon as they're spelled right." : settings.mode === "chaos" ? "Name the one we point at, or skip it." : "In Pokédex order. Skip one to come back to it."}
              </span>
            )}
          </div>
        )}
      </div>

      {over && (
        <Results
          reason={overReason!}
          count={count}
          total={total}
          ms={finalMs}
          label={category.label}
          shareText={shareText}
          newBest={newBest}
          ranked={ranked}
          mode={settings.mode}
          post={post}
          username={account.user?.username ?? null}
          onAgain={() => {
            setPost({ state: "idle" });
            setPhase("setup");
            setNamed([]);
            setTimes([]);
            namedSet.current = new Set();
            window.scrollTo({ top: 0 });
          }}
        />
      )}

      <div className="relative">
        {phase === "paused" && (
          <div className="absolute inset-0 z-20 flex items-start justify-center rounded-lg bg-background/80 pt-16 backdrop-blur-md" data-testid="nea-paused">
            <div className="space-y-3 text-center">
              <p className="font-display text-3xl font-bold uppercase">Paused</p>
              <p className="text-sm text-muted-foreground">The clock is stopped. Paused runs don&apos;t count as personal bests.</p>
              <Button size="lg" onClick={resume} data-testid="nea-resume">
                <Play className="h-4 w-4" aria-hidden /> Resume
              </Button>
            </div>
          </div>
        )}
        <div className={cn(phase === "paused" && "pointer-events-none select-none blur-md")} aria-hidden={phase === "paused"}>
          {grid}
        </div>
      </div>

    </div>
  );
}

// ---------------------------------------------------------------------------
// The clock
// ---------------------------------------------------------------------------

/** Ticks on its own so the grid doesn't re-render four times a second. */
function Clock({ elapsed, limitMs, running, onTimeUp }: { elapsed: () => number; limitMs: number | null; running: boolean; onTimeUp: () => void }) {
  const [, tick] = useState(0);
  const up = useRef(onTimeUp);
  up.current = onTimeUp;
  useEffect(() => {
    if (!running) return;
    const id = window.setInterval(() => {
      if (limitMs !== null && elapsed() >= limitMs) {
        window.clearInterval(id);
        up.current();
        return;
      }
      tick((n) => n + 1);
    }, 250);
    return () => window.clearInterval(id);
  }, [running, limitMs, elapsed]);
  const ms = elapsed();
  const left = limitMs !== null ? Math.max(0, limitMs - ms) : null;
  const low = left !== null && left <= 30_000;
  return (
    <span className={cn("flex shrink-0 items-center gap-1 font-display text-lg font-bold tabular-nums sm:text-xl", low && "text-destructive")} aria-label={left !== null ? `${neaClock(left)} left` : `${neaClock(ms)} played`} data-testid="nea-clock">
      <Timer className="h-4 w-4 text-muted-foreground" aria-hidden />
      {left !== null ? neaClock(left + 999) : neaClock(ms)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function Setup({
  settings,
  set,
  standard,
  total,
  saved,
  best,
  daily,
  onStart,
  onResume,
}: {
  settings: NeaSettings;
  set: <K extends keyof NeaSettings>(k: K, v: NeaSettings[K]) => void;
  standard: number;
  total: number;
  saved: NeaSave | null;
  best: { named: number; ms: number } | null;
  daily?: string;
  onStart: () => void;
  onResume: () => void;
}) {
  const choices = [...new Set([...TIMER_CHOICES, standard])].sort((a, b) => a - b);
  return (
    <div className="mx-auto max-w-3xl space-y-4" data-testid="nea-setup">
      {saved && (
        <div className="flex flex-col gap-3 rounded-lg border border-screen/50 bg-screen/[0.06] p-4 sm:flex-row sm:items-center" data-testid="nea-resume-card">
          <div className="min-w-0 flex-1">
            <p className="font-display text-lg font-bold uppercase">Pick up where you left off?</p>
            <p className="text-sm text-muted-foreground">
              {saved.named.length}/{total} named in {neaClock(saved.elapsed)} ({NEA_MODES.find((m) => m.id === saved.settings.mode)?.label}). Resumed runs don&apos;t count as personal bests.
            </p>
          </div>
          <Button size="lg" variant="success" onClick={onResume} data-testid="nea-resume-saved">
            <RotateCcw className="h-4 w-4" aria-hidden /> Resume
          </Button>
        </div>
      )}

      <div className="space-y-5 rounded-lg border bg-card p-4 sm:p-6">
        <fieldset className="space-y-2">
          <legend className="hud-label mb-2">Mode</legend>
          <div className="grid grid-cols-3 gap-2">
            {NEA_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                disabled={!!daily && m.id !== "regular"}
                onClick={() => set("mode", m.id)}
                aria-pressed={settings.mode === m.id}
                className={cn(
                  "rounded-md border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                  settings.mode === m.id ? "border-screen bg-screen/10" : "border-border/70 hover:border-screen/50"
                )}
                data-testid={`nea-mode-${m.id}`}
              >
                <span className="block font-display text-sm font-bold uppercase tracking-wide">{m.label}</span>
                <span className="hidden text-xs sm:block text-muted-foreground">{m.blurb}</span>
              </button>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-[12rem_1fr] sm:items-center">
          <label htmlFor="nea-timer" className="hud-label">
            Timer
          </label>
          <select
            id="nea-timer"
            value={settings.minutes ?? "none"}
            disabled={!!daily}
            onChange={(e) => set("minutes", e.target.value === "none" ? null : Number(e.target.value))}
            className="h-10 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-60"
            data-testid="nea-timer"
          >
            {choices.map((m) => (
              <option key={m} value={m}>
                {m} minute{m === 1 ? "" : "s"}
                {m === standard ? " (standard)" : ""}
              </option>
            ))}
            <option value="none">No limit (∞)</option>
          </select>
        </div>

        <fieldset className="space-y-2">
          <legend className="hud-label mb-2">Hints</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            <Toggle label="Silhouette" hint="A shadow of one you haven't named" checked={settings.silhouette} onChange={(v) => set("silhouette", v)} testId="nea-opt-silhouette" />
            <Toggle label="Auto-cycle" hint="A new silhouette every 20s" checked={settings.autoCycle} disabled={!settings.silhouette} onChange={(v) => set("autoCycle", v)} />
            <Toggle label="Spelling helper" hint="Suggests the closest name" checked={settings.spelling} onChange={(v) => set("spelling", v)} testId="nea-opt-spelling" />
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="hud-label mb-2">Options</legend>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Toggle label="Shiny sprites" checked={settings.shiny} onChange={(v) => set("shiny", v)} />
            <Toggle label="Cycle sprites" hint="Pixel ↔ artwork" checked={settings.cycleSprites} onChange={(v) => set("cycleSprites", v)} />
            <Toggle label="Sound" checked={settings.sound} onChange={(v) => set("sound", v)} />
            <Toggle label="Save progress" hint="On this device" checked={settings.save} onChange={(v) => set("save", v)} />
          </div>
        </fieldset>

        <div className="flex flex-col items-center gap-2 pt-1 text-center">
          <Button size="lg" className="min-w-48" onClick={onStart} data-testid="nea-start">
            <Play className="h-4 w-4" aria-hidden /> {saved ? "Start over" : "Start"}
          </Button>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Trophy className="h-3.5 w-3.5 text-warning" aria-hidden />
            {daily ? "One try a day for your best: no hints, no pausing." : `Personal bests: Regular mode, no hints, no pausing. The standard time is ${standard}:00.`}
          </p>
          {best && (
            <p className="hud-label" data-testid="nea-best">
              Your best: {best.named}/{total} in {neaClock(best.ms)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function Results({
  reason,
  count,
  total,
  ms,
  label,
  shareText,
  newBest,
  ranked,
  mode,
  post,
  username,
  onAgain,
}: {
  reason: OverReason;
  count: number;
  total: number;
  ms: number;
  label: string;
  shareText: string;
  newBest: boolean;
  ranked: boolean;
  mode: NeaMode;
  post: { state: "idle" | "posting" | "done" | "error"; res?: NeaResultResponse; error?: string };
  username: string | null;
  onAgain: () => void;
}) {
  const missed = total - count;
  const headline = reason === "clear" ? "You named them all!" : reason === "time" ? "Time's up!" : "Here's what you missed";
  return (
    <section className="space-y-4 rounded-lg border bg-card p-4 text-center sm:p-6" data-testid="nea-results">
      <div className="space-y-1">
        <p className="hud-label text-screen">{label}</p>
        <h2 className="flex items-center justify-center gap-2 font-display text-2xl font-bold uppercase sm:text-4xl">
          {reason === "clear" && <Sparkles className="h-7 w-7 text-warning" aria-hidden />}
          {headline}
        </h2>
        <p className="text-muted-foreground">
          <b className="text-foreground" data-testid="nea-final">
            {count}/{total}
          </b>{" "}
          in <b className="text-foreground">{neaClock(ms)}</b>
          {mode !== "regular" && <> · {mode === "chaos" ? "Chaos" : "Dex order"}</>}
          {missed > 0 && <> · {missed} missed, shown in red below (tap one for its Pokédex page)</>}
        </p>
        {newBest && <p className="hud-label text-success">New personal best!</p>}
      </div>
      <div className="flex flex-col items-center justify-center gap-3 sm:flex-row sm:items-start">
        <NeaShareButton text={shareText} />
        <Button size="lg" variant="outline" onClick={onAgain} data-testid="nea-again">
          <RotateCcw className="h-4 w-4" aria-hidden /> Play again
        </Button>
        <Link href={NEA_PATH} className="inline-flex h-12 items-center rounded-md px-4 font-display text-sm font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground">
          Other categories
        </Link>
      </div>
      <div className="mx-auto max-w-md text-sm" data-testid="nea-ranked">
        {!ranked ? (
          <p className="text-muted-foreground">
            <Eye className="mr-1 inline h-3.5 w-3.5" aria-hidden />
            Practice run: only Regular runs with no hints, pauses or resumes count as personal bests.
          </p>
        ) : post.state === "posting" || post.state === "idle" ? (
          <p className="flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Checking your run…
          </p>
        ) : post.state === "error" ? (
          <p className="text-destructive">{post.error}</p>
        ) : post.res?.signIn ? (
          <p className="text-muted-foreground" data-testid="nea-sign-in">
            <Link href="/login" className="font-semibold text-screen hover:underline">
              Sign in
            </Link>{" "}
            to keep your best on your trainer profile.
          </p>
        ) : post.res?.saved ? (
          <p className="text-success" data-testid="nea-saved">
            {post.res.improved ? "New best saved to your profile." : "Checked. Your best on your profile still stands."}{" "}
            {username && (
              <Link href={`/u/${encodeURIComponent(username)}#quiz-bests`} className="font-semibold text-screen hover:underline">
                See it
              </Link>
            )}
          </p>
        ) : (
          <p className="text-muted-foreground">{post.res?.reason ?? "Not saved."}</p>
        )}
      </div>
    </section>
  );
}
