"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ChevronsRight, Download, Loader2, Pause, Play, RotateCcw, Swords, X } from "lucide-react";
import type { BattleView } from "@/lib/battle/play";
import { lastTurn, linesThrough, replayResult, type ReplayData } from "@/lib/battle/replay";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ShareReplay } from "./BattleAfter";
import { downloadReplay } from "./replay-download";

const BattleScreen = dynamic(() => import("./play/BattleScreen"), {
  ssr: false,
  loading: () => (
    <div className="flex aspect-[16/9] w-full items-center justify-center rounded-lg border bg-card">
      <Loader2 className="h-6 w-6 animate-spin text-screen" aria-label="Loading the replay" />
    </div>
  ),
});

// The analysis brings the simulator's tracker and the damage calc: loaded with the page, not in its first bundle.
const ReplayAnalysis = dynamic(() => import("./ReplayAnalysis").then((m) => m.ReplayAnalysis), { ssr: false });

/** A short pause between turns while playing, so each one reads as a turn. */
const BETWEEN_TURNS_MS = 450;

/**
 * A replay, played on the battle screen itself (the same sprites and
 * animations): play and pause, a turn back or forward, jump to any turn, and
 * the screen's own speed control (0.5× to 4×). Going forward animates the
 * turn; going back or jumping shows the battle as it stood at once.
 */
export function ReplayViewer({ replay, instant }: { replay: ReplayData; instant?: { onClose: () => void; timed?: boolean } }) {
  const last = useMemo(() => lastTurn(replay.log), [replay.log]);
  /** The turn whose start is on screen (0: nothing yet; last + 1: the end). */
  const [turn, setTurn] = useState(0);
  const [shown, setShown] = useState<{ lines: string[]; reset: number; instant?: boolean }>({ lines: [], reset: 0 });
  const [playing, setPlaying] = useState(false);
  const playingRef = useRef(false);
  const turnRef = useRef(0);
  const animating = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const end = last + 1;
  const atEnd = turn >= end;

  /** Shows the next turn, animated. */
  const forward = useCallback(() => {
    const next = turnRef.current + 1;
    if (next > end) return false;
    turnRef.current = next;
    setTurn(next);
    animating.current = true;
    setShown((s) => ({ lines: linesThrough(replay.log, next), reset: s.reset }));
    return true;
  }, [end, replay.log]);

  /** Shows turn `t` as it stood, at once. */
  const jump = useCallback(
    (t: number) => {
      const to = Math.max(0, Math.min(end, t));
      window.clearTimeout(timer.current);
      turnRef.current = to;
      setTurn(to);
      animating.current = false;
      setShown((s) => ({ lines: to === 0 ? [] : linesThrough(replay.log, to), reset: s.reset + 1, instant: true }));
    },
    [end, replay.log]
  );

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    window.clearTimeout(timer.current);
  }, []);

  const play = useCallback(() => {
    if (turnRef.current >= end) jump(0);
    playingRef.current = true;
    setPlaying(true);
    if (!animating.current) {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        if (playingRef.current && !forward()) pause();
      }, 0);
    }
  }, [end, forward, jump, pause]);

  // The screen's queue ran dry: the next turn, if playing.
  const onIdle = useCallback(() => {
    animating.current = false;
    if (!playingRef.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (playingRef.current && !forward()) pause();
    }, BETWEEN_TURNS_MS);
  }, [forward, pause]);

  useEffect(() => {
    if (atEnd && playing) pause();
  }, [atEnd, playing, pause]);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const view = useMemo<BattleView>(
    () => ({
      code: replay.id,
      kind: "pvp",
      format: replay.format,
      formatName: replay.formatName,
      status: atEnd ? "finished" : "playing",
      now: 0,
      rev: 0,
      you: null,
      players: replay.players.map((name, i) => ({ name, ready: true, quiet: false, hasTeam: true, ...(replay.ratings ? { rating: replay.ratings[i] } : {}), ...(replay.elos ? { elo: replay.elos[i] } : {}) })),
      turn: Math.min(turn, last),
      log: { from: 0, total: 0, lines: [] },
      request: null,
      waiting: false,
      ranked: replay.ranked,
      ...(atEnd ? { end: { reason: replay.reason, winner: replay.winner, at: 0 } } : {}),
    }),
    [replay, atEnd, turn, last]
  );

  const button = "flex h-9 items-center gap-1.5 rounded-md border bg-card px-3 font-display text-xs font-bold uppercase tracking-wider hover:border-screen/60 disabled:opacity-40";
  const toolbar = (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card/60 p-2" data-testid="replay-controls">
      <button type="button" className={button} onClick={() => jump(turn - 1)} disabled={turn <= 0} aria-label="Back a turn" data-testid="replay-back">
        <ChevronLeft className="h-4 w-4" aria-hidden /> Turn
      </button>
      {playing ? (
        <button type="button" className={cn(button, "border-primary text-primary")} onClick={pause} data-testid="replay-pause">
          <Pause className="h-4 w-4" aria-hidden /> Pause
        </button>
      ) : (
        <button type="button" className={cn(button, "border-primary bg-primary text-primary-foreground hover:brightness-110")} onClick={play} data-testid="replay-play">
          {atEnd ? <RotateCcw className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />} {atEnd ? "Replay" : "Play"}
        </button>
      )}
      <button
        type="button"
        className={button}
        onClick={() => {
          pause();
          // Mid-animation: skip the rest of this turn and show the next one as it stands.
          if (animating.current) jump(turnRef.current + 1);
          else forward();
        }}
        disabled={atEnd}
        aria-label="Forward a turn"
        data-testid="replay-forward"
      >
        Turn <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
      <button type="button" className={button} onClick={() => jump(end)} disabled={atEnd} data-testid="replay-end">
        End <ChevronsRight className="h-4 w-4" aria-hidden />
      </button>
      <label className="ml-auto flex min-w-[12rem] flex-1 items-center gap-2 sm:max-w-xs">
        <span className="hud-label shrink-0 tabular-nums" data-testid="replay-turn">
          {/* Step t shows the log up to turn t's start: turn t - 1 has played out. */}
          {turn === 0 ? "Start" : atEnd ? "End" : turn === 1 ? "Leads" : `Turn ${turn - 1}`} / {last}
        </span>
        <input
          type="range"
          min={0}
          max={end}
          value={turn}
          onChange={(e) => {
            pause();
            jump(Number(e.target.value));
          }}
          aria-label="Jump to a turn"
          className="w-full accent-[hsl(var(--primary))]"
          data-testid="replay-seek"
        />
      </label>
    </div>
  );

  const download = (kind: "html" | "log") =>
    void downloadReplay({ id: replay.id, format: replay.format, formatName: replay.formatName, players: replay.players, log: replay.log }, kind);
  const downloads = (
    <div className="flex flex-wrap items-center gap-2" data-testid="replay-downloads">
      <button type="button" className={button} onClick={() => download("html")} title="Showdown's replay file: opens in any browser and plays in Showdown's replay player" data-testid="replay-download">
        <Download className="h-4 w-4" aria-hidden /> Download replay
      </button>
      <button type="button" className={button} onClick={() => download("log")} title="The raw battle log (Showdown's protocol), one line per event" data-testid="replay-download-log">
        <Download className="h-4 w-4" aria-hidden /> Log
      </button>
    </div>
  );

  if (instant) {
    return (
      <div className="space-y-3" data-testid="instant-replay">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warning/50 bg-warning/10 px-3 py-2 text-sm">
          <span>
            <strong>Instant replay</strong> of this battle so far. {instant.timed ? "The battle goes on meanwhile: your turn timer keeps running." : "The battle waits for you."}
          </span>
          <button type="button" className={cn(button, "border-primary bg-primary text-primary-foreground")} onClick={instant.onClose} data-testid="instant-replay-close">
            <X className="h-4 w-4" aria-hidden /> Back to the battle
          </button>
        </div>
        <BattleScreen
          view={view}
          log={shown}
          offset={0}
          busy={false}
          error={null}
          onChoose={() => {}}
          replay
          onIdle={onIdle}
          toolbar={toolbar}
          endActions={
            <button type="button" className={cn(button, "mx-auto border-primary bg-primary text-primary-foreground")} onClick={instant.onClose}>
              <X className="h-4 w-4" aria-hidden /> Back to the battle
            </button>
          }
        />
        <div className="flex justify-end">{downloads}</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <BattleScreen
        view={view}
        log={shown}
        offset={0}
        busy={false}
        error={null}
        onChoose={() => {}}
        replay
        onIdle={onIdle}
        toolbar={toolbar}
        endActions={
          <div className="flex flex-wrap justify-center gap-2">
            <ShareReplay id={replay.id} result={replayResult(replay)} formatName={replay.formatName} size="default" />
            <Link href="/battle/replays" className={buttonVariants({ variant: "outline" })}>
              More replays
            </Link>
            <Link href="/battle/play" className={buttonVariants()}>
              <Swords className="h-4 w-4" aria-hidden /> Battle
            </Link>
          </div>
        }
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        {downloads}
        <ShareReplay id={replay.id} result={replayResult(replay)} formatName={replay.formatName} />
      </div>
      <ReplayAnalysis replay={replay} />
    </div>
  );
}
