"use client";

import { useEffect, useMemo, useState } from "react";
import type { Generations } from "@pkmn/data";
import { ArrowLeftRight, Check, ClipboardCopy, LoaderCircle } from "lucide-react";
import {
  calcMoves,
  emptyField,
  emptySide,
  FIELD_FLAGS,
  TERRAINS,
  WEATHERS,
  type CalcField,
  type CalcLine,
  type CalcModule,
  type CalcSide,
} from "@/lib/battle/calc";
import { byDexNumber, loadCalcGenerations } from "@/lib/battle/dex";
import { BATTLE_FORMATS } from "@/lib/battle/formats";
import { cn } from "@/lib/utils";
import { CalcPanel, type CalcLists } from "./CalcPanel";
import { inputClass, Toggle } from "./controls";
import { BattleType, CategoryTag } from "./pickers";

const GENS = [9, 8, 7, 6, 5, 4, 3];

/** A standard opener: Garchomp into Heatran. */
const DEFAULT_SIDES: [CalcSide, CalcSide] = [
  {
    ...emptySide("Garchomp"),
    ability: "Rough Skin",
    item: "Life Orb",
    nature: "Jolly",
    evs: { hp: 0, atk: 252, def: 0, spa: 0, spd: 4, spe: 252 },
    teraType: "Ground",
    moves: ["Earthquake", "Dragon Claw", "Stone Edge", "Fire Fang"],
  },
  {
    ...emptySide("Heatran"),
    ability: "Flash Fire",
    item: "Leftovers",
    nature: "Calm",
    evs: { hp: 252, atk: 0, def: 4, spa: 0, spd: 252, spe: 0 },
    teraType: "Grass",
    moves: ["Magma Storm", "Earth Power", "Flash Cannon", "Stealth Rock"],
  },
];

export function DamageCalc() {
  const [lib, setLib] = useState<{ calc: CalcModule; gens: Generations } | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [genNum, setGenNum] = useState(9);
  const [sides, setSides] = useState<[CalcSide, CalcSide]>(DEFAULT_SIDES);
  const [field, setField] = useState<CalcField>(emptyField);

  // The calculator and its data load on this page only.
  useEffect(() => {
    let live = true;
    Promise.all([import("@smogon/calc/dist/adaptable"), loadCalcGenerations()]).then(
      ([calc, gens]) => live && setLib({ calc, gens }),
      () => live && setLoadError(true)
    );
    return () => {
      live = false;
    };
  }, []);

  const lists = useMemo<CalcLists | null>(() => {
    if (!lib) return null;
    const gen = lib.gens.get(genNum);
    const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
    return {
      gen,
      species: [...gen.species].filter((s) => s.num > 0).sort(byDexNumber),
      items: [...gen.items].sort(byName),
      // No Z or Max moves (the calc takes those as options), nor typeless Struggle.
      moves: [...gen.moves].filter((m) => !m.isZ && !m.isMax && gen.types.get(m.type)).sort(byName),
      abilities: [...gen.abilities].sort(byName),
      natures: [...gen.natures].sort(byName),
      types: [...gen.types].map((t) => t.name as string).filter((t) => t !== "???"),
    };
  }, [lib, genNum]);

  const results = useMemo(() => {
    if (!lib || !lists) return null;
    const calc = { gen: lists.gen, lib: lib.calc };
    const run = (a: CalcSide, d: CalcSide): CalcLine[] | string => {
      if (!lists.gen.species.get(a.species) || !lists.gen.species.get(d.species)) return `Both Pokémon need to exist in Gen ${genNum}.`;
      try {
        return calcMoves(calc, a, d, field);
      } catch (err) {
        return err instanceof Error ? err.message : "The calculator couldn't run this matchup.";
      }
    };
    return [run(sides[0], sides[1]), run(sides[1], sides[0])] as const;
  }, [lib, lists, sides, field, genNum]);

  const setSide = (i: 0 | 1) => (side: CalcSide) => setSides((s) => (i === 0 ? [side, s[1]] : [s[0], side]));

  if (loadError) {
    return <p className="py-16 text-center text-sm text-destructive">Couldn&apos;t load the damage calculator. Check your connection and reload.</p>;
  }
  if (!lib || !lists || !results) {
    return (
      <p className="flex items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> Loading the damage calculator…
      </p>
    );
  }

  return (
    <div className="space-y-6">
      {/* Generation */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="hud-label">Generation</span>
        <div className="flex rounded-md border border-foreground/10 bg-shade/30 p-0.5" role="group" aria-label="Generation">
          {GENS.map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={genNum === g}
              onClick={() => setGenNum(g)}
              aria-label={`Gen ${g}`}
              className={cn(
                "whitespace-nowrap rounded-sm px-2.5 py-1.5 font-pixel text-[10px] leading-none",
                genNum === g ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <span className="hidden sm:inline">Gen </span>
              {g}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <section className="hud space-y-4 rounded-lg border bg-card p-4 sm:p-5" aria-label="Damage results">
        <Results title={`${sides[0].species}'s moves`} lines={results[0]} />
        <Results title={`${sides[1].species}'s moves`} lines={results[1]} />
      </section>

      <FieldPanel field={field} onChange={setField} />

      <div className="relative grid gap-4 lg:grid-cols-2">
        <CalcPanel title="Attacker" side={sides[0]} lists={lists} onChange={setSide(0)} onLoad={(t) => setGenNum(BATTLE_FORMATS[t.format].gen)} />
        <CalcPanel title="Defender" side={sides[1]} lists={lists} onChange={setSide(1)} onLoad={(t) => setGenNum(BATTLE_FORMATS[t.format].gen)} />
        <button
          type="button"
          onClick={() => setSides(([a, b]) => [b, a])}
          aria-label="Swap sides"
          title="Swap sides"
          className="absolute left-1/2 top-3 z-10 hidden h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full border-2 border-screen/50 bg-card text-screen shadow-[0_0_18px_-4px_hsl(var(--screen))] transition-transform hover:rotate-180 lg:flex"
        >
          <ArrowLeftRight className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <button
        type="button"
        onClick={() => setSides(([a, b]) => [b, a])}
        className="mx-auto flex items-center gap-2 rounded-md border border-screen/40 px-4 py-2 text-sm font-semibold text-screen lg:hidden"
      >
        <ArrowLeftRight className="h-4 w-4" aria-hidden /> Swap sides
      </button>
    </div>
  );
}

function Results({ title, lines }: { title: string; lines: CalcLine[] | string }) {
  return (
    <div className="space-y-2">
      <h2 className="hud-label">{title}</h2>
      {typeof lines === "string" ? (
        <p className="text-sm text-destructive">{lines}</p>
      ) : lines.length === 0 ? (
        <p className="text-sm text-muted-foreground">No moves picked.</p>
      ) : (
        <ul className="space-y-2">
          {lines.map((line) => (
            <ResultLine key={line.move} line={line} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultLine({ line }: { line: CalcLine }) {
  const [copied, setCopied] = useState(false);
  const [lo, hi] = line.percent;
  const status = line.category === "Status";
  return (
    <li className="rounded-md border bg-shade/20 p-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="flex min-w-[11rem] items-center gap-2">
          <BattleType type={line.type} />
          <span className="font-display font-bold">{line.move}</span>
          <CategoryTag category={line.category} />
        </span>
        {status ? (
          <span className="text-sm text-muted-foreground">Status move: no damage</span>
        ) : line.damage[1] === 0 ? (
          <span className="text-sm text-muted-foreground">No damage</span>
        ) : (
          <>
            <span className="font-mono text-sm font-bold tabular-nums">
              {lo.toFixed(1)} – {hi.toFixed(1)}%
            </span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">
              {line.damage[0]}–{line.damage[1]} HP
            </span>
            {line.ko && <span className={cn("text-sm font-semibold", /OHKO/.test(line.ko) ? "text-success" : "text-warning")}>{line.ko}</span>}
          </>
        )}
      </div>
      {!status && line.damage[1] > 0 && (
        <div className="meter mt-2" aria-hidden>
          <div className="relative h-full">
            <div className="absolute inset-y-0 left-0 bg-success/80" style={{ width: `${Math.min(100, lo)}%` }} />
            <div className="absolute inset-y-0 bg-warning/70" style={{ left: `${Math.min(100, lo)}%`, width: `${Math.max(0, Math.min(100, hi) - Math.min(100, lo))}%` }} />
          </div>
        </div>
      )}
      {!status && (
        <div className="mt-2 flex items-start gap-2">
          <p className="min-w-0 flex-1 select-all break-words font-mono text-[11px] leading-relaxed text-muted-foreground">{line.desc}</p>
          <button
            type="button"
            aria-label={`Copy the ${line.move} description`}
            onClick={() =>
              navigator.clipboard?.writeText(line.desc).then(
                () => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1400);
                },
                () => undefined
              )
            }
            className="shrink-0 text-muted-foreground hover:text-foreground"
          >
            {copied ? <Check className="h-3.5 w-3.5 text-success" aria-hidden /> : <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />}
          </button>
        </div>
      )}
      {line.rolls.length > 0 && line.damage[1] > 0 && (
        <details className="mt-1">
          <summary className="hud-label cursor-pointer select-none hover:text-foreground">Damage rolls</summary>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">{line.rolls.join(", ")}</p>
        </details>
      )}
    </li>
  );
}

function FieldPanel({ field, onChange }: { field: CalcField; onChange: (field: CalcField) => void }) {
  const update = (patch: Partial<CalcField>) => onChange({ ...field, ...patch });
  return (
    <section className="space-y-3 rounded-lg border bg-card p-4" aria-label="Field">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <span className="hud-label block">Battle</span>
          <div className="flex gap-1.5">
            {(["Singles", "Doubles"] as const).map((g) => (
              <Toggle key={g} pressed={field.gameType === g} onChange={() => update({ gameType: g })} className="h-9">
                {g}
              </Toggle>
            ))}
          </div>
        </div>
        <label className="w-40 space-y-1.5">
          <span className="hud-label block">Weather</span>
          <select value={field.weather} onChange={(e) => update({ weather: e.target.value })} className={inputClass}>
            <option value="">None</option>
            {WEATHERS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </label>
        <label className="w-40 space-y-1.5">
          <span className="hud-label block">Terrain</span>
          <select value={field.terrain} onChange={(e) => update({ terrain: e.target.value })} className={inputClass}>
            <option value="">None</option>
            {TERRAINS.map((t) => (
              <option key={t} value={t}>
                {t} Terrain
              </option>
            ))}
          </select>
        </label>
        <Toggle pressed={field.crit} onChange={(crit) => update({ crit })} className="h-9">
          Critical hits
        </Toggle>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FIELD_FLAGS.map(([flag, label]) => (
          <Toggle key={flag} pressed={!!field.flags[flag]} onChange={(on) => update({ flags: { ...field.flags, [flag]: on } })}>
            {label}
          </Toggle>
        ))}
      </div>
      {field.gameType === "Doubles" && <p className="text-xs text-muted-foreground">Doubles: spread moves deal 75% damage.</p>}
    </section>
  );
}
