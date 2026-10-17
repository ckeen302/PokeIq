"use client";

/* eslint-disable @next/next/no-img-element -- thumbnails come pre-sized from /api/art */
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, BookOpenCheck, Search, Shuffle, X } from "lucide-react";
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

  return (
    <div className="space-y-6">
      {/* Controls */}
      <div className="sticky top-14 z-30 -mx-4 space-y-3 border-b border-white/5 bg-background/80 px-4 py-3 backdrop-blur-xl sm:-mx-8 sm:px-8">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, number or category…  ( / )"
              aria-label="Search Pokémon"
              className="h-11 w-full rounded-xl border border-input bg-card pl-9 pr-9 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Clear search">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            aria-label="Sort by"
            className="h-11 rounded-xl border border-input bg-card px-3 text-sm"
          >
            {SORTS.map((s) => (
              <option key={s.key} value={s.key}>{s.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setDesc((d) => !d)}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-input bg-card hover:bg-accent"
            aria-label={desc ? "Sort ascending" : "Sort descending"}
          >
            {desc ? <ArrowDownWideNarrow className="h-4 w-4" /> : <ArrowUpNarrowWide className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => router.push(`/pokemon/${items[Math.floor(Math.random() * items.length)].slug}`)}
            className="flex h-11 items-center gap-2 rounded-xl border border-input bg-card px-3 text-sm hover:bg-accent"
          >
            <Shuffle className="h-4 w-4" /> <span className="hidden sm:inline">Surprise me</span>
          </button>
        </div>

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
                  "shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide transition-all",
                  active ? "scale-105 border-transparent text-white shadow-lg" : "border-white/10 text-muted-foreground hover:text-foreground"
                )}
                style={active ? { background: typeColor(t), boxShadow: `0 0 14px -2px ${typeColor(t)}` } : { borderColor: `${typeColor(t)}55` }}
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
                "rounded-full border px-2.5 py-1 text-xs transition-colors",
                gens.includes(i + 1) ? "border-primary bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              )}
              title={region}
            >
              Gen {i + 1}
            </button>
          ))}
          <span className="mx-1 h-4 w-px bg-white/10" aria-hidden />
          <Toggle active={legendsOnly} onClick={() => setLegendsOnly((v) => !v)}>Legendary & Mythical</Toggle>
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
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {filtered.length.toLocaleString()} Pokémon
          </span>
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground">No Pokémon match those filters.</div>
      ) : (
        <motion.div layout className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          <AnimatePresence mode="popLayout" initial={false}>
            {filtered.slice(0, visible).map((p, i) => (
              <DexCard key={p.id} p={p} index={i % PAGE} badge={sortLabel(p, sort)} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
      <div ref={sentinelRef} aria-hidden className="h-4" />

      <Link
        href="/pokedex/study"
        className="fixed bottom-24 right-4 z-40 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-bold text-primary-foreground shadow-xl shadow-primary/30 transition hover:scale-105 md:bottom-8"
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
        "rounded-full border px-2.5 py-1 text-xs transition-colors",
        active ? "border-primary/60 bg-primary/15 text-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

function DexCard({ p, index, badge }: { p: DexListItem; index: number; badge: string | null }) {
  const c1 = typeColor(p.types[0]);
  const c2 = typeColor(p.types[1] ?? p.types[0]);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 18, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.3, delay: Math.min(index, 24) * 0.02 }}
    >
      <Link
        href={`/pokemon/${p.slug}`}
        className="group relative block overflow-hidden rounded-2xl border border-white/10 p-3 transition-all duration-300 hover:-translate-y-1 hover:border-white/25"
        style={{
          background: `radial-gradient(120% 90% at 50% 0%, ${c1}38 0%, transparent 60%), linear-gradient(160deg, ${c1}1f, ${c2}14 60%, hsl(var(--card)) 100%)`,
        }}
      >
        <span
          className="pointer-events-none absolute -right-1 -top-2 select-none text-5xl font-black tabular-nums text-white/[0.06] transition-colors group-hover:text-white/10"
          aria-hidden
        >
          {String(p.id).padStart(4, "0")}
        </span>
        <div
          className="pointer-events-none absolute inset-x-6 top-6 aspect-square rounded-full opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-60"
          style={{ background: c1 }}
          aria-hidden
        />
        <div className="relative mx-auto aspect-square w-full max-w-[140px]">
          <img
            src={artUrl(p.id, 160)}
            alt={p.name}
            loading="lazy"
            decoding="async"
            width={160}
            height={160}
            className="h-full w-full object-contain drop-shadow-[0_8px_14px_rgba(0,0,0,0.45)] transition-transform duration-500 ease-out group-hover:-translate-y-1 group-hover:scale-110 group-hover:-rotate-3"
          />
        </div>
        <div className="relative mt-2 space-y-1.5">
          <div className="flex items-baseline justify-between gap-1">
            <span className="truncate font-bold">{p.name}</span>
            <span className="shrink-0 font-mono text-[10px] text-muted-foreground">#{String(p.id).padStart(4, "0")}</span>
          </div>
          <div className="flex items-center justify-between gap-1">
            <div className="flex gap-1">
              {p.types.map((t) => (
                <TypeBadge key={t} type={t} size="sm" />
              ))}
            </div>
            {badge && <span className="rounded-md bg-black/30 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums">{badge}</span>}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
