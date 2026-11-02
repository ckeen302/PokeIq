"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Bot, Swords, Trophy } from "lucide-react";
import { CPU_LEVEL_INFO, PLAY_FORMAT_INFO, type BattleView } from "@/lib/battle/play";
import type { BattleVersusRecord, BattleVersusResponse } from "@/lib/battle/versus";
import { battleIdHeaders, ensureBattleId } from "@/lib/battle/replay-client";
import { seededTrainer, type TrainerConfig } from "@/lib/trainer/config";
import { Figure, History, VersusIntro, type VersusSide } from "@/components/duel/VersusIntro";
import { Avatar3D } from "@/components/trainer3d/Avatar3D";
import { webglAvailable } from "./arena/webgl";

/**
 * The versus screen before a battle's first turn (the duel's, shared with
 * PokéGuessr): both trainers' 3D characters squaring up (the computer gets a
 * trainer of its own), each with their battle record and ladder rating in
 * this format from their battle profile. A few seconds long; Skip, Space or
 * Enter ends it at once. The first turn plays out once it's gone.
 */

export const YOU_ACCENT = "#f0457f";
export const FOE_ACCENT = "#a78bfa";
/** How long the intro stays up unless skipped. */
export const VERSUS_MS = 3_400;

/** The computer's own trainer, one look per difficulty. */
export function cpuTrainer(level: string): TrainerConfig {
  const base = seededTrainer(`cpu:${level}`, 137);
  const look: Partial<TrainerConfig> =
    level === "hard"
      ? { top: "jacket", topColor: "black", topTrim: "red", accent: "red", closed: true, hat: "none", hair: "spiky", hairColor: "silver", eyes: "sharp", expr: "smug", bottoms: "pants", bottomsColor: "black", gloves: "full", glovesColor: "black", ball: "poke" }
      : level === "easy"
        ? { top: "tee", topColor: "sky", hat: "cap", hatColor: "sky", expr: "happy", bottoms: "shorts", bottomsColor: "navy", gloves: "none", ball: "poke" }
        : { top: "hoodie", topColor: "purple", topTrim: "white", hat: "visor", hatColor: "white", expr: "determined", bottoms: "joggers", bottomsColor: "charcoal", ball: "poke" };
  return { ...base, ...look };
}

/** A trainer without a 3D trainer of their own still gets one (the same one every time for their name). */
export const standIn = (name: string) => seededTrainer(`battle:${name.toLowerCase()}`);

const cache = new Map<string, Promise<BattleVersusResponse | null>>();

/** Your record and the named trainers' (accounts), for this format. undefined while loading. */
export function useBattleVersus(names: string[], format: string, enabled: boolean): BattleVersusResponse | null | undefined {
  const key = `${names.map((n) => n.toLowerCase()).sort().join(",")}|${format}`;
  const [data, setData] = useState<BattleVersusResponse | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let p = cache.get(key);
    if (!p) {
      const [list, f] = key.split("|");
      p = ensureBattleId()
        .then(() => fetch(`/api/battle/versus?names=${encodeURIComponent(list)}&format=${encodeURIComponent(f)}`, { headers: battleIdHeaders(), cache: "no-store" }))
        .then((r) => (r.ok ? (r.json() as Promise<BattleVersusResponse>) : null))
        .catch(() => null);
      cache.set(key, p);
    }
    void p.then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [key, enabled]);
  return data;
}

function RecordCard({ record, loading, rated }: { record: BattleVersusRecord | null | undefined; loading: boolean; rated: boolean }) {
  const dash = loading ? <span className="inline-block h-3 w-8 animate-pulse rounded bg-white/15 align-middle" aria-label="Loading" /> : "—";
  const rate = record && record.battles ? Math.round(((record.wins + record.draws / 2) / record.battles) * 100) : null;
  return (
    <div data-testid="versus-battle-record">
      <dl className="grid grid-cols-3 border-y border-white/10 text-center">
        <Figure label="Battles" value={record ? record.battles.toLocaleString("en-US") : dash} />
        <Figure label="Won" value={rate !== null ? `${rate}%` : record ? "—" : dash} className="border-l border-white/10" />
        <Figure label={rated ? "Rating" : "W–L"} value={rated ? (record?.elo !== undefined ? record.elo.toLocaleString("en-US") : record ? "—" : dash) : record ? `${record.wins}–${record.losses}` : dash} className="border-l border-white/10" />
      </dl>
      <div className="space-y-2 px-3 py-2.5 sm:px-4 sm:py-3">
        {record?.position ? <p className="font-display text-xs font-bold text-[#ffd23c] sm:text-sm">#{record.position} on the ladder</p> : null}
        <History recent={record?.recent} loading={loading} label="Last 5 battles" none="No battles yet" />
      </div>
    </div>
  );
}

function CpuCard({ level }: { level: string }) {
  const info = CPU_LEVEL_INFO[level as keyof typeof CPU_LEVEL_INFO];
  return (
    <div className="border-t border-white/10 px-3 py-2.5 sm:px-4 sm:py-3" data-testid="versus-cpu">
      <p className="font-pixel text-[8px] uppercase text-white/55 sm:text-[9px]">Difficulty</p>
      <p className="font-display text-lg font-extrabold uppercase leading-tight sm:text-2xl">{info?.name ?? level}</p>
      {info && <p className="mt-1 text-xs leading-snug text-white/70 sm:text-sm">{info.blurb}</p>}
    </div>
  );
}

export function BattleVersus({ view, onDone }: { view: BattleView; onDone: () => void }) {
  const youSeat = view.you ?? 0;
  const foeSeat = youSeat === 0 ? 1 : 0;
  const you = view.players[youSeat];
  const foe = view.players[foeSeat];
  const cpu = view.cpu?.level ?? null;
  const names = useMemo(() => (foe && !cpu && !foe.bot ? [foe.name] : []), [foe, cpu]);
  const data = useBattleVersus(names, view.format, true);
  const loading = data === undefined;
  const rated = !!view.ranked || PLAY_FORMAT_INFO[view.format]?.random === true;
  const [left, setLeft] = useState(3);
  // Without WebGL: no 3D trainers (their art, or a silhouette; the computer's badge).
  const [gl] = useState(webglAvailable);

  useEffect(() => {
    // The count starts once both trainers are drawn (or after a moment, whatever has loaded by then).
    const opened = Date.now();
    let t0 = 0;
    const id = window.setInterval(() => {
      const now = Date.now();
      if (!t0) {
        const drawn = document.querySelectorAll("[data-testid=battle-versus] [data-testid=versus-character] canvas, [data-testid=battle-versus] [data-testid=versus-character]:not([data-kind=trainer]):not([data-kind=figure])").length;
        if (drawn >= 2 || now - opened > 1_200) t0 = now;
        else return;
      }
      const gone = now - t0;
      setLeft(Math.max(1, 3 - Math.floor(gone / (VERSUS_MS / 3))));
      if (gone >= VERSUS_MS) onDone();
    }, 100);
    return () => window.clearInterval(id);
  }, [onDone]);

  const youSide: VersusSide = {
    name: you?.name ?? "You",
    you: true,
    avatar: you?.avatar ?? null,
    fallback: gl ? standIn(you?.name ?? "you") : undefined,
    stats: null,
    record: <RecordCard record={data ? data.you : null} loading={loading} rated={rated} />,
    accent: YOU_ACCENT,
  };
  const foeSide: VersusSide = cpu
    ? {
        name: foe?.name ?? "Computer",
        figure: gl ? (
          <Avatar3D config={cpuTrainer(cpu)} pose="fight" facing="left" label="The computer's trainer, ready to battle" />
        ) : (
          <span className="flex aspect-square w-[70%] items-center justify-center rounded-full border-4 border-white/40 bg-[radial-gradient(circle_at_35%_30%,#c4b5fd,#6d28d9_70%)] shadow-2xl" aria-hidden>
            <Bot className="h-1/2 w-1/2 text-white" />
          </span>
        ),
        tag: (
          <span className="inline-flex items-center gap-1 rounded-sm border border-white/30 bg-white/10 px-1.5 py-0.5 font-pixel text-[9px] uppercase text-white/90">
            <Bot className="h-3 w-3" aria-hidden /> Computer
          </span>
        ),
        stats: null,
        record: <CpuCard level={cpu} />,
        accent: FOE_ACCENT,
      }
    : {
        name: foe?.name ?? "Opponent",
        avatar: foe?.avatar ?? null,
        fallback: gl ? standIn(foe?.name ?? "opponent") : undefined,
        stats: null,
        record: <RecordCard record={data ? (data.names[(foe?.name ?? "").toLowerCase()] ?? null) : null} loading={loading && names.length > 0} rated={rated} />,
        accent: FOE_ACCENT,
      };

  const format = view.formatName ?? PLAY_FORMAT_INFO[view.format]?.name ?? "Battle";
  // On the body: a transformed ancestor would otherwise pin "fixed" to itself.
  return createPortal(
    <div className="fixed inset-0 z-[70] flex flex-col" data-testid="battle-versus" role="dialog" aria-label={`${youSide.name} versus ${foeSide.name}`}>
      <VersusIntro
        testId="battle-versus-intro"
        left={youSide}
        right={foeSide}
        title="Battle!"
        icon={view.ranked ? <Trophy className="h-8 w-8 text-[#ffd23c] sm:h-11 sm:w-11" aria-hidden /> : <Swords className="h-7 w-7 sm:h-10 sm:w-10" aria-hidden />}
        subtitle={
          <>
            {view.ranked ? "Ranked · " : ""}
            {format}
          </>
        }
        detail={view.frontier ? `Round ${view.frontier.round} · battle ${view.frontier.battle} of 7` : cpu ? `Against the computer · ${CPU_LEVEL_INFO[cpu].name}` : view.kind === "pvp" ? "Live battle" : undefined}
        countdown={
          <span key={left} className="geo-digit font-display text-6xl font-extrabold leading-none sm:text-8xl" data-testid="battle-versus-digit">
            {left}
          </span>
        }
        onSkip={onDone}
      />
    </div>,
    document.body
  );
}
