"use client";

import type { Item, Move, Nature, Specie } from "@pkmn/data";
import { TypeBadge } from "@/components/pokedex/TypeBadge";
import { STAT_LABELS } from "@/lib/pokemon/constants";
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

export function SpeciesSelect({
  species,
  value,
  onSelect,
  initial,
  tier,
  label = "Species",
  current,
  shiny,
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
}) {
  return (
    <SearchSelect
      label={label}
      value={value}
      placeholder="Search Pokémon"
      options={species}
      initial={initial}
      getKey={(s) => s.id}
      getText={(s) => s.name}
      leading={current && <BattleSprite species={current} shiny={shiny} animated={false} size={36} />}
      render={(s) => (
        <span className="flex items-center gap-2">
          <BattleSprite species={s} animated={false} size={36} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate font-display font-semibold">{s.name}</span>
          <span className="hidden gap-1 sm:flex">
            {s.types.map((t) => (
              <BattleType key={t} type={t} />
            ))}
          </span>
          {tier && <span className="hud-label w-12 text-right text-screen">{tier(s)}</span>}
          <span className="w-8 text-right font-mono text-[11px] tabular-nums text-muted-foreground">{bst(s)}</span>
        </span>
      )}
      onSelect={onSelect}
      listClassName="sm:min-w-[24rem]"
    />
  );
}

export function ItemSelect({
  items,
  value,
  onSelect,
  label = "Item",
}: {
  items: readonly Item[];
  value: string;
  onSelect: (item: Item | null) => void;
  label?: string;
}) {
  return (
    <SearchSelect
      label={label}
      value={value}
      placeholder="No item"
      options={items}
      getKey={(i) => i.id}
      getText={(i) => i.name}
      render={(i) => (
        <span className="block">
          <span className="block font-display font-semibold">{i.name}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{i.shortDesc || i.desc}</span>
        </span>
      )}
      onSelect={onSelect}
      onClear={() => onSelect(null)}
      listClassName="sm:min-w-[22rem]"
    />
  );
}

const MOVE_GRID = "grid grid-cols-[minmax(0,1fr)_64px_44px_32px_32px_24px] items-center gap-1.5";

export function MoveSelect({
  moves,
  value,
  onSelect,
  label,
  exclude,
  loading,
}: {
  moves: readonly Move[];
  value: string;
  onSelect: (move: Move | null) => void;
  label: string;
  /** Already in another slot. */
  exclude?: ReadonlySet<string>;
  loading?: boolean;
}) {
  const options = exclude?.size ? moves.filter((m) => !exclude.has(m.name)) : moves;
  return (
    <SearchSelect
      label={label}
      value={value}
      placeholder={loading ? "Loading moves…" : "Add a move"}
      options={options}
      getKey={(m) => m.id}
      getText={(m) => `${m.name}`}
      header={
        <div className={cn(MOVE_GRID, "hud-label")}>
          <span>Move</span>
          <span>Type</span>
          <span>Cat</span>
          <span className="text-right">Pow</span>
          <span className="text-right">Acc</span>
          <span className="text-right">PP</span>
        </div>
      }
      render={(m) => (
        <span className={MOVE_GRID} title={m.shortDesc}>
          <span className="truncate font-display font-semibold">{m.name}</span>
          <BattleType type={m.type} />
          <CategoryTag category={m.category} />
          <span className="text-right font-mono text-xs tabular-nums">{m.basePower || "—"}</span>
          <span className="text-right font-mono text-xs tabular-nums">{m.accuracy === true ? "—" : m.accuracy}</span>
          <span className="text-right font-mono text-xs tabular-nums">{m.pp}</span>
        </span>
      )}
      onSelect={onSelect}
      onClear={() => onSelect(null)}
      limit={400}
      listClassName="sm:min-w-[25rem]"
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
