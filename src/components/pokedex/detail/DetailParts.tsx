/* eslint-disable @next/next/no-img-element -- thumbnails come pre-sized from /api/art */
import Link from "next/link";
import { BackButton } from "@/components/ui/BackButton";
import { artUrl } from "@/lib/pokemon/art";
import { typeColor } from "@/lib/pokemon/type-colors";
import { TypeBadge } from "../TypeBadge";

/** Breadcrumb row shared by the move / ability / item pages. */
export function DetailNav({ tab, label }: { tab: string; label: string }) {
  return (
    <nav className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <BackButton href={`/pokedex/${tab}`} label={label} />
      <Link href="/pokedex" className="hover:text-foreground">
        Pokédex
      </Link>
    </nav>
  );
}

/** Title card in the same HUD style as the Pokémon entry hero. */
export function DetailHero({
  kicker,
  title,
  children,
  media,
}: {
  kicker: string;
  title: string;
  children?: React.ReactNode;
  media?: React.ReactNode;
}) {
  return (
    <header className="hud flex flex-wrap items-center gap-5 rounded-lg border bg-card p-5 sm:p-6">
      {media}
      <div className="min-w-0 flex-1 space-y-3">
        <p className="hud-label text-screen">{kicker}</p>
        <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">{title}</h1>
        {children}
      </div>
    </header>
  );
}

export function StatBox({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-foreground/10 bg-shade/30 px-3 py-2">
      <div className="font-pixel text-[9px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-mono text-lg tabular-nums">{value}</div>
    </div>
  );
}

export interface SpeciesChip {
  id: number;
  slug: string;
  name: string;
  types: string[];
  note?: string;
}

/** Grid of Pokémon that link to their Pokédex entries. */
export function SpeciesGrid({ list }: { list: SpeciesChip[] }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
      {list.map((p) => (
        <Link
          key={p.id}
          href={`/pokemon/${p.slug}`}
          className="group relative block overflow-hidden rounded-lg border bg-card transition-colors hover:border-screen/60"
        >
          <div className="flex h-[3px]" aria-hidden>
            <span className="flex-1" style={{ background: typeColor(p.types[0]) }} />
            <span className="flex-1" style={{ background: typeColor(p.types[1] ?? p.types[0]) }} />
          </div>
          <div className="flex items-center gap-2 p-2">
            <img src={artUrl(p.id, 96)} alt="" loading="lazy" decoding="async" width={48} height={48} className="h-12 w-12 shrink-0 object-contain" />
            <div className="min-w-0 space-y-1">
              <div className="truncate font-display text-sm font-bold uppercase tracking-wide group-hover:text-screen">{p.name}</div>
              <div className="flex gap-1">
                {p.types.map((t) => (
                  <TypeBadge key={t} type={t} size="sm" />
                ))}
              </div>
              {p.note && <div className="truncate font-pixel text-[9px] uppercase tracking-wider text-muted-foreground">{p.note}</div>}
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

export function ListHeader({ kicker, title, accent, blurb }: { kicker: string; title: string; accent: string; blurb: string }) {
  return (
    <div className="space-y-2 text-center">
      <div className="text-left">
        <BackButton href="/pokedex" />
      </div>
      <p className="hud-label text-screen">{kicker}</p>
      <h1 className="font-display text-4xl font-bold uppercase tracking-tight sm:text-5xl">
        {title}
        <span className="text-primary">{accent}</span>
      </h1>
      <p className="mx-auto max-w-2xl text-muted-foreground">{blurb}</p>
    </div>
  );
}
