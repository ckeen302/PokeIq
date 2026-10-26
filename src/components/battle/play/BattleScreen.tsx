"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { MusicControl, trackFor, useBattleMusic } from "./MusicControl";
import { AlertTriangle, Eye, Undo2, FastForward, Gauge, Loader2, ScrollText, SkipForward, Sparkles, Timer } from "lucide-react";
import { CPU_LEVEL_INFO, PLAY_FORMAT_INFO, timerNagMarks, type BattleRequestPokemon, type BattleView } from "@/lib/battle/play";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Dex } from "@pkmn/dex";
import { BattleModel, textLines, type SideId, type Snap, type Step } from "./model";
import { preloadSprite } from "./sprites";
import { loadAnims, playStep, type PopupTone, type StageHandle } from "./player";
import { Stage, type Popup } from "./Stage";
import { Controls } from "./Controls";
import { HotkeyHelp, useHotkeyHelp } from "./hotkeys";
import { TIMER_WARNINGS, timerWarning } from "@/lib/battle/timer-warning";
import type { Ball } from "./Hud";
import { Avatar } from "@/components/avatar/Avatar";

/**
 * The battle screen. Lines from the player's channel go through the model
 * into a queue of steps; the queue plays them one at a time on the stage
 * (with speed and skip controls, and no motion for players who ask for
 * less), adding each step's text to the battle log as it plays. The move
 * menu appears once the queue is empty and the server has a request for us.
 */

export interface BattleScreenProps {
  view: BattleView;
  /** `instant`: on a reset, show where the battle stands at once (no animations), as when catching up. */
  log: { lines: string[]; reset: number; instant?: boolean };
  /** Server time minus device time. */
  offset: number;
  busy: boolean;
  error: string | null;
  onChoose: (rqid: number, choice: string) => void;
  /** Shown under the result once the battle is over and has played out. */
  endActions?: React.ReactNode;
  /** Under the battle log: the players' chat in a live battle. */
  side?: React.ReactNode;
  /** A live battle: take back the choice you sent while the opponent is still choosing. */
  onUndo?: (rqid: number) => void;
  /** A live battle with the timer off: start it. */
  onStartTimer?: () => void;
  /** Turn the timer off again (only for a player who asked for it). */
  onStopTimer?: () => void;
  /** Under the header: a replay's playback controls. */
  toolbar?: React.ReactNode;
  /** A replay: no clocks, waiting or controls, just the battle. */
  replay?: boolean;
  /** Called whenever the animation queue runs dry (a replay feeds the next turn then). */
  onIdle?: () => void;
}

/** How a finished battle ended, told from one trainer's side or, for spectators and replays, neutrally. */
export function endText(view: Pick<BattleView, "end" | "players" | "you">, turns: number): { title: string; detail: string; tone: "win" | "loss" | "draw" } {
  const end = view.end!;
  const names = view.players.map((p) => p.name);
  const winner = end.winner === null ? null : (names[end.winner] ?? "A trainer");
  const loser = end.winner === null ? null : (names[1 - end.winner] ?? "A trainer");
  const turnsText = `${turns} turn${turns === 1 ? "" : "s"}`;
  if (view.you === null) {
    if (end.winner === null) return { title: end.reason === "nocontest" ? "No contest" : "A draw", detail: end.reason === "nocontest" ? "The battle couldn't go on." : `After ${turnsText}.`, tone: "draw" };
    const why =
      end.reason === "forfeit" ? `${loser} forfeited.` : end.reason === "timeout" ? `${loser} ran out of time.` : end.reason === "left" ? `${loser} disconnected.` : `In ${turnsText}.`;
    return { title: `${winner} won!`, detail: why, tone: "win" };
  }
  const won = end.winner === view.you;
  const foe = names[view.you === 0 ? 1 : 0] ?? "Opponent";
  if (end.winner === null) return { title: "A draw", detail: end.reason === "nocontest" ? "The battle couldn't go on." : `After ${turnsText}.`, tone: "draw" };
  const detail =
    end.reason === "forfeit"
      ? won
        ? `${foe} forfeited.`
        : "You forfeited."
      : end.reason === "timeout"
        ? won
          ? `${foe} ran out of time.`
          : "You ran out of time."
        : end.reason === "left"
          ? won
            ? `${foe} disconnected.`
            : "You were disconnected."
          : end.reason === "nocontest"
            ? "The battle couldn't go on."
            : won
              ? `You beat ${foe} in ${turnsText}.`
              : `${foe} won in ${turnsText}.`;
  return { title: won ? "Victory!" : "Defeat", detail, tone: won ? "win" : "loss" };
}

interface Entry {
  id: number;
  turn?: number;
  text: string;
}

const SPEEDS = [0.5, 1, 2, 4] as const;
const SPEED_KEY = "pokeiq:battle:speed";
const ANIM_KEY = "pokeiq:battle:animations";

function emptySnap(): Snap {
  const side = (id: SideId) => ({ id, name: "", active: [], team: [], total: 6, conditions: [] });
  return { gen: 9, turn: 0, sides: { p1: side("p1"), p2: side("p2") }, weather: "", terrain: "", pseudo: [] };
}

function RichText({ text }: { text: string }) {
  return (
    <>
      {textLines(text).map((line, i) => (
        <span key={i} className="block">
          {line.map((part, j) => (part.bold ? <strong key={j} className="text-foreground">{part.text}</strong> : <span key={j}>{part.text}</span>))}
        </span>
      ))}
    </>
  );
}

/** Preloads the battle sprite for a protocol details string ("Salazzle, L88, F, shiny"). */
function preloadDetails(details: string, back: boolean) {
  const species = Dex.species.get(details.split(",")[0]);
  if (species.exists) void preloadSprite({ id: species.id, num: species.num }, back, /(^|, )shiny(,|$)/.test(details));
}

function clock(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function useTick(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

export default function BattleScreen({ view, log, offset, busy, error, onChoose, endActions, side, onUndo, onStartTimer, onStopTimer, toolbar, replay, onIdle }: BattleScreenProps) {
  const watching = view.you === null;
  const idle = useRef(onIdle);
  idle.current = onIdle;
  /** Counts resets, so a step still animating from before one doesn't commit its state. */
  const generation = useRef(0);
  /** Battle log option: animations on (off: each step lands at once, text and all). */
  const animations = useRef(true);
  const [animationsOn, setAnimationsOn] = useState(true);
  const toggleAnimations = (on: boolean) => {
    animations.current = on;
    setAnimationsOn(on);
    // Turning them off mid-turn: the rest of the turn lands at once.
    if (!on) abort.current?.abort();
    try {
      window.localStorage.setItem(ANIM_KEY, on ? "on" : "off");
    } catch {
      // not remembered
    }
  };
  const me: SideId = view.you === 1 ? "p2" : "p1";
  const doubles = PLAY_FORMAT_INFO[view.format].gameType === "doubles";
  const model = useRef<BattleModel | null>(null);
  const fed = useRef(0);
  const resetSeen = useRef(-1);
  const queue = useRef<Step[]>([]);
  const running = useRef(false);
  const skipping = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const stage = useRef<StageHandle | null>(null);
  const entryId = useRef(0);
  const popupId = useRef(0);
  const [snap, setSnap] = useState<Snap>(emptySnap);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [message, setMessage] = useState("");
  const [popups, setPopups] = useState<Popup[]>([]);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(1);
  const speedRef = useRef(1);
  const [showLog, setShowLog] = useState(false);
  const logEnd = useRef<HTMLDivElement>(null);
  const logBox = useRef<HTMLDivElement>(null);
  /** Whether the log was scrolled to its end before the newest lines came in (as on Showdown, reading back stops the autoscroll). */
  const logAtEnd = useRef(true);

  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(SPEED_KEY));
      if (SPEEDS.includes(saved as (typeof SPEEDS)[number])) {
        setSpeed(saved);
        speedRef.current = saved;
      }
    } catch {
      // keep 1x
    }
    void loadAnims().catch(() => undefined);
    try {
      if (window.localStorage.getItem(ANIM_KEY) === "off") {
        animations.current = false;
        setAnimationsOn(false);
      }
    } catch {
      // animations stay on
    }
  }, []);

  const changeSpeed = (next: number) => {
    setSpeed(next);
    speedRef.current = next;
    try {
      window.localStorage.setItem(SPEED_KEY, String(next));
    } catch {
      // not remembered
    }
  };

  const onHandle = useCallback((handle: StageHandle) => {
    stage.current = handle;
  }, []);

  const addEntry = useCallback((step: Step) => {
    const text = step.text.trim();
    if (!text) return;
    const id = ++entryId.current;
    setEntries((list) => [...list.slice(-600), step.cmd === "turn" ? { id, turn: Number(step.args[1]), text } : { id, text }]);
  }, []);

  const popup = useCallback((ref: Step["who"], text: string, tone: PopupTone) => {
    const id = ++popupId.current;
    setPopups((list) => [...list, { id, ref, text, tone }]);
    window.setTimeout(() => setPopups((list) => list.filter((p) => p.id !== id)), 1200);
  }, []);

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setPlaying(true);
    const reducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    while (queue.current.length) {
      const step = queue.current.shift()!;
      // A reset (a replay jumping to another turn) mid-step: the old step must not paint over the new state.
      const g = generation.current;
      const commit = (s: Snap) => {
        if (g === generation.current) setSnap(s);
      };
      addEntry(step);
      if (step.text.trim() && step.cmd !== "turn") setMessage(step.text);
      if (skipping.current || !stage.current || !animations.current) {
        if (!queue.current.length && step.snap) commit(step.snap);
        continue;
      }
      const controller = new AbortController();
      abort.current = controller;
      try {
        await playStep(step, { stage: stage.current, commit, popup, speed: speedRef.current, signal: controller.signal, reducedMotion: !!reducedMotion });
      } catch (err) {
        console.error("[battle] step failed:", err);
        if (step.snap) commit(step.snap);
      }
    }
    skipping.current = false;
    abort.current = null;
    running.current = false;
    setPlaying(false);
    idle.current?.();
  }, [addEntry, popup]);

  // New lines: into the model, then onto the queue (or straight to the screen when catching up).
  useLayoutEffect(() => {
    let first = false;
    if (!model.current || log.reset !== resetSeen.current) {
      const restart = !!model.current;
      model.current = new BattleModel(me);
      fed.current = 0;
      queue.current = [];
      resetSeen.current = log.reset;
      setEntries([]);
      first = true;
      if (restart) {
        generation.current += 1;
        abort.current?.abort();
        setSnap(emptySnap());
        setMessage("");
      }
    }
    const fresh = log.lines.slice(fed.current);
    fed.current = log.lines.length;
    if (!fresh.length) return;
    const m = model.current;
    // Coming back to a battle under way: no replaying the history, just show where it stands.
    const catchUp = first && (log.instant ?? fresh.some((line) => /^\|turn\|([2-9]|\d\d)/.test(line)));
    if (catchUp) {
      const caught: Entry[] = [];
      for (const line of fresh) {
        const step = m.feed(line);
        const text = step?.text.trim();
        if (step && text) caught.push(step.cmd === "turn" ? { id: ++entryId.current, turn: Number(step.args[1]), text } : { id: ++entryId.current, text });
      }
      setEntries(caught.slice(-600));
      setSnap(m.snapshot());
      const last = [...caught].reverse().find((e) => e.turn === undefined);
      setMessage(last?.text ?? "");
      window.setTimeout(() => idle.current?.(), 0);
      return;
    }
    for (const line of fresh) {
      const step = m.feed(line);
      if (!step) continue;
      step.snap = m.snapshot();
      queue.current.push(step);
      // Start fetching a Pokémon's sprite as soon as it's on its way in.
      if ((step.cmd === "switch" || step.cmd === "drag" || step.cmd === "replace") && step.who) preloadDetails(step.args[2] ?? "", step.who.side === me);
    }
    void run();
  }, [log, me, run]);

  // Your team's sprites, ready for when they switch in.
  const requestTeam = view.request?.data.side.pokemon;
  const [myTeam, setMyTeam] = useState<{ ident: string; name: string }[]>([]);
  /** Your team as the latest request listed it (the tooltips' exact stats, between requests too). */
  const [lastTeam, setLastTeam] = useState<BattleRequestPokemon[] | undefined>(undefined);
  useEffect(() => {
    if (!requestTeam) return;
    for (const p of requestTeam) preloadDetails(p.details, true);
    setMyTeam(requestTeam.map((p) => ({ ident: p.ident, name: p.ident.split(": ")[1] ?? p.ident })));
    setLastTeam(requestTeam);
  }, [requestTeam]);
  // Your whole team as party balls, with faints and status as they've played out (never ahead of the animation).
  const myBalls = useMemo<Ball[] | undefined>(() => {
    if (!myTeam.length) return undefined;
    const seen = new Map(snap.sides[me].team.map((m) => [m.key, m]));
    return myTeam.map((p) => seen.get(p.ident) ?? { name: p.name, fainted: false, status: "" });
  }, [myTeam, snap, me]);

  useEffect(() => {
    const box = logBox.current;
    // Scrolls the log box itself, never the page around it.
    if (box && logAtEnd.current) box.scrollTop = box.scrollHeight;
  }, [entries.length, showLog]);

  const skip = () => {
    skipping.current = true;
    abort.current?.abort();
  };

  const pending = playing || log.lines.length > fed.current;
  const now = useTick(!!view.clocks && view.status === "playing") + offset;
  const youName = view.players[view.you ?? 0]?.name ?? "You";
  const foeName = view.players[view.you === 1 ? 0 : 1]?.name ?? "Opponent";
  const cpu = view.cpu ? CPU_LEVEL_INFO[view.cpu.level].name : null;
  const showControls = !pending && view.status === "playing" && !!view.request && !view.end;
  const ended = !!view.end && !pending;
  const won = ended && view.end!.winner !== null && view.end!.winner === view.you;
  const result = ended ? endText(view, snap.turn) : null;
  useBattleMusic(trackFor(view, ended, won));
  const help = useHotkeyHelp();
  const myLeft = view.clocks && view.status === "playing" && view.clocks.you.deadline && !view.waiting && view.request ? view.clocks.you.deadline - now : null;
  const warning = timerWarning(myLeft);

  // Showdown's inactivity messages in the log as either player's turn time runs down ("Red has 20 seconds left.").
  const nagged = useRef(new Map<string, Set<number>>());
  useEffect(() => {
    if (!view.clocks || view.status !== "playing" || replay) return;
    const names = { you: youName, foe: foeName };
    const lines: string[] = [];
    for (const who of ["you", "foe"] as const) {
      const c = view.clocks[who];
      if (!c.deadline || !c.startedAt) continue;
      const key = `${who}:${c.deadline}`;
      const marks = timerNagMarks(Math.round((c.deadline - c.startedAt) / 1000));
      const left = (c.deadline - now) / 1000;
      let done = nagged.current.get(key);
      if (!done) {
        // A page opened mid-turn doesn't replay the messages it missed.
        done = new Set(marks.filter((m) => left < m - 1));
        nagged.current.set(key, done);
      }
      for (const m of marks) {
        if (left <= m && !done.has(m)) {
          done.add(m);
          lines.push(`${names[who]} has ${m} seconds left.`);
        }
      }
    }
    if (!lines.length) return;
    setEntries((list) => [...list.slice(-600), ...lines.map((text) => ({ id: ++entryId.current, text }))]);
  }, [now, view.clocks, view.status, replay, youName, foeName]);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-3">
        {/* Who's playing, the clocks and playback controls. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-w-0 basis-full items-center gap-2 font-display text-sm font-bold uppercase tracking-wide sm:basis-auto sm:flex-1">
            <Avatar avatar={view.players[view.you ?? 0]?.avatar} size={24} />
            <span className="truncate text-primary">
              {youName}
              {view.players[view.you ?? 0]?.rating !== undefined && <span className="hud-label ml-1.5 tabular-nums">{view.players[view.you ?? 0].rating}</span>}
            </span>
            <span className="hud-label">vs</span>
            <Avatar avatar={view.cpu ? null : view.players[view.you === 1 ? 0 : 1]?.avatar} size={24} />
            <span className="truncate text-screen">
              {foeName}
              {cpu && <span className="hud-label ml-1.5">{cpu}</span>}
              {view.players[view.you === 1 ? 0 : 1]?.rating !== undefined && <span className="hud-label ml-1.5 tabular-nums">{view.players[view.you === 1 ? 0 : 1].rating}</span>}
            </span>
            <span className="hud-label ml-2 hidden sm:inline">
              {view.ranked ? "Ranked · " : ""}
              {view.formatName ?? PLAY_FORMAT_INFO[view.format].name}
            </span>
          </div>
          {view.kind === "pvp" && view.spectators !== undefined && !replay && (
            <span className="hud-label flex items-center gap-1" title="Spectators watching now" data-testid="spectator-count">
              <Eye className="h-3.5 w-3.5" aria-hidden /> {view.spectators} watching
            </span>
          )}
          {view.timerStartable && onStartTimer && !watching && (
            <button
              type="button"
              onClick={onStartTimer}
              disabled={busy}
              className="flex items-center gap-1 rounded-sm border border-screen/50 px-2 py-0.5 font-pixel text-[10px] uppercase text-screen hover:bg-screen/10 disabled:opacity-50"
              data-testid="start-timer"
            >
              <Timer className="h-3 w-3" aria-hidden /> Start timer
            </button>
          )}
          {view.timerStoppable && onStopTimer && !watching && (
            <button
              type="button"
              onClick={onStopTimer}
              disabled={busy}
              className="flex items-center gap-1 rounded-sm border border-border px-2 py-0.5 font-pixel text-[10px] uppercase text-muted-foreground hover:bg-muted disabled:opacity-50"
              title="You asked for the timer: turn it off again (it stays on if your opponent asked for it too)"
              data-testid="stop-timer"
            >
              <Timer className="h-3 w-3" aria-hidden /> Stop timer
            </button>
          )}
          {view.frontier && (
            <span className="hud-label rounded-sm border border-primary/40 px-1.5 py-1 text-primary" data-testid="battle-streak">
              {view.frontier.boss ? "Tycoon battle · " : ""}Round {view.frontier.round}, battle {view.frontier.battle}/7 · Streak {view.frontier.streak}
            </span>
          )}
          {view.clocks && view.status === "playing" && (
            <div className="flex items-center gap-3 font-pixel text-[11px]" data-testid="battle-clocks">
              <Timer className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <span className={cn(view.clocks.you.deadline && view.clocks.you.deadline - now < 20_000 ? "text-destructive" : "text-foreground")}>
                You {view.clocks.you.deadline ? clock(view.clocks.you.deadline - now) : clock(view.clocks.you.bank)}
              </span>
              <span className="text-muted-foreground">Foe {view.clocks.foe.deadline ? clock(view.clocks.foe.deadline - now) : clock(view.clocks.foe.bank)}</span>
            </div>
          )}
          <MusicControl />
          {!replay && !watching && <HotkeyHelp open={help.open} onToggle={help.toggle} />}
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Battle log options: text speed and animations" title="Text speed">
            <Gauge className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            {SPEEDS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => changeSpeed(s)}
                aria-pressed={speed === s}
                className={cn("rounded-sm px-1.5 py-0.5 font-pixel text-[10px]", speed === s ? "bg-screen text-black" : "text-muted-foreground hover:text-foreground")}
              >
                {s}x
              </button>
            ))}
            <button type="button" onClick={skip} disabled={!playing} className="ml-1 flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-pixel text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40" aria-label="Skip the animations">
              <SkipForward className="h-3 w-3" aria-hidden /> Skip
            </button>
            <button
              type="button"
              onClick={() => toggleAnimations(!animationsOn)}
              aria-pressed={animationsOn}
              className="ml-1 flex items-center whitespace-nowrap gap-1 rounded-sm px-1.5 py-0.5 font-pixel text-[10px] text-muted-foreground hover:text-foreground"
              title="Battle log option: animate each step, or show it at once"
              data-testid="animations-toggle"
            >
              <Sparkles className="h-3 w-3" aria-hidden /> {animationsOn ? "Anims on" : "Anims off"}
            </button>
            <button type="button" onClick={() => setShowLog((s) => !s)} className="ml-1 flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-pixel text-[10px] text-muted-foreground hover:text-foreground lg:hidden" aria-expanded={showLog}>
              <ScrollText className="h-3 w-3" aria-hidden /> Log
            </button>
          </div>
        </div>

        {toolbar}

        <Stage snap={snap} me={me} doubles={doubles} popups={popups} onHandle={onHandle} myBalls={myBalls} format={view.format} myRequest={lastTeam} watching={watching} />

        {/* The text box: the latest line of the battle. */}
        <div className="dialog-box min-h-[4.25rem] text-sm leading-relaxed text-muted-foreground" data-done={showControls} aria-live="polite" data-testid="battle-message">
          {message ? <RichText text={message} /> : <span>The battle is about to begin…</span>}
        </div>

        {warning && (
          <p
            role="alert"
            data-testid="timer-warning"
            className={cn(
              "flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold",
              myLeft! <= TIMER_WARNINGS[1] ? "animate-pulse border-destructive bg-destructive/15 text-destructive" : "border-warning/60 bg-warning/10 text-warning"
            )}
          >
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden /> {warning} {view.timeoutLoses ? (view.timer?.autoChoose && view.clocks && view.clocks.you.bank > (myLeft ?? 0) ? "Run out and a default move is made for you." : "Run out and you lose the battle.") : "Run out and the timer picks for you."}
          </p>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Card>
          <CardContent className="p-4">
            {showControls ? (
              <Controls key={view.request!.rqid} request={view.request!.data} snap={snap} me={me} doubles={doubles} busy={busy} format={view.format} onChoose={(choice) => onChoose(view.request!.rqid, choice)} onHelp={help.toggle} />
            ) : ended ? (
              <div className="space-y-3 text-center" data-testid="battle-result">
                <p className={cn("font-display text-3xl font-bold uppercase", result!.tone === "win" ? "text-success" : result!.tone === "draw" ? "text-foreground" : "text-destructive")}>
                  {result!.title}
                </p>
                <p className="text-sm text-muted-foreground">{result!.detail}</p>
                {endActions}
              </div>
            ) : replay ? (
              <p className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground" data-testid="replay-status">
                <FastForward className={cn("h-4 w-4", pending && "animate-pulse")} aria-hidden /> {pending ? "Playing the turn…" : `Turn ${snap.turn}`}
              </p>
            ) : (
              <p className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground" data-testid="battle-waiting">
                {pending ? (
                  <>
                    <FastForward className="h-4 w-4 animate-pulse" aria-hidden /> Playing the turn…
                  </>
                ) : (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {busy ? "Sending…" : view.cpu ? "The computer is thinking…" : watching ? "The trainers are choosing…" : `Waiting for ${foeName}…`}
                    {view.cancel && onUndo && !busy && (
                      <button
                        type="button"
                        onClick={() => onUndo(view.cancel!.rqid)}
                        className="ml-2 flex items-center gap-1 rounded-sm border border-border px-2 py-0.5 font-pixel text-[10px] uppercase text-foreground hover:bg-muted"
                        title="Take back your choice before your opponent makes theirs"
                        data-testid="cancel-choice"
                      >
                        <Undo2 className="h-3 w-3" aria-hidden /> Cancel
                      </button>
                    )}
                  </>
                )}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* The battle log. */}
      <aside className="min-w-0 space-y-3 lg:sticky lg:top-20 lg:self-start">
        <Card className={cn("lg:block", showLog ? "block" : "hidden")} aria-label="Battle log">
          <CardContent className="p-0">
            <p className="hud-label flex items-center gap-1.5 border-b px-4 py-3">
              <ScrollText className="h-3 w-3" aria-hidden /> Battle log
            </p>
            <div
              className={cn(
                "max-h-[28rem] space-y-1 overflow-y-auto px-4 py-3 text-xs leading-relaxed text-muted-foreground",
                side ? "lg:max-h-[calc(100vh-30rem)] lg:min-h-[10rem]" : "lg:max-h-[calc(100vh-12rem)]"
              )}
              data-testid="battle-log"
              ref={logBox}
              onScroll={(e) => {
                const box = e.currentTarget;
                logAtEnd.current = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
              }}
            >
              {entries.map((e) =>
                e.turn !== undefined ? (
                  <p key={e.id} className="hud-label pt-2 text-screen">
                    Turn {e.turn}
                  </p>
                ) : (
                  <div key={e.id}>
                    <RichText text={e.text} />
                  </div>
                )
              )}
              <div ref={logEnd} />
            </div>
          </CardContent>
        </Card>
        {side}
      </aside>
    </div>
  );
}
