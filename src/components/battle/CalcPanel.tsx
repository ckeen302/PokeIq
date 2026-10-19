"use client";

import { useState } from "react";
import Link from "next/link";
import type { Ability, Generation, Item, Move, Nature, Specie } from "@pkmn/data";
import { FolderOpen } from "lucide-react";
import { HpBar } from "@/components/game/HpBar";
import { STAT_LABELS } from "@/lib/pokemon/constants";
import { SIDE_FLAGS, STATUSES, sideFromSet, type BoostKey, type CalcSide, type StatusId } from "@/lib/battle/calc";
import { BATTLE_FORMATS } from "@/lib/battle/formats";
import { MAX_EVS, MAX_IV, STATS } from "@/lib/battle/sets";
import { useTeams, type BattleTeam } from "@/lib/battle/teams";
import { cn } from "@/lib/utils";
import { BattleSprite } from "./BattleSprite";
import { Field, inputClass, NumberInput, SearchSelect, Toggle } from "./controls";
import { useSpriteLookup } from "./hooks";
import { BattleType, ItemSelect, MoveSelect, NatureSelect, SpeciesSelect, TypeSelect } from "./pickers";

const BOOST_RANGE = [6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6];
const SHORT: Record<string, string> = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };

export interface CalcLists {
  gen: Generation;
  species: Specie[];
  items: Item[];
  moves: Move[];
  abilities: Ability[];
  natures: Nature[];
  types: string[];
}

/** One side of the calc: the Pokémon, its set, its in-battle state and its side of the field. */
export function CalcPanel({
  title,
  side,
  lists,
  onChange,
  onLoad,
}: {
  title: string;
  side: CalcSide;
  lists: CalcLists;
  onChange: (side: CalcSide) => void;
  /** A team member was loaded: the calc follows its format's generation. */
  onLoad: (team: BattleTeam) => void;
}) {
  const { gen } = lists;
  const species = gen.species.get(side.species);
  const nature = gen.natures.get(side.nature);
  const update = (patch: Partial<CalcSide>) => onChange({ ...side, ...patch });
  const ownAbilities = species ? (Object.values(species.abilities).filter(Boolean) as string[]) : [];
  const taken = new Set(side.moves);

  function pickSpecies(s: Specie) {
    const abilities = Object.values(s.abilities).filter(Boolean) as string[];
    update({
      species: s.name,
      ability: abilities.includes(side.ability) ? side.ability : abilities[0] ?? "",
      teraType: s.types[0],
      terastallized: false,
    });
  }

  return (
    <div className="hud min-w-0 space-y-4 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-bold uppercase tracking-wide">{title}</h2>
        <LoadFromTeam
          title={title}
          onPick={(team, i) => {
            onChange({ ...sideFromSet(team.sets[i]), flags: side.flags, spikes: side.spikes });
            onLoad(team);
          }}
        />
      </div>

      <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3">
        <div className="screen relative flex h-24 items-center justify-center rounded-lg">
          <BattleSprite species={species} size={80} className="relative z-[3]" />
        </div>
        <div className="min-w-0 space-y-2">
          <SpeciesSelect species={lists.species} value={side.species} current={species} onSelect={pickSpecies} label={`${title} species`} />
          <div className="flex flex-wrap items-center gap-1">
            {species?.types.map((t) => <BattleType key={t} type={t} />)}
            {!species && <span className="text-xs text-destructive">Not in Gen {gen.num}</span>}
            <span className="hud-label ml-auto">Lv</span>
            <NumberInput label={`${title} level`} value={side.level} min={1} max={100} onChange={(level) => update({ level })} className="h-7 w-14" />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {gen.num >= 3 && (
          <Field label="Ability">
            <SearchSelect
              label={`${title} ability`}
              value={side.ability}
              placeholder="No ability"
              options={lists.abilities}
              initial={[...lists.abilities.filter((a) => ownAbilities.includes(a.name)), ...lists.abilities.filter((a) => !ownAbilities.includes(a.name))]}
              getKey={(a) => a.id}
              getText={(a) => a.name}
              render={(a) => (
                <span className={cn("block font-display font-semibold", !ownAbilities.includes(a.name) && "text-muted-foreground")}>{a.name}</span>
              )}
              onSelect={(a) => update({ ability: a.name })}
            />
          </Field>
        )}
        <Field label="Item">
          <ItemSelect label={`${title} item`} items={lists.items} value={side.item} onSelect={(item) => update({ item: item?.name ?? "" })} />
        </Field>
        {gen.num >= 3 && (
          <Field label="Nature">
            <NatureSelect label={`${title} nature`} natures={lists.natures} value={side.nature} onChange={(n) => update({ nature: n })} />
          </Field>
        )}
        <Field label="Status">
          <select aria-label={`${title} status`} value={side.status} onChange={(e) => update({ status: e.target.value as StatusId })} className={inputClass}>
            {STATUSES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        {gen.num >= 9 && (
          <Field label="Tera type">
            <div className="flex gap-1.5">
              <TypeSelect label={`${title} Tera type`} types={lists.types} value={side.teraType} onChange={(t) => update({ teraType: t })} />
              <Toggle pressed={side.terastallized} onChange={(terastallized) => update({ terastallized })} className="h-9 shrink-0">
                Tera
              </Toggle>
            </div>
          </Field>
        )}
        {gen.num >= 3 && (
          <div className="flex items-end">
            <Toggle pressed={side.abilityOn} onChange={(abilityOn) => update({ abilityOn })} className="h-9 w-full justify-center">
              Ability active
            </Toggle>
          </div>
        )}
      </div>

      {/* Current HP */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="hud-label">Current HP</span>
          <span className="flex items-center gap-1 text-xs">
            <NumberInput label={`${title} current HP %`} value={side.hpPercent} min={1} max={100} onChange={(hpPercent) => update({ hpPercent })} className="h-7 w-14" />%
          </span>
        </div>
        <input
          type="range"
          min={1}
          max={100}
          value={side.hpPercent}
          aria-label={`${title} current HP`}
          onChange={(e) => update({ hpPercent: Number(e.target.value) })}
          className="h-2 w-full cursor-pointer accent-[hsl(var(--success))]"
        />
        <HpBar value={side.hpPercent / 100} />
      </div>

      {/* Stats: EVs, IVs, boosts */}
      <div className="space-y-1.5 rounded-md border bg-shade/20 p-2.5">
        <div className="hud-label grid grid-cols-[34px_30px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_40px] items-center gap-1.5">
          <span>Stat</span>
          <span className="text-right">Base</span>
          <span className="text-center">EV</span>
          <span className="text-center">IV</span>
          <span className="text-center">Boost</span>
          <span className="text-right">Total</span>
        </div>
        {STATS.map((s) => {
          const value = species ? gen.stats.calc(s, species.baseStats[s], side.ivs[s], side.evs[s], side.level, nature) : 0;
          const plus = nature?.plus === s;
          const minus = nature?.minus === s;
          return (
            <div key={s} className="grid grid-cols-[34px_30px_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_40px] items-center gap-1.5 text-sm">
              <span className={cn("font-semibold", plus && "text-success", minus && "text-destructive")} title={STAT_LABELS[s]}>
                {SHORT[s]}
                {plus ? "+" : minus ? "−" : ""}
              </span>
              <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">{species?.baseStats[s] ?? "—"}</span>
              <NumberInput label={`${title} ${STAT_LABELS[s]} EVs`} value={side.evs[s]} min={0} max={MAX_EVS} onChange={(v) => update({ evs: { ...side.evs, [s]: v } })} className="h-7" />
              <NumberInput label={`${title} ${STAT_LABELS[s]} IVs`} value={side.ivs[s]} min={0} max={MAX_IV} onChange={(v) => update({ ivs: { ...side.ivs, [s]: v } })} className="h-7" />
              {s === "hp" ? (
                <span />
              ) : (
                <select
                  aria-label={`${title} ${STAT_LABELS[s]} boost`}
                  value={side.boosts[s as BoostKey]}
                  onChange={(e) => update({ boosts: { ...side.boosts, [s]: Number(e.target.value) } })}
                  className={cn(inputClass, "h-7 px-1 text-center font-mono text-xs", side.boosts[s as BoostKey] > 0 && "text-success", side.boosts[s as BoostKey] < 0 && "text-destructive")}
                >
                  {BOOST_RANGE.map((b) => (
                    <option key={b} value={b}>
                      {b > 0 ? `+${b}` : b}
                    </option>
                  ))}
                </select>
              )}
              <span className="text-right font-mono font-bold tabular-nums">{value}</span>
            </div>
          );
        })}
      </div>

      {/* Moves */}
      <div className="space-y-1.5">
        <span className="hud-label block">Moves</span>
        <div className="grid gap-2">
          {[0, 1, 2, 3].map((i) => (
            <MoveSelect
              key={i}
              label={`${title} move ${i + 1}`}
              moves={lists.moves}
              value={side.moves[i] ?? ""}
              exclude={taken}
              onSelect={(m) => {
                const moves = [...side.moves];
                if (m) moves[i] = m.name;
                else moves.splice(i, 1);
                update({ moves: moves.filter(Boolean).slice(0, 4) });
              }}
            />
          ))}
        </div>
      </div>

      {/* This side of the field */}
      <div className="space-y-1.5">
        <span className="hud-label block">{title}&apos;s side</span>
        <div className="flex flex-wrap gap-1.5">
          {SIDE_FLAGS.map(([flag, label]) => (
            <Toggle key={flag} pressed={!!side.flags[flag]} onChange={(on) => update({ flags: { ...side.flags, [flag]: on } })}>
              {label}
            </Toggle>
          ))}
          <label className="inline-flex h-8 items-center gap-1.5 rounded-md border border-foreground/10 bg-shade/30 px-2 text-xs font-semibold text-muted-foreground">
            Spikes
            <select
              aria-label={`${title} Spikes layers`}
              value={side.spikes}
              onChange={(e) => update({ spikes: Number(e.target.value) })}
              className="bg-transparent font-mono text-foreground focus:outline-none"
            >
              {[0, 1, 2, 3].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </div>
  );
}

/** Pick a saved team member to fill this side. */
function LoadFromTeam({ title, onPick }: { title: string; onPick: (team: BattleTeam, index: number) => void }) {
  const teams = useTeams();
  const sprite = useSpriteLookup();
  const [open, setOpen] = useState(false);
  const usable = (teams ?? []).filter((t) => t.sets.length);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-md border border-foreground/10 bg-shade/30 px-2.5 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-screen/50 hover:text-foreground"
      >
        <FolderOpen className="h-3.5 w-3.5" aria-hidden /> Load from my team
      </button>
      {open && <button type="button" aria-label="Close" tabIndex={-1} className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />}
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 max-h-80 w-72 overflow-y-auto rounded-md border-2 border-foreground/15 bg-card p-2 shadow-2xl" role="menu" aria-label={`Load a team member as ${title}`}>
          {!usable.length && (
            <p className="p-2 text-sm text-muted-foreground">
              No saved teams yet.{" "}
              <Link href="/battle/teams" className="text-screen underline-offset-2 hover:underline">
                Build one
              </Link>
              .
            </p>
          )}
          {usable.map((team) => (
            <div key={team.id} className="mb-2 last:mb-0">
              <p className="hud-label px-1 pb-1 normal-case tracking-wider">
                {team.name} · {BATTLE_FORMATS[team.format].name}
              </p>
              <div className="grid grid-cols-3 gap-1">
                {team.sets.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onPick(team, i);
                      setOpen(false);
                    }}
                    className="flex flex-col items-center rounded-md border border-transparent px-1 py-1 text-[11px] hover:border-screen/50 hover:bg-screen/10"
                  >
                    <BattleSprite species={sprite?.(s.species)} animated={false} size={36} />
                    <span className="w-full truncate text-center">{s.name || s.species}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
