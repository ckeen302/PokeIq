"use client";

/* eslint-disable @next/next/no-img-element -- item sprites are tiny remote PNGs */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Search, Swords, Sparkle, CircleDot, X } from "lucide-react";
import { TYPES, capitalize } from "@/lib/pokemon/type-matrix";
import { typeColor } from "@/lib/pokemon/type-colors";
import { itemSpriteUrl } from "@/lib/dex/build";
import { TypeBadge } from "./TypeBadge";
import { cn } from "@/lib/utils";

export interface MoveListItem {
  slug: string;
  name: string;
  type: string;
  cls: string;
  power: number | null;
  accuracy: number | null;
  pp: number | null;
}
export interface AbilityListItem {
  slug: string;
  name: string;
  effect: string;
  count: number;
}
export interface ItemListItem {
  slug: string;
  name: string;
  category: string;
}

export interface PlaceListItem {
  slug: string;
  name: string;
  region: string;
  type: string;
  parent?: string;
}

export type DexListKind = "moves" | "abilities" | "items" | "places";

const PAGE = 60;
const CLASSES = ["physical", "special", "status"] as const;
const CLASS_ICON = { physical: Swords, special: Sparkle, status: CircleDot } as const;
const CLASS_CLS = { physical: "text-orange-400", special: "text-sky-400", status: "text-zinc-400" } as const;

const normalize = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

type Item = MoveListItem | AbilityListItem | ItemListItem | PlaceListItem;

export function DexListExplorer({ kind, items }: { kind: DexListKind; items: Item[] }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<string | null>(null);
  const [cls, setCls] = useState<string | null>(null);
  const [category, setCategory] = useState("");
  const [region, setRegion] = useState("");
  const [placeType, setPlaceType] = useState("");
  const [visible, setVisible] = useState(PAGE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const categories = useMemo(
    () => (kind === "items" ? [...new Set((items as ItemListItem[]).map((i) => i.category))].sort() : []),
    [kind, items]
  );
  const regions = useMemo(() => (kind === "places" ? [...new Set((items as PlaceListItem[]).map((i) => i.region))].sort() : []), [kind, items]);
  const placeTypes = useMemo(() => (kind === "places" ? [...new Set((items as PlaceListItem[]).map((i) => i.type))].sort() : []), [kind, items]);

  const filtered = useMemo(() => {
    const q = normalize(query);
    return items.filter((it) => {
      if (q && !normalize(it.name).includes(q) && !(kind === "abilities" && normalize((it as AbilityListItem).effect).includes(q))) return false;
      if (kind === "moves") {
        const m = it as MoveListItem;
        if (type && m.type !== type) return false;
        if (cls && m.cls !== cls) return false;
      }
      if (kind === "items" && category && (it as ItemListItem).category !== category) return false;
      if (kind === "places" && region && (it as PlaceListItem).region !== region) return false;
      if (kind === "places" && placeType && (it as PlaceListItem).type !== placeType) return false;
      return true;
    });
  }, [items, kind, query, type, cls, category, region, placeType]);

  useEffect(() => setVisible(PAGE), [query, type, cls, category, region, placeType]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => entries[0].isIntersecting && setVisible((v) => Math.min(v + PAGE, filtered.length)),
      { rootMargin: "800px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [filtered.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== searchRef.current) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const label = kind;
  const hasFilters = query || type || cls || category || region || placeType;
  const reset = () => {
    setQuery("");
    setType(null);
    setCls(null);
    setCategory("");
    setRegion("");
    setPlaceType("");
  };

  return (
    <div className="space-y-6">
      <div className="sticky top-14 z-30 -mx-4 space-y-3 border-b border-foreground/5 bg-background/80 px-4 py-3 backdrop-blur-xl sm:-mx-8 sm:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Search ${label}…  ( / )`}
              aria-label={`Search ${label}`}
              className="h-11 w-full rounded-md border border-input bg-shade/40 pl-9 pr-9 font-display text-sm tracking-wide focus-visible:border-screen/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          {kind === "items" && (
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              aria-label="Item category"
              className="h-11 max-w-[220px] rounded-md border border-input bg-shade/40 px-3 font-display text-sm"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
          {kind === "places" && (
            <>
              <select value={region} onChange={(e) => setRegion(e.target.value)} aria-label="Region" className="h-11 max-w-[200px] rounded-md border border-input bg-shade/40 px-3 font-display text-sm">
                <option value="">All regions</option>
                {regions.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <select value={placeType} onChange={(e) => setPlaceType(e.target.value)} aria-label="Place type" className="h-11 max-w-[200px] rounded-md border border-input bg-shade/40 px-3 font-display text-sm">
                <option value="">All types</option>
                {placeTypes.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </>
          )}
        </div>

        {kind === "moves" && (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
            {TYPES.map((t) => {
              const active = type === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(active ? null : t)}
                  aria-pressed={active}
                  className={cn(
                    "shrink-0 rounded-[4px] border px-2.5 py-1 font-display text-[11px] font-bold uppercase tracking-wider transition-all",
                    active ? "border-transparent text-white" : "border-foreground/10 bg-shade/20 text-muted-foreground hover:text-foreground"
                  )}
                  style={active ? { background: typeColor(t), boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.35), inset 0 -2px 0 rgb(0 0 0 / 0.25)" } : { borderColor: `${typeColor(t)}66` }}
                >
                  {capitalize(t)}
                </button>
              );
            })}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {kind === "moves" &&
            CLASSES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCls(cls === c ? null : c)}
                aria-pressed={cls === c}
                className={cn(
                  "rounded-sm border px-2.5 py-1.5 font-pixel text-[10px] uppercase tracking-wider transition-colors",
                  cls === c ? "border-screen/70 bg-screen/10 text-foreground" : "border-foreground/10 bg-shade/20 text-muted-foreground hover:text-foreground"
                )}
              >
                {c}
              </button>
            ))}
          {hasFilters ? (
            <button type="button" onClick={reset} className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              Reset
            </button>
          ) : null}
          <span className="hud-label ml-auto tabular-nums text-screen">
            {filtered.length.toLocaleString("en-US")} {label}
          </span>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground">No {label} match those filters.</div>
      ) : kind === "moves" ? (
        <div className="hud overflow-x-auto rounded-lg border bg-card p-2" data-hscroll>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="p-2">Move</th>
                <th className="p-2">Type</th>
                <th className="p-2">Cat.</th>
                <th className="p-2 text-right">Pow</th>
                <th className="hidden p-2 text-right sm:table-cell">Acc</th>
                <th className="hidden p-2 text-right sm:table-cell">PP</th>
              </tr>
            </thead>
            <tbody>
              {(filtered.slice(0, visible) as MoveListItem[]).map((m) => {
                const Icon = CLASS_ICON[m.cls as keyof typeof CLASS_ICON] ?? CircleDot;
                return (
                  <tr key={m.slug} className="border-b border-foreground/5 transition-colors hover:bg-foreground/[0.03]">
                    <td className="p-2 font-semibold">
                      <Link href={`/pokedex/moves/${m.slug}`} className="hover:text-screen">{m.name}</Link>
                    </td>
                    <td className="p-2"><TypeBadge type={m.type} size="sm" /></td>
                    <td className="p-2"><Icon className={cn("h-4 w-4", CLASS_CLS[m.cls as keyof typeof CLASS_CLS])} aria-label={m.cls} /></td>
                    <td className="p-2 text-right font-mono tabular-nums">{m.power ?? "—"}</td>
                    <td className="hidden p-2 text-right font-mono tabular-nums sm:table-cell">{m.accuracy ?? "—"}</td>
                    <td className="hidden p-2 text-right font-mono tabular-nums sm:table-cell">{m.pp ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : kind === "abilities" ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(filtered.slice(0, visible) as AbilityListItem[]).map((a) => (
            <Link key={a.slug} href={`/pokedex/abilities/${a.slug}`} className="group block space-y-1.5 rounded-lg border bg-card p-4 transition-colors hover:border-screen/60">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-display text-[15px] font-bold uppercase tracking-wide group-hover:text-screen">{a.name}</span>
                <span className="font-pixel text-[10px] tabular-nums text-muted-foreground">{a.count} Pokémon</span>
              </div>
              <p className="line-clamp-2 text-xs text-muted-foreground">{a.effect}</p>
            </Link>
          ))}
        </div>
      ) : kind === "places" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {(filtered.slice(0, visible) as PlaceListItem[]).map((it) => (
            <Link key={it.slug} href={`/pokedex/places/${it.slug}`} data-testid="place-card" className="group rounded-lg border bg-card p-3 transition-colors hover:border-screen/60">
              <span className="block truncate font-display text-sm font-bold uppercase tracking-wide group-hover:text-screen">{it.name}</span>
              <span className="block truncate font-pixel text-[9px] uppercase tracking-wider text-muted-foreground">
                {it.type} · {it.parent ? `${it.parent}, ` : ""}{it.region}
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {(filtered.slice(0, visible) as ItemListItem[]).map((it) => (
            <Link key={it.slug} href={`/pokedex/items/${it.slug}`} className="group flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors hover:border-screen/60">
              <span className="screen flex h-11 w-11 shrink-0 items-center justify-center rounded-md">
                <img src={itemSpriteUrl(it.slug)} alt="" loading="lazy" decoding="async" width={32} height={32} className="relative z-[1] h-8 w-8 object-contain [image-rendering:pixelated]" />
              </span>
              <span className="min-w-0">
                <span className="block truncate font-display text-sm font-bold uppercase tracking-wide group-hover:text-screen">{it.name}</span>
                <span className="block truncate font-pixel text-[9px] uppercase tracking-wider text-muted-foreground">{it.category}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
      <div ref={sentinelRef} aria-hidden className="h-4" />
    </div>
  );
}
