"use client";

import type { Generation, Nature } from "@pkmn/data";
import { STAT_LABELS, type StatKey } from "@/lib/pokemon/constants";
import { evLimit, fitStatsToGen, fromDV, hasDVs, MAX_DV, MAX_EVS, MAX_IV, STATS, toDV, type StatsTable } from "@/lib/battle/sets";
import { cn } from "@/lib/utils";
import { NumberInput } from "./controls";

const SHORT: Record<StatKey, string> = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };

/**
 * EV sliders and IV boxes per stat, with the stats they come to at this
 * level and nature, under the generation's rules: 510 EVs at most from
 * Gen 3; in Gen 1-2, DVs (0-15) and stat experience in every stat, one
 * Special (Gen 1 shows it as Spc), and an HP DV that follows from the others.
 */
export function StatEditor({
  gen,
  base,
  evs,
  ivs,
  level,
  nature,
  onEvs,
  onIvs,
}: {
  gen: Generation;
  base: StatsTable;
  evs: StatsTable;
  ivs: StatsTable;
  level: number;
  nature: Nature | undefined;
  onEvs: (evs: StatsTable) => void;
  onIvs: (ivs: StatsTable) => void;
}) {
  const dvs = hasDVs(gen.num);
  const limit = evLimit(gen.num);
  const total = STATS.reduce((sum, s) => sum + evs[s], 0);
  const left = limit === null ? Infinity : limit - total;
  // Each stat can take what's left of the limit, up to 252.
  const cap = (s: StatKey) => Math.min(MAX_EVS, evs[s] + Math.max(0, left));
  const fit = (next: { evs: StatsTable; ivs: StatsTable }) => fitStatsToGen(next, gen.num);
  const setEv = (s: StatKey, v: number) => onEvs(fit({ evs: { ...evs, [s]: Math.max(0, Math.min(cap(s), v)) }, ivs }).evs);
  const setIv = (s: StatKey, v: number) => onIvs(fit({ evs, ivs: { ...ivs, [s]: dvs ? fromDV(v) : v } }).ivs);
  // Gen 1-2: one Special stat (SpD follows SpA) and a derived HP DV.
  const follows = (s: StatKey) => dvs && s === "spd";
  const rows = gen.num === 1 ? STATS.filter((s) => s !== "spd") : STATS;
  const label = (s: StatKey) => (gen.num === 1 && s === "spa" ? "Spc" : SHORT[s]);

  return (
    <div className="space-y-2">
      <div className="hud-label grid grid-cols-[34px_30px_minmax(0,1fr)_52px_44px_40px] items-center gap-2">
        <span>Stat</span>
        <span className="text-right">Base</span>
        <span>{dvs ? "Stat Exp" : "EVs"}</span>
        <span className="text-center">EV</span>
        <span className="text-center">{dvs ? "DV" : "IV"}</span>
        <span className="text-right">Total</span>
      </div>
      {rows.map((s) => {
        const value = gen.stats.calc(s, base[s], ivs[s], evs[s], level, nature);
        const plus = nature?.plus === s;
        const minus = nature?.minus === s;
        return (
          <div key={s} className="grid grid-cols-[34px_30px_minmax(0,1fr)_52px_44px_40px] items-center gap-2 text-sm">
            <span className={cn("font-semibold", plus && "text-success", minus && "text-destructive")} title={STAT_LABELS[s]}>
              {label(s)}
              {plus ? "+" : minus ? "−" : ""}
            </span>
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
              <span className="text-center font-mono text-xs tabular-nums text-muted-foreground" title="Special stat experience">{evs[s]}</span>
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
            <span className="text-right font-mono font-bold tabular-nums">{value}</span>
          </div>
        );
      })}
      <div className="flex items-center justify-between gap-2 border-t border-foreground/[0.07] pt-2 text-xs">
        <span className={cn("font-mono tabular-nums", left < 0 ? "text-destructive" : "text-muted-foreground")}>
          {limit === null ? `Up to ${MAX_EVS} in every stat` : `EVs ${total} / ${limit} · ${left >= 0 ? `${left} left` : `${-left} over`}`}
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
