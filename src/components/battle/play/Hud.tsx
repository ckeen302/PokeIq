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

/**
 * The HP bar: drains smoothly when a hit lands, with a "damage ghost" (the
 * HP just lost, in red) trailing behind it and catching up a moment later.
 * Low HP (a fifth or less) pulses.
 */
export function HpBar({ hp, maxhp, className }: { hp: number; maxhp: number; className?: string }) {
  const fraction = maxhp ? Math.max(0, Math.min(1, hp / maxhp)) : 0;
  const color = hpColor(fraction);
  const low = fraction > 0 && fraction <= 0.2;
  return (
    <div className={cn("battle-hp relative h-2 overflow-hidden rounded-full bg-black/70 ring-1 ring-white/15", low && "battle-hp-low", className)} data-low={low || undefined}>
      <div className="battle-hp-ghost absolute inset-y-0 left-0 rounded-full" style={{ width: `${fraction * 100}%` }} />
      <div
        className="battle-hp-fill absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${fraction * 100}%`, background: `linear-gradient(180deg, color-mix(in srgb, ${color} 55%, white) 0%, ${color} 45%, color-mix(in srgb, ${color} 80%, black) 100%)`, boxShadow: `0 0 8px ${color}88` }}
      />
      {/* Tenths, like a game's HP gauge. */}
      <div className="pointer-events-none absolute inset-0 bg-[repeating-linear-gradient(90deg,transparent_0_calc(10%-1px),rgb(0_0_0/0.35)_calc(10%-1px)_10%)]" />
    </div>
  );
}

const genderMark = (g: string) => (g === "M" ? <span className="text-sky-300">♂</span> : g === "F" ? <span className="text-pink-300">♀</span> : null);

export function Hud({ mon, mine, compact }: { mon: MonSnap; mine: boolean; compact?: boolean }) {
  const status = STATUS_STYLE[mon.status];
  const percent = mon.maxhp ? Math.round((mon.hp / mon.maxhp) * 100) : 0;
  const boosts = Object.entries(mon.boosts).filter(([, v]) => v);
  const low = !mon.fainted && mon.maxhp > 0 && mon.hp / mon.maxhp <= 0.2;
  return (
    <div
      className={cn(
        "battle-hud pointer-events-auto relative overflow-hidden rounded-md border border-white/12 text-white shadow-[0_8px_24px_-8px_rgb(0_0_0/0.7)] backdrop-blur-md",
        mine ? "battle-hud-mine" : "battle-hud-foe",
        low && "battle-hud-low",
        compact ? "px-2 py-1" : "px-2.5 py-1.5"
      )}
      data-testid={mine ? "hud-mine" : "hud-foe"}
    >
      <div className="flex items-center gap-1.5">
        <span className={cn("min-w-0 flex-1 truncate font-display font-bold uppercase tracking-wide drop-shadow-[0_1px_0_rgb(0_0_0/0.6)]", compact ? "text-xs" : "text-sm")}>
          {mon.name} {genderMark(mon.gender)}
        </span>
        {mon.terastallized && (
          <span
            className="battle-chip inline-flex items-center gap-0.5 text-black"
            style={{ background: `linear-gradient(135deg, #fff 0%, ${teraColor(mon.terastallized)} 45%, color-mix(in srgb, ${teraColor(mon.terastallized)} 70%, black) 100%)` }}
            title={`Terastallized: ${mon.terastallized}`}
          >
            <span aria-hidden>◆</span> {mon.terastallized}
          </span>
        )}
        {status && <span className={cn("battle-chip", status.className)}>{status.label}</span>}
        <span className="rounded-sm bg-white/10 px-1 font-pixel text-[9px] leading-4 text-white/80">Lv{mon.level}</span>
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className="font-pixel text-[8px] text-warning">HP</span>
        <HpBar hp={mon.fainted ? 0 : mon.hp} maxhp={mon.maxhp} className={cn("flex-1", compact ? "h-2" : "h-2.5")} />
        <span className={cn("w-[4.5rem] text-right font-pixel text-[10px] tabular-nums", low ? "text-[#ff8a9a]" : "text-white/85")}>{mine ? `${mon.fainted ? 0 : mon.hp}/${mon.maxhp}` : `${mon.fainted ? 0 : percent}%`}</span>
      </div>
      {(boosts.length > 0 || mon.volatiles.length > 0) && (
        <div className="mt-1 flex flex-wrap gap-1">
          {boosts.map(([stat, v]) => (
            <span key={stat} className={cn("battle-chip", v > 0 ? "bg-emerald-400/90 text-black" : "bg-sky-400/90 text-black")}>
              {STAT_SHORT[stat] ?? stat} {v > 0 ? `+${v}` : v}
            </span>
          ))}
          {mon.volatiles.map((v) => (
            <span key={v} className="battle-chip bg-white/15 text-white/85">
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
          title={mon ? `${mon.name}${mon.fainted ? " (fainted)" : mon.status ? ` (${STATUS_STYLE[mon.status]?.label ?? mon.status})` : ""}` : "Not seen yet"}
          className={cn("battle-teamball inline-block h-3.5 w-3.5 rounded-full", !mon && "battle-teamball-unseen", mon?.fainted && "battle-teamball-fainted", mon && !mon.fainted && mon.status && "battle-teamball-status")}
        />
      ))}
    </div>
  );
}
