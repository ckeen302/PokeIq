"use client";

/* eslint-disable @next/next/no-img-element -- thumbnails come pre-sized from /api/art */
import { memo, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, BookOpenCheck, Search, Shuffle, SlidersHorizontal, X } from "lucide-react";
import { TYPES, capitalize } from "@/lib/pokemon/type-matrix";
import { typeColor } from "@/lib/pokemon/type-colors";
import { artUrl } from "@/lib/pokemon/art";
import { TypeBadge } from "./TypeBadge";
import { cn } from "@/lib/utils";

export interface DexListItem {
  id: number;
  slug: string;
  name: string;
  genus: string;
  types: string[];
  gen: number;
  stats: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number };
  bst: number;
  height: number;
  weight: number;
  legendary: boolean;
  mythical: boolean;
  fullyEvolved: boolean;
}

type SortKey = "id" | "name" | "bst" | "hp" | "atk" | "def" | "spa" | "spd" | "spe" | "height" | "weight";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "id", label: "Dex number" },
  { key: "name", label: "Name" },
  { key: "bst", label: "Base stat total" },
  { key: "hp", label: "HP" },
  { key: "atk", label: "Attack" },
  { key: "def", label: "Defense" },
  { key: "spa", label: "Sp. Atk" },
  { key: "spd", label: "Sp. Def" },
  { key: "spe", label: "Speed" },
  { key: "height", label: "Height" },
  { key: "weight", label: "Weight" },
];

const REGIONS = ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Galar", "Paldea"];
const PAGE = 60;

const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

function sortValue(p: DexListItem, key: SortKey): number | string {
  if (key === "id") return p.id;
  if (key === "name") return p.name;
  if (key === "bst") return p.bst;
  if (key === "height") return p.height;
  if (key === "weight") return p.weight;
  return p.stats[key];
}

function sortLabel(p: DexListItem, key: SortKey): string | null {
  if (key === "id" || key === "name") return null;
  if (key === "height") return `${(p.height / 10).toFixed(1)} m`;
  if (key === "weight") return `${(p.weight / 10).toFixed(1)} kg`;
  return String(sortValue(p, key));
}

export function PokedexExplorer({ items }: { items: DexListItem[] }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [gens, setGens] = useState<number[]>([]);
  const [legendsOnly, setLegendsOnly] = useState(false);
  const [finalOnly, setFinalOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("id");
  const [desc, setDesc] = useState(false);
  // Phones show the filter rows on demand so the sticky bar stays one row tall.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Cards in the prerendered HTML must be visible before hydration; only
  // cards added afterwards (scrolling, filtering) animate in.
  const [animateCards, setAnimateCards] = useState(false);
  useEffect(() => setAnimateCards(true), []);

  // Deep links from the coach / Pokédex pages (?type=fire&gen=3&sort=spe).
  // Read after mount so the default grid stays in the static HTML for SEO.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const type = params.get("type");
    if (type && (TYPES as readonly string[]).includes(type)) setTypes([type]);
    const gen = Number(params.get("gen"));
    if (gen >= 1 && gen <= 9) setGens([gen]);
    const sortKey = SORTS.find((s) => s.key === params.get("sort"))?.key;
    if (sortKey) {
      setSort(sortKey);
      setDesc(sortKey !== "id" && sortKey !== "name");
    }
  }, []);
  const [visible, setVisible] = useState(PAGE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const q = normalize(query);
    const num = /^\d+$/.test(query.trim()) ? Number(query.trim()) : null;
    const list = items.filter((p) => {
      if (q && !(num !== null ? String(p.id).startsWith(String(num)) : normalize(p.name).includes(q) || normalize(p.genus).includes(q)))
        return false;
      if (types.length && !types.every((t) => p.types.includes(t))) return false;
      if (gens.length && !gens.includes(p.gen)) return false;
      if (legendsOnly && !(p.legendary || p.mythical)) return false;
      if (finalOnly && !p.fullyEvolved) return false;
      return true;
    });
    const dir = desc ? -1 : 1;
    return list.sort((a, b) => {
      const va = sortValue(a, sort);
      const vb = sortValue(b, sort);
      const cmp = typeof va === "string" ? va.localeCompare(vb as string) : (va as number) - (vb as number);
      return cmp * dir || a.id - b.id;
    });
  }, [items, query, types, gens, legendsOnly, finalOnly, sort, desc]);

  // Reset the window whenever the result set changes.
  useEffect(() => setVisible(PAGE), [query, types, gens, legendsOnly, finalOnly, sort, desc]);

  // Infinite scroll.
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

  // "/" focuses search.
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

  const toggle = <T,>(list: T[], value: T, max = Infinity) =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value].slice(-max);

  const hasFilters = query || types.length || gens.length || legendsOnly || finalOnly;
  const activeFilters = types.length + gens.length + Number(legendsOnly) + Number(finalOnly);

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="sticky top-14 z-30 -mx-4 space-y-3 border-b border-foreground/5 bg-background/80 px-4 py-3 backdrop-blur-xl sm:-mx-8 sm:px-8">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, number or category…  ( / )"
              aria-label="Search Pokémon"
              className="h-11 w-full rounded-md border border-input bg-shade/40 pl-9 pr-9 font-display text-sm tracking-wide focus-visible:border-screen/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setFiltersOpen((o) => !o)}
            aria-expanded={filtersOpen}
            aria-controls="dex-filters"
            className={cn(
              "relative flex h-11 w-11 items-center justify-center rounded-md border border-input bg-shade/40 hover:border-screen/60 md:hidden",
              filtersOpen && "border-screen/60 text-screen"
            )}
            aria-label={filtersOpen ? "Hide filters" : "Show filters"}
          >
            <SlidersHorizontal className="h-4 w-4" />
            {activeFilters > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 font-pixel text-[9px] text-primary-foreground">
                {activeFilters}
              </span>
            )}
          </button>
          <div className={cn("order-last gap-2 md:order-none", filtersOpen ? "flex" : "hidden md:flex")}>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="Sort by"
              className="h-11 rounded-md border border-input bg-shade/40 px-3 font-display text-sm"
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setDesc((d) => !d)}
              className="flex h-11 w-11 items-center justify-center rounded-md border border-input bg-shade/40 hover:border-screen/60"
              aria-label={desc ? "Sort ascending" : "Sort descending"}
            >
              {desc ? <ArrowDownWideNarrow className="h-4 w-4" /> : <ArrowUpNarrowWide className="h-4 w-4" />}
            </button>
          </div>
          <button
            type="button"
            onClick={() => router.push(`/pokemon/${items[Math.floor(Math.random() * items.length)].slug}`)}
            className="flex h-11 items-center gap-2 rounded-md border border-input bg-shade/40 px-3 font-display text-sm font-semibold uppercase tracking-wider hover:border-screen/60"
            aria-label="Surprise me: open a random Pokémon"
          >
            <Shuffle className="h-4 w-4" /> <span className="hidden sm:inline">Surprise me</span>
          </button>
        </div>

        <div id="dex-filters" className={cn("space-y-3", !filtersOpen && "hidden md:block")}>
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
            {TYPES.map((t) => {
              const active = types.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTypes((cur) => toggle(cur, t, 2))}
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

          <div className="flex flex-wrap items-center gap-1.5">
            {REGIONS.map((region, i) => (
              <button
                key={region}
                type="button"
                onClick={() => setGens((cur) => toggle(cur, i + 1))}
                aria-pressed={gens.includes(i + 1)}
                className={cn(
                  "rounded-sm border px-2.5 py-1.5 font-pixel text-[10px] uppercase tracking-wider transition-colors",
                  gens.includes(i + 1) ? "border-primary bg-primary text-primary-foreground" : "border-foreground/10 bg-shade/20 text-muted-foreground hover:text-foreground"
                )}
                title={region}
              >
                Gen {i + 1}
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-foreground/10" aria-hidden />
            <Toggle active={legendsOnly} onClick={() => setLegendsOnly((v) => !v)}>Legendary + Mythical</Toggle>
            <Toggle active={finalOnly} onClick={() => setFinalOnly((v) => !v)}>Fully evolved</Toggle>
            {hasFilters ? (
              <button
                type="button"
                onClick={() => {
                  setQuery("");
                  setTypes([]);
                  setGens([]);
                  setLegendsOnly(false);
                  setFinalOnly(false);
                }}
                className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
              >
                Reset
              </button>
            ) : null}
            <span className="hud-label ml-auto tabular-nums text-screen">
              {filtered.length.toLocaleString("en-US")} Pokémon
            </span>
          </div>
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground">No Pokémon match those filters.</div>
      ) : (
        // No layout animations here: measuring up to 1,025 cards on every
        // keystroke is far too slow. Cards are memoised and fade in on mount.
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {filtered.slice(0, visible).map((p, i) => (
            <DexCard key={p.id} p={p} index={i % PAGE} badge={sortLabel(p, sort)} animate={animateCards} />
          ))}
        </div>
      )}
      <div ref={sentinelRef} aria-hidden className="h-4" />

      <Link
        href="/pokedex/study"
        className="fixed bottom-24 right-4 z-40 flex items-center gap-2 rounded-md bg-primary px-4 py-3 font-display text-sm font-bold uppercase tracking-wider text-primary-foreground shadow-[0_4px_0_hsl(var(--primary-shadow)),0_10px_30px_-8px_hsl(var(--primary)/0.6)] transition active:translate-y-[2px] md:bottom-8"
      >
        <BookOpenCheck className="h-5 w-5" /> Study mode
      </Link>
    </div>
  );
}

function Toggle({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-sm border px-2.5 py-1.5 font-pixel text-[10px] uppercase tracking-wider transition-colors",
        active ? "border-screen/70 bg-screen/10 text-foreground" : "border-foreground/10 bg-shade/20 text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

const DexCard = memo(function DexCard({
  p,
  index,
  badge,
  animate,
}: {
  p: DexListItem;
  index: number;
  badge: string | null;
  animate: boolean;
}) {
  const c1 = typeColor(p.types[0]);
  const c2 = typeColor(p.types[1] ?? p.types[0]);
  return (
    <motion.div
      initial={animate ? { opacity: 0, y: 18, scale: 0.96 } : false}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.3, delay: Math.min(index, 24) * 0.02 }}
    >
      <Link
        href={`/pokemon/${p.slug}`}
        className="group relative block overflow-hidden rounded-lg border bg-card transition-colors duration-200 hover:border-screen/60"
      >
        {/* Type stripe */}
        <div className="flex h-[3px]" aria-hidden>
          <span className="flex-1" style={{ background: c1 }} />
          <span className="flex-1" style={{ background: c2 }} />
        </div>
        <div className="flex items-center justify-between px-3 pt-2">
          <span className="font-pixel text-[10px] tracking-wider text-muted-foreground">No.{String(p.id).padStart(4, "0")}</span>
          {badge && <span className="font-pixel text-[10px] tabular-nums text-screen">{badge}</span>}
        </div>
        <div className="screen mx-3 mt-2 aspect-square rounded-md">
          <div
            className="absolute inset-0 opacity-30 transition-opacity duration-300 group-hover:opacity-60"
            style={{ background: `radial-gradient(circle at 50% 60%, ${c1}, transparent 65%)` }}
            aria-hidden
          />
          <img
            src={artUrl(p.id, 160)}
            alt={p.name}
            loading="lazy"
            decoding="async"
            width={160}
            height={160}
            className="relative z-[1] h-full w-full object-contain p-2 drop-shadow-[0_8px_14px_rgba(0,0,0,0.5)] transition-transform duration-300 ease-out group-hover:scale-110"
          />
        </div>
        <div className="space-y-2 p-3">
          <div className="truncate font-display text-[15px] font-bold uppercase tracking-wide transition-colors group-hover:text-screen">
            {p.name}
          </div>
          <div className="flex gap-1">
            {p.types.map((t) => (
              <TypeBadge key={t} type={t} size="sm" />
            ))}
          </div>
        </div>
      </Link>
    </motion.div>
  );
});
