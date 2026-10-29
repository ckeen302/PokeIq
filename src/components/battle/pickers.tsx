"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { Item, Move, Nature, Specie } from "@pkmn/data";
import { Ban } from "lucide-react";
import { TypeBadge } from "@/components/pokedex/TypeBadge";
import { STAT_LABELS } from "@/lib/pokemon/constants";
import { loadFormatBans, type FormatBans } from "@/lib/battle/dex";
import { isBattleFormatId } from "@/lib/battle/formats";
import { normalize } from "@/lib/battle/search";
import { cn } from "@/lib/utils";
import { BattleSprite } from "./BattleSprite";
import { inputClass, SearchSelect } from "./controls";

/** Pickers for species, items, moves, natures and types, fed by @pkmn/data. */

export function BattleType({ type, size = "sm", className }: { type: string; size?: "sm" | "md"; className?: string }) {
  if (type === "Stellar") {
    return (
      <span
        className={cn(
          "inline-flex items-center justify-center rounded-[4px] bg-[linear-gradient(90deg,#f87171,#facc15,#4ade80,#60a5fa,#c084fc)] font-display font-bold uppercase tracking-[0.08em] text-[#111827]",
          size === "sm" ? "px-1.5 py-[3px] text-[10px] leading-none" : "px-2.5 py-1 text-[11px] leading-none",
          className
        )}
      >
        Stellar
      </span>
    );
  }
  return <TypeBadge type={type.toLowerCase()} size={size} className={className} />;
}

const CATEGORY_STYLES: Record<string, string> = {
  Physical: "bg-orange-500/15 text-orange-500",
  Special: "bg-sky-500/15 text-sky-500",
  Status: "bg-foreground/10 text-muted-foreground",
};

export function CategoryTag({ category }: { category: string }) {
  return (
    <span className={cn("inline-block rounded-sm px-1.5 py-0.5 font-pixel text-[9px] uppercase leading-none", CATEGORY_STYLES[category])}>
      {category === "Physical" ? "Phys" : category === "Special" ? "Spec" : "Status"}
    </span>
  );
}

const bst = (s: Specie) => Object.values(s.baseStats).reduce((a, b) => a + b, 0);

/** "12.3%" for a 0-1 share; "<0.1%" for a sliver. */
export function pct(share: number): string {
  if (share <= 0) return "";
  if (share < 0.001) return "<0.1%";
  return `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;
}

/** [name, share] usage pairs as lookups: a rank (most used first) and a share. */
export function usageLookup(shares: readonly (readonly [string, number])[] | undefined) {
  const pos = new Map<string, { rank: number; share: number }>();
  (shares ?? []).forEach(([name, share], i) => pos.set(normalize(name), { rank: i, share }));
  return pos;
}

/** A team-builder format's outright bans (null while loading, for the Battle Lab, or offline). */
export function useFormatBans(format: string): FormatBans | null {
  const [state, setState] = useState<{ format: string; bans: FormatBans } | null>(null);
  useEffect(() => {
    if (!isBattleFormatId(format)) return;
    let live = true;
    loadFormatBans(format).then(
      (bans) => live && setState({ format, bans }),
      () => undefined
    );
    return () => {
      live = false;
    };
  }, [format]);
  return state?.format === format ? state.bans : null;
}

function BannedTag({ reason }: { reason: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-0.5 font-pixel text-[9px] uppercase text-destructive" title={reason}>
      <Ban className="h-3 w-3" aria-hidden /> Banned
    </span>
  );
}

const filterSelect = "h-7 min-w-0 rounded border border-foreground/15 bg-shade/40 px-1.5 text-xs focus-visible:border-screen/70 focus-visible:outline-none";

/** What the species search can filter on (the team builder passes it; the calculator doesn't). */
export interface SpeciesFilterSource {
  types: readonly string[];
  /** Species id -> Showdown's ban reason in the format. */
  bans?: Record<string, string> | null;
  /** Most used first, with each one's share of teams. */
  usage?: readonly (readonly [string, number])[] | null;
  abilities?: readonly string[];
  moves?: readonly string[];
  /** Species ids that learn a move. */
  learners?: (move: string) => Promise<Set<string>>;
}

export function SpeciesSelect({
  species,
  value,
  onSelect,
  initial,
  tier,
  label = "Species",
  current,
  shiny,
  filter,
}: {
  species: readonly Specie[];
  value: string;
  onSelect: (species: Specie) => void;
  initial?: readonly Specie[];
  tier?: (species: Specie) => string;
  label?: string;
  /** The picked species, for the sprite in the box. */
  current?: Specie;
  shiny?: boolean;
  filter?: SpeciesFilterSource;
}) {
  const [type, setType] = useState("");
  const [ability, setAbility] = useState("");
  const [learns, setLearns] = useState("");
  const [legalOnly, setLegalOnly] = useState(true);
  const [learnerSet, setLearnerSet] = useState<{ move: string; ids: Set<string> } | null>(null);
  const ids = useId();

  const learnsId = normalize(learns);
  const knownMove = !!learnsId && !!filter?.moves?.some((m) => normalize(m) === learnsId);
  useEffect(() => {
    if (!knownMove || !filter?.learners) return;
    let live = true;
    filter.learners(learnsId).then((set) => live && setLearnerSet({ move: learnsId, ids: set }));
    return () => {
      live = false;
    };
  }, [knownMove, learnsId, filter]);

  const usage = useMemo(() => usageLookup(filter?.usage ?? undefined), [filter?.usage]);
  const bans = filter?.bans ?? null;
  const abilityId = normalize(ability);

  const keep = useMemo(() => {
    if (!filter) return undefined;
    const needsLearner = knownMove && !!filter.learners;
    const learners = learnerSet?.move === learnsId ? learnerSet.ids : null;
    if (!type && !abilityId && !needsLearner && !(legalOnly && bans)) return undefined;
    return (s: Specie) => {
      if (type && !(s.types as readonly string[]).includes(type)) return false;
      if (legalOnly && bans?.[s.id]) return false;
      if (abilityId && !Object.values(s.abilities).some((a) => a && normalize(a) === abilityId)) return false;
      if (needsLearner && !learners?.has(s.id)) return false;
      return true;
    };
  }, [filter, type, abilityId, legalOnly, bans, knownMove, learnerSet, learnsId]);

  const rank = useMemo(() => (usage.size ? (s: Specie) => usage.get(s.id)?.rank ?? usage.size + 1 : undefined), [usage]);
  // With usage numbers, the empty search lists the most used first; without, the format's own tier.
  const start = usage.size ? undefined : initial;
  const active = [type, ability, learns].filter(Boolean).length;

  return (
    <SearchSelect
      label={label}
      value={value}
      placeholder="Search Pokémon"
      options={species}
      initial={start}
      rank={rank}
      keep={keep}
      rowHeight={40}
      getKey={(s) => s.id}
      getText={(s) => s.name}
      leading={current && <BattleSprite species={current} shiny={shiny} animated={false} size={36} />}
      filters={
        filter && (
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Filters">
            <select aria-label="Filter by type" value={type} onChange={(e) => setType(e.target.value)} className={cn(filterSelect, "w-[6.5rem]")}>
              <option value="">Any type</option>
              {filter.types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {filter.abilities && (
              <>
                <input
                  aria-label="Filter by ability"
                  list={`${ids}-abilities`}
                  value={ability}
                  onChange={(e) => setAbility(e.target.value)}
                  placeholder="Ability"
                  className={cn(filterSelect, "w-[7.5rem]")}
                />
                <datalist id={`${ids}-abilities`}>
                  {filter.abilities.map((a) => (
                    <option key={a} value={a} />
                  ))}
                </datalist>
              </>
            )}
            {filter.moves && filter.learners && (
              <>
                <input
                  aria-label="Filter by move learned"
                  list={`${ids}-moves`}
                  value={learns}
                  onChange={(e) => setLearns(e.target.value)}
                  placeholder="Learns move"
                  className={cn(filterSelect, "w-[7.5rem]", learns && !knownMove && "border-warning/60")}
                />
                <datalist id={`${ids}-moves`}>
                  {filter.moves.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </>
            )}
            {bans && (
              <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
                <input type="checkbox" checked={legalOnly} onChange={(e) => setLegalOnly(e.target.checked)} className="accent-[hsl(var(--screen))]" />
                Legal only
              </label>
            )}
            {active > 0 && (
              <button
                type="button"
                onClick={() => {
                  setType("");
                  setAbility("");
                  setLearns("");
                }}
                className="hud-label ml-auto hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>
        )
      }
      render={(s) => {
        const banned = bans?.[s.id];
        const share = usage.get(s.id)?.share;
        return (
          <span className={cn("flex items-center gap-2", banned && "opacity-60")}>
            <BattleSprite species={s} animated={false} size={36} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate font-display font-semibold">{s.name}</span>
            {banned && <BannedTag reason={banned} />}
            <span className="hidden gap-1 sm:flex">
              {s.types.map((t) => (
                <BattleType key={t} type={t} />
              ))}
            </span>
            {tier && <span className="hud-label w-12 text-right text-screen">{tier(s)}</span>}
            {usage.size > 0 && <span className="hidden w-11 text-right font-mono text-[11px] tabular-nums text-muted-foreground sm:block">{share ? pct(share) : ""}</span>}
            <span className="w-8 text-right font-mono text-[11px] tabular-nums text-muted-foreground" title="Base stat total">
              {bst(s)}
            </span>
          </span>
        );
      }}
      onSelect={onSelect}
      listClassName="sm:min-w-[30rem]"
    />
  );
}

export function ItemSelect({
  items,
  value,
  onSelect,
  label = "Item",
  usage,
  bans,
}: {
  items: readonly Item[];
  value: string;
  onSelect: (item: Item | null) => void;
  label?: string;
  /** This Pokémon's items, most used first. */
  usage?: readonly (readonly [string, number])[];
  bans?: Record<string, string> | null;
}) {
  const used = useMemo(() => usageLookup(usage), [usage]);
  const rank = useMemo(
    () => (used.size || bans ? (i: Item) => (used.get(i.id)?.rank ?? used.size + 1) + (bans?.[i.id] ? 10_000 : 0) : undefined),
    [used, bans]
  );
  return (
    <SearchSelect
      label={label}
      value={value}
      placeholder="No item"
      options={items}
      rank={rank}
      rowHeight={40}
      getKey={(i) => i.id}
      getText={(i) => i.name}
      render={(i) => {
        const share = used.get(i.id)?.share;
        const banned = bans?.[i.id];
        return (
          <span className={cn("flex items-center gap-2", banned && "opacity-60")}>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-display font-semibold">{i.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{i.shortDesc || i.desc}</span>
            </span>
            {banned && <BannedTag reason={banned} />}
            {share ? <span className="font-mono text-[11px] tabular-nums text-screen">{pct(share)}</span> : null}
          </span>
        );
      }}
      onSelect={onSelect}
      onClear={() => onSelect(null)}
      listClassName="sm:min-w-[24rem]"
    />
  );
}

const MOVE_GRID = "grid grid-cols-[minmax(0,1fr)_64px_40px_30px] sm:grid-cols-[minmax(0,1fr)_64px_44px_32px_32px_24px_40px] items-center gap-1.5";
const CATEGORIES = ["Physical", "Special", "Status"] as const;

export function MoveSelect({
  moves,
  value,
  onSelect,
  label,
  exclude,
  loading,
  usage,
  bans,
  types,
}: {
  moves: readonly Move[];
  value: string;
  onSelect: (move: Move | null) => void;
  label: string;
  /** Already in another slot. */
  exclude?: ReadonlySet<string>;
  loading?: boolean;
  /** This Pokémon's moves, most used first. */
  usage?: readonly (readonly [string, number])[];
  bans?: Record<string, string> | null;
  /** Shows the type and category filters. */
  types?: readonly string[];
}) {
  const [type, setType] = useState("");
  const [category, setCategory] = useState("");
  const used = useMemo(() => usageLookup(usage), [usage]);
  const options = useMemo(() => (exclude?.size ? moves.filter((m) => !exclude.has(m.name)) : moves), [moves, exclude]);
  const rank = useMemo(
    () => (used.size || bans ? (m: Move) => (used.get(m.id)?.rank ?? used.size + 1) + (bans?.[m.id] ? 10_000 : 0) : undefined),
    [used, bans]
  );
  const keep = useMemo(
    () => (type || category ? (m: Move) => (!type || m.type === type) && (!category || m.category === category) : undefined),
    [type, category]
  );
  return (
    <SearchSelect
      label={label}
      value={value}
      placeholder={loading ? "Loading moves…" : "Add a move"}
      options={options}
      rank={rank}
      keep={keep}
      rowHeight={32}
      getKey={(m) => m.id}
      getText={(m) => m.name}
      filters={
        types && (
          <div className="flex flex-wrap items-center gap-1.5" aria-label="Filters">
            <select aria-label="Filter moves by type" value={type} onChange={(e) => setType(e.target.value)} className={cn(filterSelect, "w-[6.5rem]")}>
              <option value="">Any type</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={category === c}
                onClick={() => setCategory(category === c ? "" : c)}
                className={cn(
                  "h-7 rounded border px-2 text-xs font-semibold",
                  category === c ? "border-screen/60 bg-screen/15" : "border-foreground/15 text-muted-foreground hover:text-foreground"
                )}
              >
                {c}
              </button>
            ))}
          </div>
        )
      }
      header={
        <div className={cn(MOVE_GRID, "hud-label")}>
          <span>Move</span>
          <span>Type</span>
          <span>Cat</span>
          <span className="text-right">Pow</span>
          <span className="hidden text-right sm:block">Acc</span>
          <span className="hidden text-right sm:block">PP</span>
          <span className="hidden text-right sm:block">{used.size ? "Use" : ""}</span>
        </div>
      }
      render={(m) => {
        const banned = bans?.[m.id];
        const share = used.get(m.id)?.share;
        return (
          <span className={cn(MOVE_GRID, banned && "opacity-60")} title={banned ? `${m.name} is ${banned}.` : m.shortDesc}>
            <span className="flex min-w-0 items-center gap-1">
              <span className="truncate font-display font-semibold">{m.name}</span>
              {banned && <Ban className="h-3 w-3 shrink-0 text-destructive" aria-label="Banned" />}
            </span>
            <BattleType type={m.type} />
            <CategoryTag category={m.category} />
            <span className="text-right font-mono text-xs tabular-nums">{m.basePower || "—"}</span>
            <span className="hidden text-right font-mono sm:block text-xs tabular-nums">{m.accuracy === true ? "—" : m.accuracy}</span>
            <span className="hidden text-right font-mono sm:block text-xs tabular-nums">{m.pp}</span>
            <span className="hidden text-right font-mono sm:block text-[11px] tabular-nums text-screen">{share ? pct(share) : ""}</span>
          </span>
        );
      }}
      onSelect={onSelect}
      onClear={() => onSelect(null)}
      listClassName="sm:min-w-[30rem]"
    />
  );
}

export function natureLabel(n: Nature): string {
  if (!n.plus || !n.minus) return `${n.name} (neutral)`;
  return `${n.name} (+${STAT_LABELS[n.plus]}, −${STAT_LABELS[n.minus]})`;
}

export function NatureSelect({
  natures,
  value,
  onChange,
  label = "Nature",
}: {
  natures: readonly Nature[];
  value: string;
  onChange: (nature: string) => void;
  label?: string;
}) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      {!value && <option value="">Serious (neutral)</option>}
      {natures.map((n) => (
        <option key={n.id} value={n.name}>
          {natureLabel(n)}
        </option>
      ))}
    </select>
  );
}

export function TypeSelect({
  types,
  value,
  onChange,
  label,
  allowNone,
}: {
  types: readonly string[];
  value: string;
  onChange: (type: string) => void;
  label: string;
  allowNone?: string;
}) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass}>
      {allowNone !== undefined && <option value="">{allowNone}</option>}
      {types.map((t) => (
        <option key={t} value={t}>
          {t}
        </option>
      ))}
    </select>
  );
}
