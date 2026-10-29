"use client";

import type { Generation, Nature } from "@pkmn/data";
import { STAT_LABELS, type StatKey } from "@/lib/pokemon/constants";
import { evLimit, fitStatsToGen, fromDV, hasDVs, MAX_DV, MAX_EVS, MAX_IV, natureFor, STATS, toDV, USEFUL_TOTAL_EVS, type StatsTable } from "@/lib/battle/sets";
import { cn } from "@/lib/utils";
import { NumberInput } from "./controls";

const SHORT: Record<StatKey, string> = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };
const GRID = "grid grid-cols-[40px_30px_minmax(0,1fr)_52px_44px_44px] items-center gap-2";

/**
 * EV sliders and IV boxes per stat, with the stats they come to at this
 * level and nature, under the generation's rules: 508 usable EVs from
 * Gen 3 (the validator allows 510, but the last 2 do nothing); in Gen 1-2,
 * DVs (0-15) and stat experience in every stat, one Special (Gen 1 shows it
 * as Spc), and an HP DV that follows from the others. Clicking a stat's
 * name sets the nature's + and −.
 */
export function StatEditor({
  gen,
  base,
  evs,
  ivs,
  level,
  nature,
  natures,
  onEvs,
  onIvs,
  onNature,
}: {
  gen: Generation;
  base: StatsTable;
  evs: StatsTable;
  ivs: StatsTable;
  level: number;
  nature: Nature | undefined;
  natures?: readonly Nature[];
  onEvs: (evs: StatsTable) => void;
  onIvs: (ivs: StatsTable) => void;
  onNature?: (nature: string) => void;
}) {
  const dvs = hasDVs(gen.num);
  const limit = evLimit(gen.num) === null ? null : USEFUL_TOTAL_EVS;
  const hardLimit = evLimit(gen.num);
  const total = STATS.reduce((sum, s) => sum + evs[s], 0);
  const left = limit === null ? Infinity : limit - total;
  // Each stat can take what's left of the 508, up to 252 (never less than it already has).
  const cap = (s: StatKey) => Math.min(MAX_EVS, evs[s] + Math.max(0, left));
  const fit = (next: { evs: StatsTable; ivs: StatsTable }) => fitStatsToGen(next, gen.num);
  const setEv = (s: StatKey, v: number) => onEvs(fit({ evs: { ...evs, [s]: Math.max(0, Math.min(cap(s), v)) }, ivs }).evs);
  const setIv = (s: StatKey, v: number) => onIvs(fit({ evs, ivs: { ...ivs, [s]: dvs ? fromDV(v) : v } }).ivs);
  // Gen 1-2: one Special stat (SpD follows SpA) and a derived HP DV.
  const follows = (s: StatKey) => dvs && s === "spd";
  const rows = gen.num === 1 ? STATS.filter((s) => s !== "spd") : STATS;
  const label = (s: StatKey) => (gen.num === 1 && s === "spa" ? "Spc" : SHORT[s]);
  const canNature = gen.num >= 3 && !!natures && !!onNature;
  const over = hardLimit !== null && total > hardLimit;

  return (
    <div className="space-y-2">
      <div className={cn(GRID, "hud-label")}>
        <span title={canNature ? "Click a stat to set the nature's + and −" : undefined}>Stat</span>
        <span className="text-right">Base</span>
        <span>{dvs ? "Stat Exp" : "EVs"}</span>
        <span className="text-center">EV</span>
        <span className="text-center">{dvs ? "DV" : "IV"}</span>
        <span className="text-right">Total</span>
      </div>
      {rows.map((s) => {
        const value = gen.stats.calc(s, base[s], ivs[s], evs[s], level, nature);
        const plus = nature?.plus === s && nature.minus !== s;
        const minus = nature?.minus === s && nature.plus !== s;
        const name = (
          <>
            {label(s)}
            <span className="inline-block w-2 text-center">{plus ? "+" : minus ? "−" : ""}</span>
          </>
        );
        // Bar hue runs red (low) to green/cyan (high), like Showdown's stat bars.
        const hue = Math.min(180, Math.floor((value * 180) / (s === "hp" ? 600 : 450)));
        return (
          <div key={s} className={cn(GRID, "text-sm")} data-stat={s}>
            {canNature && s !== "hp" ? (
              <button
                type="button"
                onClick={() => {
                  const next = natureFor(natures!, nature, s);
                  if (next) onNature!(next.name);
                }}
                title={`${STAT_LABELS[s]}: click to set the nature's + / −`}
                aria-label={`${STAT_LABELS[s]}${plus ? " (boosted by nature)" : minus ? " (lowered by nature)" : ""}: change nature`}
                data-nature={plus ? "plus" : minus ? "minus" : undefined}
                className={cn(
                  "-mx-1 rounded px-1 text-left font-semibold transition-colors hover:bg-foreground/10",
                  plus && "bg-success/15 text-success",
                  minus && "bg-destructive/15 text-destructive"
                )}
              >
                {name}
              </button>
            ) : (
              <span className={cn("font-semibold", plus && "text-success", minus && "text-destructive")} title={STAT_LABELS[s]}>
                {name}
              </span>
            )}
            <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">{base[s]}</span>
            <input
              type="range"
              min={0}
              max={MAX_EVS}
              step={4}
              value={evs[s]}
              disabled={follows(s)}
              aria-label={`${STAT_LABELS[s]} EVs`}
              onChange={(e) => setEv(s, Number(e.target.value))}
              className="h-2 w-full cursor-pointer accent-[hsl(var(--primary))] disabled:cursor-not-allowed disabled:opacity-50"
            />
            {follows(s) ? (
              <span className="text-center font-mono text-xs tabular-nums text-muted-foreground" title="Special stat experience">
                {evs[s]}
              </span>
            ) : (
              <NumberInput label={`${STAT_LABELS[s]} EVs`} value={evs[s]} min={0} max={cap(s)} onChange={(v) => setEv(s, v)} />
            )}
            {dvs && (s === "hp" || s === "spd") ? (
              <span className="text-center font-mono text-xs tabular-nums text-muted-foreground" title={s === "hp" ? "Follows from the other DVs" : "The Special DV"}>
                {toDV(ivs[s])}
              </span>
            ) : (
              <NumberInput
                label={`${STAT_LABELS[s]} ${dvs ? "DVs" : "IVs"}`}
                value={dvs ? toDV(ivs[s]) : ivs[s]}
                min={0}
                max={dvs ? MAX_DV : MAX_IV}
                onChange={(v) => setIv(s, v)}
              />
            )}
            <span className="flex flex-col items-end gap-0.5" data-testid={`stat-${s}`}>
              <span className={cn("font-mono font-bold leading-none tabular-nums", plus && "text-success", minus && "text-destructive")}>{value}</span>
              <span aria-hidden className="h-[3px] w-full overflow-hidden rounded-full bg-foreground/10">
                <span
                  className="block h-full rounded-full"
                  style={{ width: `${Math.min(100, (value / (s === "hp" ? 600 : 450)) * 100)}%`, background: `hsl(${hue} 80% 50%)` }}
                />
              </span>
            </span>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-foreground/[0.07] pt-2 text-xs">
        <span className={cn("font-mono tabular-nums", over ? "text-destructive" : left < 0 ? "text-warning" : "text-muted-foreground")} data-testid="ev-total">
          {limit === null
            ? `Up to ${MAX_EVS} in every stat`
            : over
              ? `EVs ${total} / ${limit} · ${total - hardLimit!} over the ${hardLimit} limit`
              : left < 0
                ? `EVs ${total} / ${limit} · the last ${-left} do nothing`
                : `EVs ${total} / ${limit} · ${left} left`}
        </span>
        <span className="flex gap-1.5">
          <button type="button" onClick={() => onEvs({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 })} className="hud-label hover:text-foreground">
            Clear EVs
          </button>
          <span className="hud-label">·</span>
          <button
            type="button"
            onClick={() => onIvs({ hp: MAX_IV, atk: MAX_IV, def: MAX_IV, spa: MAX_IV, spd: MAX_IV, spe: MAX_IV })}
            className="hud-label hover:text-foreground"
          >
            {dvs ? "Max DVs" : "Max IVs"}
          </button>
        </span>
      </div>
    </div>
  );
}
