"use client";

import { useState } from "react";
import Link from "@/components/ui/Link";
import type { Ability, Generation, Item, Move, Nature, Specie } from "@pkmn/data";
import { FolderOpen } from "lucide-react";
import { useT } from "@/i18n/client";
import battleCalc from "@/messages/battle-calc";
import { STAT_LABELS } from "@/lib/pokemon/constants";
import { STATUSES, sideFromSet, type BoostKey, type CalcSide, type StatusId } from "@/lib/battle/calc";
import { BATTLE_FORMATS } from "@/lib/battle/formats";
import { MAX_EVS, MAX_IV, MAX_TOTAL_EVS, STATS } from "@/lib/battle/sets";
import { useTeams, type BattleTeam } from "@/lib/battle/teams";
import { cn } from "@/lib/utils";
import { BattleSprite } from "./BattleSprite";
import { inputClass, NumberInput, SearchSelect, Toggle } from "./controls";
import { useSpriteLookup } from "./hooks";
import { BattleType, CategoryTag, ItemSelect, MoveSelect, NatureSelect, SpeciesSelect, TypeSelect } from "./pickers";

const BOOST_RANGE = [6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6];
const SHORT: Record<string, string> = { hp: "HP", atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe" };
const STAT_GRID = "grid grid-cols-[2.25rem_2rem_minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,1fr)_2.75rem] items-center gap-1";
/** Phones drop the power and category columns (the move list shows both when it opens). */
const MOVE_GRID = "grid grid-cols-[minmax(0,1fr)_3.5rem_2.75rem] sm:grid-cols-[minmax(0,1fr)_1.75rem_3.5rem_2.75rem_2.25rem] items-center gap-1";
/** A small toggle in a dense row (the phone design system still gives it a 40px target). */
const SMALL_TOGGLE = "h-7 shrink-0 justify-center px-2";

export interface CalcLists {
  gen: Generation;
  species: Specie[];
  items: Item[];
  moves: Move[];
  abilities: Ability[];
  natures: Nature[];
  types: string[];
}

/** The forms a species can switch between in this generation (itself included), when it has more than one. */
function formsOf(gen: Generation, species: Specie | undefined): Specie[] {
  if (!species) return [];
  const base = gen.species.get(species.baseSpecies) ?? species;
  const forms = [base, ...(base.otherFormes ?? []).map((f) => gen.species.get(f))].filter((s): s is Specie => !!s && s.num > 0);
  return forms.length > 1 ? forms : [];
}

function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("hud-label block truncate", className)}>{children}</span>;
}

/** One side of the calc: the Pokémon, its set, its in-battle state and its moves. Its side of the field is in the Field panel. */
export function CalcPanel({
  index,
  title,
  side,
  lists,
  crits,
  onCrits,
  onChange,
  onLoad,
}: {
  index: 0 | 1;
  title: string;
  side: CalcSide;
  lists: CalcLists;
  /** A critical hit, per move slot. */
  crits: boolean[];
  onCrits: (crits: boolean[]) => void;
  onChange: (side: CalcSide) => void;
  /** A team member was loaded: the calc follows its format's generation. */
  onLoad: (team: BattleTeam) => void;
}) {
  const t = useT(battleCalc);
  const { gen } = lists;
  const species = gen.species.get(side.species);
  const nature = gen.natures.get(side.nature);
  const update = (patch: Partial<CalcSide>) => onChange({ ...side, ...patch });
  const ownAbilities = species ? (Object.values(species.abilities).filter(Boolean) as string[]) : [];
  const taken = new Set(side.moves);
  const forms = formsOf(gen, species);
  const stat = (s: (typeof STATS)[number]) => (species ? gen.stats.calc(s, species.baseStats[s], side.ivs[s], side.evs[s], side.level, nature) : 0);
  const maxHp = stat("hp");
  const evTotal = STATS.reduce((sum, s) => sum + side.evs[s], 0);
  const bst = species ? STATS.reduce((sum, s) => sum + species.baseStats[s], 0) : 0;
  const s = { side: title };

  function pickSpecies(next: Specie) {
    const abilities = Object.values(next.abilities).filter(Boolean) as string[];
    update({
      species: next.name,
      ability: abilities.includes(side.ability) ? side.ability : abilities[0] ?? "",
      teraType: next.types[0],
      terastallized: false,
    });
  }

  return (
    <section className="hud min-w-0 space-y-2.5 rounded-lg border bg-card p-2.5 md:p-3" aria-label={title} data-testid={`calc-side-${index + 1}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-baseline gap-2 font-display text-sm font-bold uppercase tracking-wide">
          <span className="shrink-0 text-screen">{title}</span>
        </h2>
        <LoadFromTeam
          title={title}
          onPick={(team, i) => {
            onChange({ ...sideFromSet(team.sets[i]), flags: side.flags, spikes: side.spikes });
            onLoad(team);
          }}
        />
      </div>

      {/* The Pokémon: species, then its types, level, Tera type and form. */}
      <div className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-2">
        <div className="screen flex h-[4.5rem] items-center justify-center rounded-md max-md:h-full">
          <BattleSprite species={species} size={64} className="relative z-[3]" />
        </div>
        <div className="min-w-0 space-y-1.5">
          <SpeciesSelect species={lists.species} value={side.species} onSelect={pickSpecies} label={t("panel.species", s)} />
          <div className="flex flex-wrap items-center gap-1">
            {species?.types.map((type) => <BattleType key={type} type={type} />)}
            {!species && <span className="text-xs text-destructive">{t("panel.notInGen", { n: gen.num })}</span>}
            <label className="ml-auto flex items-center gap-1">
              <Label>{t("panel.level")}</Label>
              <NumberInput label={t("panel.levelLabel", s)} value={side.level} min={1} max={100} onChange={(level) => update({ level })} className="h-7 w-12" />
            </label>
          </div>
        </div>
      </div>
      {(gen.num >= 9 || forms.length > 0) && (
        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
          {gen.num >= 9 && (
            <div className="min-w-0 space-y-1">
              <Label>{t("panel.teraType")}</Label>
              <div className="flex gap-1">
                <TypeSelect label={t("panel.teraTypeLabel", s)} types={lists.types} value={side.teraType} onChange={(teraType) => update({ teraType })} />
                <Toggle pressed={side.terastallized} onChange={(terastallized) => update({ terastallized })} className={SMALL_TOGGLE}>
                  <span className="sr-only">{t("panel.teraOn", s)}</span>
                  <span aria-hidden>{t("panel.tera")}</span>
                </Toggle>
              </div>
            </div>
          )}
          {forms.length > 0 && (
            <label className={cn("block min-w-0 space-y-1", gen.num < 9 && "col-span-2")}>
              <Label>{t("panel.form")}</Label>
              <select
                aria-label={t("panel.formLabel", s)}
                value={species?.name}
                onChange={(e) => {
                  const next = gen.species.get(e.target.value);
                  if (next) pickSpecies(next);
                }}
                className={inputClass}
              >
                {forms.map((f) => (
                  <option key={f.id} value={f.name}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {/* Stats: base, IVs, EVs, boosts and the final stat (its nature's + or −). */}
      <div className="calc-stats space-y-1 rounded-md border border-foreground/10 bg-shade/20 p-1.5" role="group" aria-label={t("panel.stats.stat")}>
        <div className={cn(STAT_GRID, "hud-label")} aria-hidden>
          <span>{t("panel.stats.stat")}</span>
          <span className="text-right">{t("panel.stats.base")}</span>
          <span className="text-center">{t("panel.stats.iv")}</span>
          <span className="text-center">{t("panel.stats.ev")}</span>
          <span className="text-center">{t("panel.stats.boost")}</span>
          <span className="text-right">{t("panel.stats.total")}</span>
        </div>
        {STATS.map((k) => {
          const plus = nature?.plus === k;
          const minus = nature?.minus === k;
          const boost = k === "hp" ? 0 : side.boosts[k as BoostKey];
          return (
            <div key={k} className={cn(STAT_GRID, "text-[13px]")}>
              <span className={cn("font-semibold", plus && "text-success", minus && "text-destructive")} title={STAT_LABELS[k]}>
                {SHORT[k]}
              </span>
              <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">{species?.baseStats[k] ?? "—"}</span>
              <NumberInput label={t("panel.stats.ivLabel", { side: title, stat: STAT_LABELS[k] })} value={side.ivs[k]} min={0} max={MAX_IV} onChange={(v) => update({ ivs: { ...side.ivs, [k]: v } })} className="h-6" />
              <NumberInput label={t("panel.stats.evLabel", { side: title, stat: STAT_LABELS[k] })} value={side.evs[k]} min={0} max={MAX_EVS} onChange={(v) => update({ evs: { ...side.evs, [k]: v } })} className="h-6" />
              {k === "hp" ? (
                <span />
              ) : (
                <select
                  aria-label={t("panel.stats.boostLabel", { side: title, stat: STAT_LABELS[k] })}
                  value={boost}
                  onChange={(e) => update({ boosts: { ...side.boosts, [k]: Number(e.target.value) } })}
                  className={cn(inputClass, "h-6 px-1 text-center font-mono text-xs", boost > 0 && "text-success", boost < 0 && "text-destructive")}
                >
                  {BOOST_RANGE.map((b) => (
                    <option key={b} value={b}>
                      {b > 0 ? `+${b}` : b}
                    </option>
                  ))}
                </select>
              )}
              <span className="flex items-center justify-end gap-0.5 font-mono font-bold tabular-nums">
                {stat(k)}
                <span className={cn("w-2 text-center text-[11px]", plus ? "text-success" : minus ? "text-destructive" : "text-transparent")} aria-hidden>
                  {plus ? "+" : minus ? "−" : "·"}
                </span>
              </span>
            </div>
          );
        })}
        <div className={cn(STAT_GRID, "border-t border-foreground/10 pt-1 text-xs")}>
          <span className="hud-label">{t("panel.stats.sum")}</span>
          <span className="text-right font-mono tabular-nums text-muted-foreground">{bst || "—"}</span>
          <span />
          <span className={cn("col-span-2 text-center font-mono text-[11px] tabular-nums", evTotal > MAX_TOTAL_EVS ? "text-destructive" : "text-muted-foreground")}>
            {evTotal > MAX_TOTAL_EVS ? t("panel.stats.evsOver", { n: evTotal - MAX_TOTAL_EVS }) : t("panel.stats.evsLeft", { n: MAX_TOTAL_EVS - evTotal })}
          </span>
          <span />
        </div>
      </div>

      {/* Nature, ability, item, status. */}
      <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
        {gen.num >= 3 && (
          <label className="block min-w-0 space-y-1">
            <Label>{t("panel.nature")}</Label>
            <NatureSelect label={t("panel.natureLabel", s)} natures={lists.natures} value={side.nature} onChange={(n) => update({ nature: n })} />
          </label>
        )}
        {gen.num >= 3 && (
          <div className="min-w-0 space-y-1">
            <Label>{t("panel.ability")}</Label>
            <SearchSelect
              label={t("panel.abilityLabel", s)}
              value={side.ability}
              placeholder={t("panel.noAbility")}
              options={lists.abilities}
              initial={[...lists.abilities.filter((a) => ownAbilities.includes(a.name)), ...lists.abilities.filter((a) => !ownAbilities.includes(a.name))]}
              getKey={(a) => a.id}
              getText={(a) => a.name}
              render={(a) => <span className={cn("block font-display font-semibold", !ownAbilities.includes(a.name) && "text-muted-foreground")}>{a.name}</span>}
              onSelect={(a) => update({ ability: a.name })}
            />
          </div>
        )}
        <div className="min-w-0 space-y-1">
          <Label>{t("panel.item")}</Label>
          <ItemSelect label={t("panel.itemLabel", s)} items={lists.items} value={side.item} onSelect={(item) => update({ item: item?.name ?? "" })} />
        </div>
        <label className="block min-w-0 space-y-1">
          <Label>{t("panel.status")}</Label>
          <select aria-label={t("panel.statusLabel", s)} value={side.status} onChange={(e) => update({ status: e.target.value as StatusId })} className={inputClass}>
            {STATUSES.map((st) => (
              <option key={st.id} value={st.id}>
                {t(`statuses.${st.id || "healthy"}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {(gen.num >= 3 || gen.num === 7 || gen.num === 8) && (
        <div className="flex flex-wrap gap-1">
          {gen.num >= 3 && (
            <Toggle pressed={side.abilityOn} onChange={(abilityOn) => update({ abilityOn })} className={SMALL_TOGGLE}>
              {t("panel.abilityOn")}
            </Toggle>
          )}
          {gen.num === 7 && (
            <Toggle pressed={!!side.zMove} onChange={(zMove) => update({ zMove })} className={SMALL_TOGGLE}>
              {t("panel.zMove")}
            </Toggle>
          )}
          {gen.num === 8 && (
            <Toggle pressed={!!side.dynamaxed} onChange={(dynamaxed) => update({ dynamaxed })} className={SMALL_TOGGLE}>
              {t("panel.dynamax")}
            </Toggle>
          )}
        </div>
      )}

      {/* Current HP: the bar is the slider. */}
      <div className="flex items-center gap-2">
        <Label className="shrink-0">{t("panel.hp")}</Label>
        <span className="flex shrink-0 items-center gap-0.5 text-xs">
          <NumberInput label={t("panel.hpPercent", s)} value={side.hpPercent} min={1} max={100} onChange={(hpPercent) => update({ hpPercent })} className="h-7 w-12" />%
        </span>
        <div className="relative flex h-5 min-w-0 flex-1 items-center rounded-sm focus-within:ring-2 focus-within:ring-ring/50 max-md:h-10">
          <HpMeter value={side.hpPercent / 100} />
          <input
            type="range"
            min={1}
            max={100}
            value={side.hpPercent}
            aria-label={t("panel.hpLabel", s)}
            onChange={(e) => update({ hpPercent: Number(e.target.value) })}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          />
        </div>
        {maxHp > 0 && (
          <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
            {Math.max(1, Math.min(maxHp, Math.round((maxHp * side.hpPercent) / 100)))}/{maxHp}
          </span>
        )}
      </div>

      {/* Moves: each with its power, type, category and a crit toggle. */}
      <div className="space-y-1">
        <div className={cn(MOVE_GRID, "hud-label")} aria-hidden>
          <span>{t("panel.moves.move")}</span>
          <span className="text-right max-sm:hidden">{t("panel.moves.bp")}</span>
          <span className="text-center">{t("panel.moves.type")}</span>
          <span className="text-center max-sm:hidden">{t("panel.moves.cat")}</span>
          <span className="text-center">{t("panel.moves.crit")}</span>
        </div>
        {[0, 1, 2, 3].map((i) => {
          const name = side.moves[i] ?? "";
          const move = name ? gen.moves.get(name) : undefined;
          return (
            <div key={i} className={MOVE_GRID}>
              <MoveSelect
                label={t("panel.moves.label", { side: title, n: i + 1 })}
                moves={lists.moves}
                value={name}
                exclude={taken}
                onSelect={(m) => {
                  const moves = [...side.moves];
                  const next = [...crits];
                  if (m) moves[i] = m.name;
                  else {
                    moves.splice(i, 1);
                    next.splice(i, 1);
                    next.push(false);
                  }
                  update({ moves: moves.filter(Boolean).slice(0, 4) });
                  if (!m) onCrits(next);
                }}
              />
              <span className="text-right font-mono text-xs tabular-nums text-muted-foreground max-sm:hidden">{move ? move.basePower || "—" : ""}</span>
              <span className="flex justify-center">{move && <BattleType type={move.type} className="w-full" />}</span>
              <span className="flex justify-center max-sm:hidden">{move && <CategoryTag category={move.category} />}</span>
              <Toggle
                pressed={!!crits[i]}
                disabled={!move || move.category === "Status"}
                onChange={(on) => onCrits(crits.map((c, k) => (k === i ? on : c)))}
                className="h-7 justify-center px-0"
              >
                <span className="sr-only">{t("panel.moves.critLabel", { side: title, n: i + 1 })}</span>
                <span aria-hidden>{t("panel.moves.crit")}</span>
              </Toggle>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** The HP bar (green → amber → red), drawn under the slider. */
function HpMeter({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(1, value));
  const color = pct > 0.5 ? "hsl(var(--success))" : pct > 0.22 ? "hsl(var(--warning))" : "hsl(var(--destructive))";
  return (
    <div className="meter pointer-events-none h-2.5 w-full" aria-hidden>
      <div className="h-full" style={{ width: `${pct * 100}%`, background: color, boxShadow: `0 0 8px ${color}` }} />
    </div>
  );
}

/** Pick a saved team member to fill this side. */
function LoadFromTeam({ title, onPick }: { title: string; onPick: (team: BattleTeam, index: number) => void }) {
  const t = useT(battleCalc);
  const teams = useTeams();
  const sprite = useSpriteLookup();
  const [open, setOpen] = useState(false);
  const usable = (teams ?? []).filter((team) => team.sets.length);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-foreground/10 bg-shade/30 px-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-screen/50 hover:text-foreground max-md:h-10"
      >
        <FolderOpen className="h-3.5 w-3.5" aria-hidden /> {t("panel.load")}
      </button>
      {open && <button type="button" aria-label={t("panel.close")} tabIndex={-1} className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />}
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1 max-h-80 w-72 overflow-y-auto rounded-md border-2 border-foreground/15 bg-card p-2 shadow-2xl" role="menu" aria-label={t("panel.loadMenu", { side: title })}>
          {!usable.length && (
            <p className="p-2 text-sm text-muted-foreground">
              {t.rich("panel.noTeams", {
                link: (chunks) => (
                  <Link href="/battle/teams" className="text-screen underline-offset-2 hover:underline">
                    {chunks}
                  </Link>
                ),
              })}
            </p>
          )}
          {usable.map((team) => (
            <div key={team.id} className="mb-2 last:mb-0">
              <p className="hud-label px-1 pb-1 normal-case tracking-wider">
                {team.name} · {BATTLE_FORMATS[team.format].name}
              </p>
              <div className="grid grid-cols-3 gap-1">
                {team.sets.map((set, i) => (
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
                    <BattleSprite species={sprite?.(set.species)} animated={false} size={36} />
                    <span className="w-full truncate text-center">{set.name || set.species}</span>
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
