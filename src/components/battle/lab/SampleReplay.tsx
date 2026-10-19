"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, ListEnd, Pause, Play, X } from "lucide-react";
import { HpBar } from "@/components/game/HpBar";
import { BattleModel, textLines, type MonSnap, type Snap } from "@/components/battle/play/model";
import { Button } from "@/components/ui/button";
import type { LabReplay } from "@/lib/battle/lab/pool";
import { STATUS_NAMES, type LabStatus } from "@/lib/battle/lab/types";
import { cn } from "@/lib/utils";
import { BattleSprite } from "../BattleSprite";
import { SIDE_COLOR, Swatch } from "./charts";

/**
 * One battle of a run, replayed as text, turn by turn: Showdown's own battle
 * text (from the battle screen's model) with both sides' Pokémon and HP as
 * they stood at the end of each turn. Loaded only when a sample is asked for.
 */

interface Entry {
  turn: number;
  text: string;
  /** A "Turn N" heading. */
  heading?: boolean;
}

function readReplay(lines: string[]): { entries: Entry[]; snaps: Snap[]; turns: number } {
  const model = new BattleModel("p1");
  const entries: Entry[] = [];
  const snaps: Snap[] = [];
  let turn = 0;
  for (const line of lines) {
    const step = model.feed(line);
    if (!step) continue;
    if (step.cmd === "turn") {
      snaps[turn] = model.snapshot();
      turn = Number(step.args[1]) || turn + 1;
      entries.push({ turn, text: `Turn ${turn}`, heading: true });
      continue;
    }
    const text = step.text.trim();
    if (text) entries.push({ turn, text });
  }
  snaps[turn] = model.snapshot();
  // Fill any turn without its own snapshot with the one before.
  for (let t = 1; t <= turn; t++) snaps[t] ??= snaps[t - 1];
  return { entries, snaps, turns: turn };
}

function Rich({ text }: { text: string }) {
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

function MonLine({ mon, side }: { mon: MonSnap | null; side: 0 | 1 }) {
  if (!mon) return <div className="h-12" />;
  const status = mon.fainted ? "Fainted" : STATUS_NAMES[mon.status as LabStatus] ?? mon.status;
  return (
    <div className={cn("flex min-w-0 items-center gap-2", side === 1 && "flex-row-reverse text-right")}>
      <BattleSprite species={{ id: mon.speciesId, num: mon.num }} shiny={mon.shiny} animated={false} size={44} className={cn(mon.fainted && "opacity-30 grayscale")} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-sm font-bold">
          {mon.name} <span className="font-mono text-[11px] font-normal text-muted-foreground">Lv{mon.level}</span>
        </p>
        <HpBar value={mon.maxhp ? mon.hp / mon.maxhp : 0} />
        <p className="font-mono text-[10px] tabular-nums text-muted-foreground">
          {mon.hp}/{mon.maxhp}
          {mon.status || mon.fainted ? ` · ${status}` : ""}
          {Object.entries(mon.boosts).map(([stat, n]) => ` · ${stat} ${n > 0 ? "+" : ""}${n}`)}
        </p>
      </div>
    </div>
  );
}

export default function SampleReplay({ replay, labels, seed, onClose }: { replay: LabReplay; labels: [string, string]; seed: string; onClose: () => void }) {
  const { entries, snaps, turns } = useMemo(() => readReplay(replay.log), [replay.log]);
  const [turn, setTurn] = useState(Math.min(1, turns));
  const [playing, setPlaying] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const outcome = replay.record.outcome;

  useEffect(() => {
    if (!playing) return;
    if (turn >= turns) {
      setPlaying(false);
      return;
    }
    const id = window.setTimeout(() => setTurn((t) => Math.min(turns, t + 1)), 1100);
    return () => window.clearTimeout(id);
  }, [playing, turn, turns]);

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turn]);

  const snap = snaps[turn] ?? snaps[snaps.length - 1];
  const shown = entries.filter((e) => e.turn <= turn);
  const result = outcome === 2 ? (replay.record.capped ? "Stopped at the turn limit: a draw" : "A draw") : `${labels[outcome]} won in ${replay.record.turns} turn${replay.record.turns === 1 ? "" : "s"}`;

  return (
    <div className="space-y-3" data-testid="lab-replay">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-display text-lg font-bold uppercase tracking-wide">{result}</p>
          <p className="hud-label normal-case tracking-wider">
            Battle #{replay.index + 1} of the run · seed {seed} · the same battle every time
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close the replay">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
      {replay.misses.length > 0 && (
        <ul className="text-xs text-warning">
          {replay.misses.map((m) => (
            <li key={m}>{m}</li>
          ))}
        </ul>
      )}

      {snap && (
        <div className="screen grid grid-cols-2 gap-4 rounded-lg p-3">
          {([0, 1] as const).map((s) => {
            const side = snap.sides[s === 0 ? "p1" : "p2"];
            // A slot left empty by a faint at the end shows who fainted there.
            const shown = side.active.some(Boolean) ? side.active : side.team.filter((m) => m.fainted).slice(-Math.max(1, side.active.length));
            return (
              <div key={s} className="relative z-[3] min-w-0 space-y-2">
                <p className={cn("hud-label flex items-center gap-1.5", s === 1 && "justify-end")}>
                  <Swatch color={SIDE_COLOR[s]} /> {labels[s]}
                </p>
                {shown.map((mon, i) => (
                  <MonLine key={i} mon={mon} side={s} />
                ))}
                {side.team.length > side.active.length && (
                  <p className={cn("font-mono text-[10px] text-muted-foreground", s === 1 && "text-right")}>
                    {side.team.filter((m) => !m.fainted).length} of {side.total} still standing
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setTurn((t) => Math.max(0, t - 1))} disabled={turn <= 0} aria-label="Previous turn">
          <ChevronLeft className="h-4 w-4" aria-hidden />
        </Button>
        <span className="min-w-[7.5rem] text-center font-mono text-sm tabular-nums" aria-live="polite">
          {turn === 0 ? "Start" : `Turn ${turn} of ${turns}`}
        </span>
        <Button size="sm" variant="outline" onClick={() => setTurn((t) => Math.min(turns, t + 1))} disabled={turn >= turns} aria-label="Next turn">
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
        <Button size="sm" variant="secondary" onClick={() => (turn >= turns ? (setTurn(0), setPlaying(true)) : setPlaying((p) => !p))}>
          {playing ? <Pause className="h-4 w-4" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />} {playing ? "Pause" : "Play"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setTurn(turns)} disabled={turn >= turns}>
          <ListEnd className="h-4 w-4" aria-hidden /> Show all
        </Button>
      </div>

      <div ref={logRef} className="max-h-80 space-y-1 overflow-y-auto rounded-md border bg-shade/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground" data-testid="lab-replay-log">
        {shown.map((e, i) =>
          e.heading ? (
            <p key={i} className="hud-label pt-2 text-screen">
              {e.text}
            </p>
          ) : (
            <div key={i}>
              <Rich text={e.text} />
            </div>
          )
        )}
      </div>
    </div>
  );
}
