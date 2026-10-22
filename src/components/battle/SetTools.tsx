"use client";

import { useMemo, useState } from "react";
import { Crosshair, LoaderCircle, Plus, Sparkles, Target, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FormatDex } from "@/lib/battle/dex";
import { hasTera } from "@/lib/battle/formats";
import { applySpread, optimizeSpread, type EvGoal, type OptimizeResult } from "@/lib/battle/ev-goals";
import type { TeamSet } from "@/lib/battle/sets";
import { findUsage, popularSets, speedBenchmarks, spreadLabel, USAGE_SOURCE, type UsageFile } from "@/lib/battle/usage";
import { cn } from "@/lib/utils";
import { inputClass, NumberInput } from "./controls";
import { useCalc } from "./hooks";

/**
 * Set editor helpers: one-click popular sets for the species (built from
 * the format's usage statistics) and goal-based EV spreads (survive an
 * attack, outspeed a Pokémon), solved with the damage calc.
 */

const isStatus = (dex: FormatDex) => (move: string) => dex.gen.moves.get(move)?.category === "Status";

export function PopularSets({ dex, usage, set, onChange }: { dex: FormatDex; usage: UsageFile | null; set: TeamSet; onChange: (set: TeamSet) => void }) {
  const mon = usage ? findUsage(usage, set.species) : undefined;
  const options = useMemo(
    () => (mon ? popularSets(mon, { level: dex.format.level, tera: hasTera(dex.format), isStatus: isStatus(dex) }) : []),
    [mon, dex]
  );
  if (!usage) return null;
  if (!options.length) return <p className="text-xs text-muted-foreground">No usage data for {set.species} in {dex.format.name}.</p>;
  return (
    <div className="space-y-1.5" data-testid="popular-sets">
      <span className="hud-label flex items-center gap-1">
        <Sparkles className="h-3 w-3" aria-hidden /> Popular sets
      </span>
      <div className="space-y-1">
        {options.map((o, i) => (
          <button
            key={i}
            type="button"
            onClick={() => onChange({ ...o.set, name: set.name, shiny: set.shiny, gender: set.gender, level: set.level })}
            className="w-full rounded-md border border-foreground/10 px-2 py-1.5 text-left text-xs transition-colors hover:border-screen/60 hover:bg-screen/5"
            title={o.set.moves.join(" / ")}
          >
            <span className="block font-semibold">{o.label}</span>
            <span className="block truncate text-muted-foreground">
              {o.set.moves.join(" · ")} · {Math.round(o.share * 100)}% use this spread
            </span>
          </button>
        ))}
      </div>
      <p className="text-[11px] leading-snug text-muted-foreground">The most common choices from {USAGE_SOURCE}, not a written set.</p>
    </div>
  );
}

type Draft = { kind: "survive"; species: string; move: string } | { kind: "outspeed"; species: string; speed: number; label: string };

export function EvGoals({ dex, usage, set, onChange }: { dex: FormatDex; usage: UsageFile | null; set: TeamSet; onChange: (set: TeamSet) => void }) {
  const calc = useCalc(dex.gen.num);
  const [open, setOpen] = useState(false);
  const [goals, setGoals] = useState<Draft[]>([]);
  const [result, setResult] = useState<OptimizeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const mons = useMemo(() => (usage?.pokemon ?? []).filter((m) => dex.gen.species.get(m.species)), [usage, dex]);

  const attackerSet = (species: string) => {
    const mon = mons.find((m) => m.species === species);
    return mon ? popularSets(mon, { level: dex.format.level, tera: false, isStatus: isStatus(dex) })[0] : undefined;
  };
  const damaging = (species: string) => {
    const mon = mons.find((m) => m.species === species);
    return (mon?.moves ?? []).map(([m]) => m).filter((m) => {
      const move = dex.gen.moves.get(m);
      return move && move.category !== "Status";
    });
  };
  const speeds = (species: string) => {
    const mon = mons.find((m) => m.species === species);
    const sp = dex.gen.species.get(species);
    return mon && sp ? speedBenchmarks(mon, sp.baseStats.spe, dex.format.level) : [];
  };

  if (dex.gen.num <= 2) return null;
  const update = (i: number, d: Draft | null) => {
    setResult(null);
    setGoals((g) => (d ? g.map((x, j) => (j === i ? d : x)) : g.filter((_, j) => j !== i)));
  };

  function solve() {
    if (!calc) return;
    setBusy(true);
    // Let the spinner paint before the calc runs.
    setTimeout(() => {
      const built: EvGoal[] = [];
      for (const g of goals) {
        if (g.kind === "outspeed") built.push({ kind: "outspeed", speed: g.speed, label: g.label });
        else {
          const a = attackerSet(g.species);
          if (a && g.move) built.push({ kind: "survive", attacker: { ...a.set, moves: [g.move] }, move: g.move });
        }
      }
      setResult(optimizeSpread(calc, set, built));
      setBusy(false);
    }, 10);
  }

  const first = mons[0]?.species ?? "";
  return (
    <div className="mt-3 border-t pt-3" data-testid="ev-goals">
      <button type="button" onClick={() => setOpen(!open)} className="hud-label flex items-center gap-1.5 hover:text-foreground" aria-expanded={open}>
        <Target className="h-3.5 w-3.5" aria-hidden /> EV goals {open ? "▾" : "▸"}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">
            Pick what this Pokémon must do; the damage calc finds the fewest HP, Def, SpD and Spe EVs (and the best nature) that do it. &ldquo;Survive&rdquo; means every damage roll from full
            HP, no critical hit. Attackers use their most common set ({USAGE_SOURCE}).
          </p>
          {goals.map((g, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-foreground/10 p-2 text-xs">
              {g.kind === "survive" ? <Crosshair className="h-3.5 w-3.5 text-destructive" aria-hidden /> : <Target className="h-3.5 w-3.5 text-screen" aria-hidden />}
              <span className="font-semibold">{g.kind === "survive" ? "Survive" : "Outspeed"}</span>
              {mons.length > 0 && (
                <select
                  value={g.species}
                  onChange={(e) => {
                    const species = e.target.value;
                    if (g.kind === "survive") update(i, { kind: "survive", species, move: damaging(species)[0] ?? "" });
                    else {
                      const s = speeds(species)[0];
                      update(i, { kind: "outspeed", species, speed: s?.speed ?? g.speed, label: s ? `${species} (${s.label})` : g.label });
                    }
                  }}
                  className={cn(inputClass, "h-8 w-40")}
                  aria-label="Pokémon"
                >
                  {mons.map((m) => (
                    <option key={m.species} value={m.species}>
                      {m.species}
                    </option>
                  ))}
                </select>
              )}
              {g.kind === "survive" ? (
                <select value={g.move} onChange={(e) => update(i, { ...g, move: e.target.value })} className={cn(inputClass, "h-8 w-40")} aria-label="Attack">
                  {damaging(g.species).map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  {speeds(g.species).length > 0 && (
                    <select
                      value={g.speed}
                      onChange={(e) => {
                        const s = speeds(g.species).find((x) => x.speed === Number(e.target.value));
                        if (s) update(i, { ...g, speed: s.speed, label: `${g.species} (${s.label})` });
                      }}
                      className={cn(inputClass, "h-8 w-52")}
                      aria-label="Common speed"
                    >
                      {speeds(g.species).map((s) => (
                        <option key={s.label} value={s.speed}>
                          {s.speed} · {s.label} ({Math.round(s.share * 100)}%)
                        </option>
                      ))}
                    </select>
                  )}
                  <span className="flex items-center gap-1">
                    or Speed
                    <span className="w-20">
                      <NumberInput label="Speed to beat" value={g.speed} min={1} max={999} onChange={(speed) => update(i, { ...g, speed, label: `${speed} Speed` })} />
                    </span>
                  </span>
                </>
              )}
              <button type="button" onClick={() => update(i, null)} className="ml-auto text-muted-foreground hover:text-destructive" aria-label="Remove goal">
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            {mons.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => update(goals.length, { kind: "survive", species: first, move: damaging(first)[0] ?? "" })} disabled={goals.length >= 4}>
                <Plus className="h-4 w-4" aria-hidden /> Survive an attack
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const s = first ? speeds(first)[0] : undefined;
                update(goals.length, { kind: "outspeed", species: first, speed: s?.speed ?? 300, label: s ? `${first} (${s.label})` : "300 Speed" });
              }}
              disabled={goals.length >= 4}
            >
              <Plus className="h-4 w-4" aria-hidden /> Outspeed
            </Button>
            <Button size="sm" onClick={solve} disabled={!goals.length || !calc || busy} data-testid="ev-solve">
              {busy || !calc ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Target className="h-4 w-4" aria-hidden />} Find spread
            </Button>
          </div>
          {result &&
            (result.ok ? (
              <div className="space-y-1 rounded-md border border-success/40 bg-success/10 p-2 text-xs" data-testid="ev-result">
                <p className="font-semibold">
                  {spreadLabel(result.nature, result.evs)} · {result.used} EVs, {result.remaining} left over
                </p>
                <ul className="text-muted-foreground">
                  {result.checks.map((c, i) => (
                    <li key={i}>{c.detail}</li>
                  ))}
                </ul>
                <Button size="sm" variant="outline" onClick={() => onChange(applySpread(set, result.nature, result.evs))}>
                  Apply to this set
                </Button>
              </div>
            ) : (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive" role="alert" data-testid="ev-result">
                {result.reason}
              </p>
            ))}
        </div>
      )}
    </div>
  );
}
