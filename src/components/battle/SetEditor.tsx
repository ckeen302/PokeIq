"use client";

import { useMemo } from "react";
import type { Move, Specie } from "@pkmn/data";
import { Sparkles, Trash2, TriangleAlert } from "lucide-react";
import type { FormatDex } from "@/lib/battle/dex";
import { hasTera } from "@/lib/battle/formats";
import { fitStatsToGen, fromDV, hasDVs, newSet, type TeamSet } from "@/lib/battle/sets";
import { cn } from "@/lib/utils";
import { BattleSprite } from "./BattleSprite";
import { Field, inputClass, NumberInput, Toggle } from "./controls";
import { useLearnable } from "./hooks";
import { BattleType, ItemSelect, MoveSelect, NatureSelect, SpeciesSelect, TypeSelect } from "./pickers";
import { StatEditor } from "./StatEditor";

type WithTera = Specie & { requiredTeraType?: string };

/** One team slot: species, details, moves, stats and the validator's problems with it. */
export function SetEditor({
  dex,
  set,
  slot,
  problems,
  onChange,
}: {
  dex: FormatDex;
  set: TeamSet | null;
  slot: number;
  problems: string[];
  onChange: (set: TeamSet | null) => void;
}) {
  const { format, gen } = dex;
  const species = set ? gen.species.get(set.species) : undefined;
  const { moves: learnable, loading } = useLearnable(dex, species?.name);
  // Before anything is typed, the search lists the format's own tier.
  const initial = useMemo(() => {
    const own = dex.species.filter((s) => dex.tier(s) === dex.format.homeTier);
    return own.length ? [...own].sort((a, b) => a.name.localeCompare(b.name)) : undefined;
  }, [dex]);

  function pickSpecies(s: WithTera) {
    const base = set ?? newSet(s.name, format);
    const abilities = Object.values(s.abilities).filter(Boolean) as string[];
    const next: TeamSet = {
      ...base,
      species: s.name,
      ability: abilities.includes(base.ability) ? base.ability : abilities[0] ?? "",
      gender: s.gender ? "" : base.gender,
    };
    const required = s.requiredItem ?? s.requiredItems?.[0];
    if (required) next.item = required;
    if (hasTera(format)) next.teraType = s.requiredTeraType ?? (set && base.teraType ? base.teraType : s.types[0]);
    onChange(next);
  }

  function pickMove(i: number, move: Move | null) {
    if (!set) return;
    const moves = [...set.moves];
    if (move) moves[i] = move.name;
    else moves.splice(i, 1);
    const next = { ...set, moves: moves.filter(Boolean).slice(0, 4) };
    // A typed Hidden Power needs the IVs that give its type (in Gen 2, the Atk and Def DVs).
    if (move?.id.startsWith("hiddenpower") && move.type !== "Normal") {
      const type = gen.types.get(move.type);
      if (hasDVs(gen.num)) {
        const dvs = Object.fromEntries(Object.entries(type?.HPdvs ?? {}).map(([s, dv]) => [s, fromDV(dv as number)]));
        Object.assign(next, fitStatsToGen({ evs: next.evs, ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...dvs } }, gen.num));
      } else {
        next.ivs = { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31, ...(type?.HPivs ?? {}) };
      }
    }
    onChange(next);
  }

  if (!set) {
    return (
      <div className="space-y-4 rounded-lg border border-dashed border-foreground/15 bg-card/50 p-6 text-center">
        <p className="hud-label">Slot {slot + 1} · empty</p>
        <p className="text-sm text-muted-foreground">Pick a Pokémon for this slot.</p>
        <div className="mx-auto max-w-sm text-left">
          <SpeciesSelect species={dex.species} initial={initial} tier={dex.tier} value="" onSelect={pickSpecies} label={`Slot ${slot + 1} species`} />
        </div>
      </div>
    );
  }

  const update = (patch: Partial<TeamSet>) => onChange({ ...set, ...patch });
  const abilities = species ? (Object.values(species.abilities).filter(Boolean) as string[]) : [];
  const nature = gen.natures.get(set.nature);
  const taken = new Set(set.moves);

  return (
    <div className="space-y-5">
      {problems.length > 0 && (
        <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm" aria-label={`Slot ${slot + 1} problems`}>
          {problems.map((p) => (
            <li key={p} className="flex gap-2">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              {p}
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-5 lg:grid-cols-[200px_minmax(0,1fr)]">
        {/* Identity */}
        <div className="space-y-3">
          <div className="screen relative flex h-40 items-center justify-center rounded-lg">
            <BattleSprite species={species} shiny={set.shiny} size={112} className="relative z-[3]" />
            {species && (
              <span className="absolute bottom-2 left-2 z-[3] flex gap-1">
                {species.types.map((t) => (
                  <BattleType key={t} type={t} />
                ))}
              </span>
            )}
            {species && <span className="hud-label absolute right-2 top-2 z-[3] text-screen">{dex.tier(species)}</span>}
          </div>
          <Field label="Species">
            <SpeciesSelect species={dex.species} initial={initial} tier={dex.tier} value={set.species} current={species} shiny={set.shiny} onSelect={pickSpecies} />
          </Field>
          {!species && <p className="text-xs text-destructive">{set.species} isn&apos;t in {format.name}.</p>}
          <Field label="Nickname">
            <input
              value={set.name}
              maxLength={18}
              placeholder={set.species}
              onChange={(e) => update({ name: e.target.value })}
              className={inputClass}
            />
          </Field>
          <button
            type="button"
            onClick={() => onChange(null)}
            className="flex w-full items-center justify-center gap-1.5 rounded-md border border-foreground/10 py-1.5 text-xs text-muted-foreground transition-colors hover:border-destructive/50 hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove from team
          </button>
        </div>

        <div className="min-w-0 space-y-5">
          {/* Details */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Field label="Level">
              <NumberInput label="Level" value={set.level} min={1} max={100} onChange={(level) => update({ level })} />
            </Field>
            {gen.num > 1 && (
              <Field label="Gender">
                <select
                  value={species?.gender ?? set.gender}
                  disabled={!!species?.gender}
                  onChange={(e) => update({ gender: e.target.value })}
                  className={inputClass}
                >
                  {species?.gender === "N" && <option value="N">None</option>}
                  <option value="">Random</option>
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                </select>
              </Field>
            )}
            {hasTera(format) ? (
              <Field label="Tera type">
                <TypeSelect label="Tera type" types={dex.types} value={set.teraType ?? ""} allowNone="Default" onChange={(t) => update({ teraType: t || undefined })} />
              </Field>
            ) : (
              <span />
            )}
            {gen.num > 1 && (
              <div className="space-y-1.5">
                <span className="hud-label block">Shiny</span>
                <Toggle pressed={!!set.shiny} onChange={(shiny) => update({ shiny: shiny || undefined })} className="h-9 w-full justify-center">
                  <Sparkles className={cn("h-3.5 w-3.5", set.shiny && "text-warning")} aria-hidden /> {set.shiny ? "Shiny" : "Regular"}
                </Toggle>
              </div>
            )}
            {/* Abilities and natures arrive in Gen 3, held items in Gen 2. */}
            {gen.num >= 3 && (
              <Field label="Ability" className="col-span-2">
                <select value={set.ability} onChange={(e) => update({ ability: e.target.value })} className={inputClass}>
                  {!abilities.includes(set.ability) && <option value={set.ability}>{set.ability || "—"}</option>}
                  {abilities.map((a) => (
                    <option key={a} value={a}>
                      {a}
                      {species?.abilities.H === a ? " (Hidden)" : ""}
                    </option>
                  ))}
                </select>
              </Field>
            )}
            {gen.num >= 2 && (
              <Field label="Item" className="col-span-2">
                <ItemSelect items={dex.items} value={set.item} onSelect={(item) => update({ item: item?.name ?? "" })} />
              </Field>
            )}
            {gen.num >= 3 && (
              <Field label="Nature" className="col-span-2 sm:col-span-4">
                <NatureSelect natures={dex.natures} value={set.nature} onChange={(n) => update({ nature: n })} />
              </Field>
            )}
          </div>

          {/* Moves */}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="hud-label">Moves</span>
              <span className="hud-label normal-case tracking-wider">
                {loading ? "Loading learnset…" : dex.anyMove ? `Any ${format.name} move · its own first` : `${learnable.length} learnable in ${format.name}`}
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {[0, 1, 2, 3].map((i) => {
                const name = set.moves[i] ?? "";
                const move = name ? gen.moves.get(name) : undefined;
                return (
                  <div key={i} className="flex items-center gap-2">
                    <span className="font-pixel text-[10px] text-muted-foreground">{i + 1}</span>
                    <MoveSelect
                      label={`Move ${i + 1}`}
                      moves={learnable}
                      loading={loading}
                      value={name}
                      exclude={taken}
                      onSelect={(m) => pickMove(i, m)}
                    />
                    <span className="w-14 shrink-0 text-right">{move && <BattleType type={move.type} />}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Stats */}
          <div className="rounded-lg border bg-card/60 p-3">
            {species ? (
              <StatEditor
                gen={gen}
                base={species.baseStats}
                evs={set.evs}
                ivs={set.ivs}
                level={set.level}
                nature={nature}
                onEvs={(evs) => update({ evs })}
                onIvs={(ivs) => update({ ivs })}
              />
            ) : (
              <p className="text-sm text-muted-foreground">Pick a species to see its stats.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
