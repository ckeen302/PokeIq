"use client";

import type { MonSnap, SideSnap } from "./model";
import { teraColor } from "./player";
import { cn } from "@/lib/utils";

/** A Pokémon's status box: name, level, HP bar (drains smoothly), status, Tera and stat stages. */

export const STATUS_STYLE: Record<string, { label: string; className: string }> = {
  brn: { label: "BRN", className: "bg-[#ee8130] text-white" },
  par: { label: "PAR", className: "bg-[#e6c228] text-black" },
  slp: { label: "SLP", className: "bg-[#8c8c9c] text-white" },
  frz: { label: "FRZ", className: "bg-[#6fc7e8] text-black" },
  psn: { label: "PSN", className: "bg-[#a33ea1] text-white" },
  tox: { label: "TOX", className: "bg-[#7a1f78] text-white" },
};

const STAT_SHORT: Record<string, string> = { atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe", accuracy: "Acc", evasion: "Eva" };

export function hpColor(fraction: number) {
  return fraction > 0.5 ? "#34d399" : fraction > 0.2 ? "#facc15" : "#f43f5e";
}

export function HpBar({ hp, maxhp, className }: { hp: number; maxhp: number; className?: string }) {
  const fraction = maxhp ? Math.max(0, Math.min(1, hp / maxhp)) : 0;
  return (
    <div className={cn("relative h-2 overflow-hidden rounded-full bg-black/60 ring-1 ring-white/15", className)}>
      <div
        className="absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-700 ease-out"
        style={{ width: `${fraction * 100}%`, background: hpColor(fraction), boxShadow: `0 0 8px ${hpColor(fraction)}88` }}
      />
    </div>
  );
}

const genderMark = (g: string) => (g === "M" ? <span className="text-sky-300">♂</span> : g === "F" ? <span className="text-pink-300">♀</span> : null);

export function Hud({ mon, mine, compact }: { mon: MonSnap; mine: boolean; compact?: boolean }) {
  const status = STATUS_STYLE[mon.status];
  const percent = mon.maxhp ? Math.round((mon.hp / mon.maxhp) * 100) : 0;
  const boosts = Object.entries(mon.boosts).filter(([, v]) => v);
  return (
    <div
      className={cn("pointer-events-auto rounded-md border border-l-4 border-white/15 bg-black/65 text-white shadow-lg backdrop-blur-sm", mine ? "border-l-primary" : "border-l-screen", compact ? "px-2 py-1" : "px-2.5 py-1.5")}
      data-testid={mine ? "hud-mine" : "hud-foe"}
    >
      <div className="flex items-center gap-1.5">
        <span className={cn("min-w-0 flex-1 truncate font-display font-bold uppercase tracking-wide", compact ? "text-xs" : "text-sm")}>
          {mon.name} {genderMark(mon.gender)}
        </span>
        {mon.terastallized && (
          <span className="rounded-sm px-1 font-pixel text-[9px] leading-4 text-black" style={{ background: teraColor(mon.terastallized) }} title={`Terastallized: ${mon.terastallized}`}>
            ◆ {mon.terastallized}
          </span>
        )}
        {status && <span className={cn("rounded-sm px-1 font-pixel text-[9px] leading-4", status.className)}>{status.label}</span>}
        <span className="font-pixel text-[10px] text-white/70">Lv{mon.level}</span>
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="font-pixel text-[8px] text-warning">HP</span>
        <HpBar hp={mon.fainted ? 0 : mon.hp} maxhp={mon.maxhp} className="flex-1" />
        <span className="w-[4.5rem] text-right font-pixel text-[10px] tabular-nums text-white/85">{mine ? `${mon.fainted ? 0 : mon.hp}/${mon.maxhp}` : `${mon.fainted ? 0 : percent}%`}</span>
      </div>
      {(boosts.length > 0 || mon.volatiles.length > 0) && (
        <div className="mt-1 flex flex-wrap gap-1">
          {boosts.map(([stat, v]) => (
            <span key={stat} className={cn("rounded-sm px-1 font-pixel text-[9px] leading-4", v > 0 ? "bg-emerald-500/80 text-black" : "bg-sky-500/80 text-black")}>
              {STAT_SHORT[stat] ?? stat} {v > 0 ? `+${v}` : v}
            </span>
          ))}
          {mon.volatiles.map((v) => (
            <span key={v} className="rounded-sm bg-white/15 px-1 font-pixel text-[9px] leading-4 text-white/85">
              {v}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export type Ball = Pick<MonSnap, "name" | "fainted" | "status"> | null;

/** Six Poké Balls: healthy, statused, fainted, or not seen yet. `balls` overrides (your own full team). */
export function TeamBalls({ side, align = "start", balls: given }: { side: SideSnap; align?: "start" | "end"; balls?: Ball[] }) {
  const total = Math.max(side.total, side.team.length);
  const balls = given ?? Array.from({ length: total }, (_, i) => side.team[i] ?? null);
  return (
    <div className={cn("flex gap-1", align === "end" && "justify-end")} aria-label={`${side.name}'s team`}>
      {balls.map((mon, i) => (
        <span
          key={i}
          title={mon ? `${mon.name}${mon.fainted ? " (fainted)" : ""}` : "Not seen yet"}
          className={cn(
            "inline-block h-3 w-3 rounded-full border border-black/60",
            !mon && "bg-white/20",
            mon && mon.fainted && "bg-slate-600 opacity-60",
            mon && !mon.fainted && !mon.status && "bg-[linear-gradient(180deg,#f43f5e_0_45%,#111_45%_55%,#f8fafc_55%)]",
            mon && !mon.fainted && mon.status && "bg-[linear-gradient(180deg,#facc15_0_45%,#111_45%_55%,#f8fafc_55%)]"
          )}
        />
      ))}
    </div>
  );
}
