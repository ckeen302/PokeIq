"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FastForward, Gauge, Loader2, ScrollText, SkipForward, Timer } from "lucide-react";
import { CPU_LEVEL_INFO, PLAY_FORMAT_INFO, type BattleView } from "@/lib/battle/play";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Dex } from "@pkmn/dex";
import { BattleModel, textLines, type SideId, type Snap, type Step } from "./model";
import { preloadSprite } from "./sprites";
import { loadAnims, playStep, type PopupTone, type StageHandle } from "./player";
import { Stage, type Popup } from "./Stage";
import { Controls } from "./Controls";
import type { Ball } from "./Hud";

/**
 * The battle screen. Lines from the player's channel go through the model
 * into a queue of steps; the queue plays them one at a time on the stage
 * (with speed and skip controls, and no motion for players who ask for
 * less), adding each step's text to the battle log as it plays. The move
 * menu appears once the queue is empty and the server has a request for us.
 */

export interface BattleScreenProps {
  view: BattleView;
  log: { lines: string[]; reset: number };
  /** Server time minus device time. */
  offset: number;
  busy: boolean;
  error: string | null;
  onChoose: (rqid: number, choice: string) => void;
  /** Shown under the result once the battle is over and has played out. */
  endActions?: React.ReactNode;
}

interface Entry {
  id: number;
  turn?: number;
  text: string;
}

const SPEEDS = [1, 2, 4] as const;
const SPEED_KEY = "pokeiq:battle:speed";

function emptySnap(): Snap {
  const side = (id: SideId) => ({ id, name: "", active: [], team: [], total: 6, conditions: [] });
  return { turn: 0, sides: { p1: side("p1"), p2: side("p2") }, weather: "", terrain: "", pseudo: [] };
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

export default function BattleScreen({ view, log, offset, busy, error, onChoose, endActions }: BattleScreenProps) {
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
      addEntry(step);
      if (step.text.trim() && step.cmd !== "turn") setMessage(step.text);
      if (skipping.current || !stage.current) {
        if (!queue.current.length && step.snap) setSnap(step.snap);
        continue;
      }
      const controller = new AbortController();
      abort.current = controller;
      try {
        await playStep(step, { stage: stage.current, commit: setSnap, popup, speed: speedRef.current, signal: controller.signal, reducedMotion: !!reducedMotion });
      } catch (err) {
        console.error("[battle] step failed:", err);
        if (step.snap) setSnap(step.snap);
      }
    }
    skipping.current = false;
    abort.current = null;
    running.current = false;
    setPlaying(false);
  }, [addEntry, popup]);

  // New lines: into the model, then onto the queue (or straight to the screen when catching up).
  useLayoutEffect(() => {
    let first = false;
    if (!model.current || log.reset !== resetSeen.current) {
      model.current = new BattleModel(me);
      fed.current = 0;
      queue.current = [];
      resetSeen.current = log.reset;
      setEntries([]);
      first = true;
    }
    const fresh = log.lines.slice(fed.current);
    fed.current = log.lines.length;
    if (!fresh.length) return;
    const m = model.current;
    // Coming back to a battle under way: no replaying the history, just show where it stands.
    const catchUp = first && fresh.some((line) => /^\|turn\|([2-9]|\d\d)/.test(line));
    if (catchUp) {
      const caught: Entry[] = [];
      for (const line of fresh) {
        const step = m.feed(line);
        const text = step?.text.trim();
        if (step && text) caught.push(step.cmd === "turn" ? { id: ++entryId.current, turn: Number(step.args[1]), text } : { id: ++entryId.current, text });
      }
      setEntries(caught.slice(-600));
      setSnap(m.snapshot());
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
  useEffect(() => {
    if (!requestTeam) return;
    for (const p of requestTeam) preloadDetails(p.details, true);
    setMyTeam(requestTeam.map((p) => ({ ident: p.ident, name: p.ident.split(": ")[1] ?? p.ident })));
  }, [requestTeam]);
  // Your whole team as party balls, with faints and status as they've played out (never ahead of the animation).
  const myBalls = useMemo<Ball[] | undefined>(() => {
    if (!myTeam.length) return undefined;
    const seen = new Map(snap.sides[me].team.map((m) => [m.key, m]));
    return myTeam.map((p) => seen.get(p.ident) ?? { name: p.name, fainted: false, status: "" });
  }, [myTeam, snap, me]);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: "nearest" });
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
  const tie = ended && view.end!.winner === null;

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-3">
        {/* Who's playing, the clocks and playback controls. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-w-0 basis-full items-center gap-2 font-display text-sm font-bold uppercase tracking-wide sm:basis-auto sm:flex-1">
            <span className="truncate text-primary">{youName}</span>
            <span className="hud-label">vs</span>
            <span className="truncate text-screen">
              {foeName}
              {cpu && <span className="hud-label ml-1.5">{cpu}</span>}
            </span>
            <span className="hud-label ml-2 hidden sm:inline">{PLAY_FORMAT_INFO[view.format].name}</span>
          </div>
          {view.clocks && view.status === "playing" && (
            <div className="flex items-center gap-3 font-pixel text-[11px]" data-testid="battle-clocks">
              <Timer className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              <span className={cn(view.clocks.you.deadline && view.clocks.you.deadline - now < 20_000 ? "text-destructive" : "text-foreground")}>
                You {view.clocks.you.deadline ? clock(view.clocks.you.deadline - now) : clock(view.clocks.you.bank)}
              </span>
              <span className="text-muted-foreground">Foe {view.clocks.foe.deadline ? clock(view.clocks.foe.deadline - now) : clock(view.clocks.foe.bank)}</span>
            </div>
          )}
          <div className="flex items-center gap-1">
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
            <button type="button" onClick={() => setShowLog((s) => !s)} className="ml-1 flex items-center gap-1 rounded-sm px-1.5 py-0.5 font-pixel text-[10px] text-muted-foreground hover:text-foreground lg:hidden" aria-expanded={showLog}>
              <ScrollText className="h-3 w-3" aria-hidden /> Log
            </button>
          </div>
        </div>

        <Stage snap={snap} me={me} doubles={doubles} popups={popups} onHandle={onHandle} myBalls={myBalls} />

        {/* The text box: the latest line of the battle. */}
        <div className="dialog-box min-h-[4.25rem] text-sm leading-relaxed text-muted-foreground" data-done={showControls} aria-live="polite" data-testid="battle-message">
          {message ? <RichText text={message} /> : <span>The battle is about to begin…</span>}
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <Card>
          <CardContent className="p-4">
            {showControls ? (
              <Controls key={view.request!.rqid} request={view.request!.data} snap={snap} me={me} doubles={doubles} busy={busy} onChoose={(choice) => onChoose(view.request!.rqid, choice)} />
            ) : ended ? (
              <div className="space-y-3 text-center" data-testid="battle-result">
                <p className={cn("font-display text-3xl font-bold uppercase", won ? "text-success" : tie ? "text-foreground" : "text-destructive")}>
                  {won ? "Victory!" : tie ? "A draw" : "Defeat"}
                </p>
                <p className="text-sm text-muted-foreground">
                  {view.end!.reason === "forfeit"
                    ? won
                      ? `${foeName} forfeited.`
                      : "You forfeited."
                    : view.end!.reason === "timeout"
                      ? won
                        ? `${foeName} ran out of time.`
                        : "You ran out of time."
                      : view.end!.reason === "left"
                        ? won
                          ? `${foeName} disconnected.`
                          : "You were disconnected."
                        : view.end!.reason === "nocontest"
                          ? "The battle couldn't go on."
                          : won
                            ? `You beat ${foeName} in ${snap.turn} turn${snap.turn === 1 ? "" : "s"}.`
                            : `${foeName} won in ${snap.turn} turn${snap.turn === 1 ? "" : "s"}.`}
                </p>
                {endActions}
              </div>
            ) : (
              <p className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground" data-testid="battle-waiting">
                {pending ? (
                  <>
                    <FastForward className="h-4 w-4 animate-pulse" aria-hidden /> Playing the turn…
                  </>
                ) : (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> {busy ? "Sending…" : view.cpu ? "The computer is thinking…" : `Waiting for ${foeName}…`}
                  </>
                )}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* The battle log. */}
      <aside className={cn("min-w-0 lg:block", showLog ? "block" : "hidden")} aria-label="Battle log">
        <Card className="lg:sticky lg:top-20">
          <CardContent className="p-0">
            <p className="hud-label flex items-center gap-1.5 border-b px-4 py-3">
              <ScrollText className="h-3 w-3" aria-hidden /> Battle log
            </p>
            <div className="max-h-[28rem] space-y-1 overflow-y-auto px-4 py-3 text-xs leading-relaxed text-muted-foreground lg:max-h-[calc(100vh-12rem)]" data-testid="battle-log">
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
      </aside>
    </div>
  );
}
