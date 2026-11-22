"use client";

import type { Generation, Nature } from "@pkmn/data";
import type { StatKey } from "@/lib/pokemon/constants";
import { evLimit, fitStatsToGen, fromDV, hasDVs, MAX_DV, MAX_EVS, MAX_IV, natureFor, STATS, toDV, USEFUL_TOTAL_EVS, type StatsTable } from "@/lib/battle/sets";
import { cn } from "@/lib/utils";
import { NumberInput } from "./controls";
import { useT } from "@/i18n/client";
import battleTeams from "@/messages/battle-teams";
import battleTerms from "@/messages/battle-terms";
// Phones: the EV slider gets its own full-width line under the stat's row, so it is wide enough to drag.
const GRID = "grid grid-cols-[40px_30px_minmax(0,1fr)_52px_44px_44px] items-center gap-2 max-sm:grid-cols-[40px_30px_minmax(0,1fr)_minmax(0,1fr)_44px]";

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
  const t = useT(battleTeams);
  const st = useT(battleTerms);
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
  const label = (s: StatKey) => (gen.num === 1 && s === "spa" ? st("short.spc") : st(`short.${s}`));
  const canNature = gen.num >= 3 && !!natures && !!onNature;
  const over = hardLimit !== null && total > hardLimit;

  return (
    <div className="space-y-2">
      <div className={cn(GRID, "hud-label")}>
        <span title={canNature ? t("stats.natureHint") : undefined}>{t("stats.stat")}</span>
        <span className="text-right">{t("stats.base")}</span>
        <span className="max-sm:hidden">{dvs ? t("stats.statExp") : t("stats.evs")}</span>
        <span className="text-center">{t("stats.ev")}</span>
        <span className="text-center">{dvs ? t("stats.dv") : t("stats.iv")}</span>
        <span className="text-right">{t("stats.total")}</span>
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
                title={t("stats.natureTitle", { stat: st(`stat.${s}`) })}
                aria-label={t("stats.natureLabel", { stat: st(`stat.${s}`), mark: plus ? "plus" : minus ? "minus" : "none" })}
                data-nature={plus ? "plus" : minus ? "minus" : undefined}
                className={cn(
                  "-mx-1 rounded px-1 text-left font-semibold transition-colors hover:bg-foreground/10 max-md:py-2",
                  plus && "bg-success/15 text-success",
                  minus && "bg-destructive/15 text-destructive"
                )}
              >
                {name}
              </button>
            ) : (
              <span className={cn("font-semibold", plus && "text-success", minus && "text-destructive")} title={st(`stat.${s}`)}>
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
              aria-label={t("stats.evsLabel", { stat: st(`stat.${s}`) })}
              onChange={(e) => setEv(s, Number(e.target.value))}
              className="h-2 w-full cursor-pointer accent-[hsl(var(--primary))] disabled:cursor-not-allowed disabled:opacity-50 max-sm:col-span-full max-sm:row-start-2 max-sm:h-6"
            />
            {follows(s) ? (
              <span className="text-center font-mono text-xs tabular-nums text-muted-foreground" title={t("stats.specialExp")}>
                {evs[s]}
              </span>
            ) : (
              <NumberInput label={t("stats.evsLabel", { stat: st(`stat.${s}`) })} value={evs[s]} min={0} max={cap(s)} onChange={(v) => setEv(s, v)} />
            )}
            {dvs && (s === "hp" || s === "spd") ? (
              <span className="text-center font-mono text-xs tabular-nums text-muted-foreground" title={s === "hp" ? t("stats.hpDv") : t("stats.specialDv")}>
                {toDV(ivs[s])}
              </span>
            ) : (
              <NumberInput
                label={t("stats.ivsLabel", { stat: st(`stat.${s}`), kind: dvs ? "dv" : "iv" })}
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
            ? t("stats.upTo", { max: MAX_EVS })
            : over
              ? t("stats.over", { total, limit, over: total - hardLimit!, hard: hardLimit! })
              : left < 0
                ? t("stats.wasted", { total, limit, n: -left })
                : t("stats.left", { total, limit, n: left })}
        </span>
        <span className="flex gap-1.5">
          <button type="button" onClick={() => onEvs({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 })} className="tap hud-label hover:text-foreground">
            {t("stats.clear")}
          </button>
          <span className="hud-label">·</span>
          <button
            type="button"
            onClick={() => onIvs({ hp: MAX_IV, atk: MAX_IV, def: MAX_IV, spa: MAX_IV, spd: MAX_IV, spe: MAX_IV })}
            className="tap hud-label hover:text-foreground"
          >
            {dvs ? t("stats.maxDvs") : t("stats.maxIvs")}
          </button>
        </span>
      </div>
    </div>
  );
}
