/* eslint-disable @next/next/no-img-element -- artwork comes pre-sized from /api/art */
import Link from "next/link";
import { artUrl } from "@/lib/pokemon/art";
import { typeColor, typeTextColor } from "@/lib/pokemon/type-colors";
import { AXES, AXIS_INFO, type Profile } from "@/lib/which-pokemon/types";
import { cn } from "@/lib/utils";

/** Type chips in the Pokédex colours. */
export function TypeChips({ types, className }: { types: string[]; className?: string }) {
  return (
    <span className={cn("flex flex-wrap gap-1.5", className)}>
      {types.map((t) => (
        <span key={t} className="rounded-sm px-2 py-0.5 font-pixel text-[10px] uppercase" style={{ background: typeColor(t), color: typeTextColor(t) }}>
          {t}
        </span>
      ))}
    </span>
  );
}

/**
 * The seven axes as bars. With two profiles, each row shows both (the
 * player on top in the primary colour, the Pokémon under it in the accent).
 */
export function TraitBars({
  a,
  b,
  aLabel = "You",
  bLabel,
  accent = "hsl(var(--screen))",
  testId,
}: {
  a: Profile;
  b?: Profile;
  aLabel?: string;
  bLabel?: string;
  /** CSS colour for the second bar. */
  accent?: string;
  testId?: string;
}) {
  return (
    <ul className="space-y-3" data-testid={testId}>
      {AXES.map((axis, i) => {
        const info = AXIS_INFO[axis];
        return (
          <li key={axis} className="space-y-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-display text-sm font-bold uppercase tracking-wide">{info.label}</span>
              <span className="hud-label truncate">{a[i] >= 50 ? info.high : info.low}</span>
            </div>
            <Bar value={a[i]} label={aLabel} className="bg-primary" />
            {b && <Bar value={b[i]} label={bLabel ?? ""} style={{ background: accent }} />}
          </li>
        );
      })}
    </ul>
  );
}

function Bar({ value, label, className, style }: { value: number; label: string; className?: string; style?: React.CSSProperties }) {
  return (
    <div className="flex items-center gap-2" aria-label={`${label}: ${value} out of 100`}>
      <span className="w-14 shrink-0 truncate font-pixel text-[9px] uppercase text-muted-foreground">{label}</span>
      <div className="meter h-2 flex-1">
        <div className={cn("h-full transition-[width] duration-500", className)} style={{ width: `${value}%`, ...style }} />
      </div>
      <span className="w-7 text-right font-pixel text-[10px] tabular-nums text-muted-foreground">{value}</span>
    </div>
  );
}

/** A Pokémon as a tile: artwork, name, archetype and a match percentage. */
export function PokemonTile({
  id,
  name,
  title,
  percent,
  href,
  note,
  types,
  size = 96,
  testId,
}: {
  id: number;
  name: string;
  title?: string;
  percent?: number;
  href: string;
  note?: string;
  types?: string[];
  size?: 96 | 160;
  testId?: string;
}) {
  return (
    <Link href={href} className="menu-item group flex items-center gap-3 rounded-lg border bg-card p-3 hover:border-screen/50 hover:bg-accent/40" data-testid={testId}>
      <img src={artUrl(id, size)} alt="" width={64} height={64} loading="lazy" decoding="async" className="h-16 w-16 shrink-0 object-contain" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-display text-base font-bold uppercase tracking-wide">{name}</span>
          {percent !== undefined && <span className="shrink-0 font-pixel text-xs text-screen">{percent}%</span>}
        </span>
        {title && <span className="block truncate text-sm text-muted-foreground">{title}</span>}
        {note && <span className="block text-xs text-muted-foreground">{note}</span>}
        {types && <TypeChips types={types} className="mt-1" />}
      </span>
    </Link>
  );
}
