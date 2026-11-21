"use client";

/* eslint-disable @next/next/no-img-element -- thumbnails are pre-sized static files (public/art/160) */
import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import Link from "@/components/ui/Link";
import { motion } from "framer-motion";
import { ArrowDown, ArrowDownWideNarrow, ArrowUp, ArrowUpDown, ArrowUpNarrowWide, BookOpenCheck, Check, ChevronDown, LayoutGrid, Rows3, Search, SlidersHorizontal, X } from "lucide-react";
import { TYPES, capitalize } from "@/lib/pokemon/type-matrix";
import { typeColor } from "@/lib/pokemon/type-colors";
import { boardArtUrl } from "@/lib/pokemon/art";
import { TypeBadge } from "./TypeBadge";
import { cn } from "@/lib/utils";
import { usePlaceholder } from "@/lib/phone";
import { matchesDexQuery } from "@/lib/pokemon/dex-search";

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

/**
 * One Pokémon as the page sends it: a row of values rather than an object, so
 * the 1,025 of them in the page's data don't each repeat every field name
 * (about a third of the bytes). [id, slug, name, genus, types (space
 * separated), gen, hp, atk, def, spa, spd, spe, height, weight, flags
 * (1 legendary, 2 mythical, 4 fully evolved)]; the base stat total is the
 * stats' sum.
 */
export type DexRow = [number, string, string, string, string, number, number, number, number, number, number, number, number, number, number];

function fromRow([id, slug, name, genus, types, gen, hp, atk, def, spa, spd, spe, height, weight, flags]: DexRow): DexListItem {
  return {
    id,
    slug,
    name,
    genus,
    types: types.split(" "),
    gen,
    stats: { hp, atk, def, spa, spd, spe },
    bst: hp + atk + def + spa + spd + spe,
    height,
    weight,
    legendary: (flags & 1) !== 0,
    mythical: (flags & 2) !== 0,
    fullyEvolved: (flags & 4) !== 0,
  };
}

type SortKey = "id" | "name" | "type" | "bst" | "hp" | "atk" | "def" | "spa" | "spd" | "spe" | "height" | "weight";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "id", label: "Dex number" },
  { key: "name", label: "Name" },
  { key: "type", label: "Type" },
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

type DexView = "cards" | "table";
/** This device's last choice of cards or table. */
const VIEW_KEY = "pokeiq-dex-view";

const REGIONS = ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos", "Alola", "Galar", "Paldea"];
const PAGE = 60;
/** Cards in the first rows (two across on a phone, up to eight on a wide screen) that load their picture straight away. */
const EAGER_CARDS = 8;

/** Sorts that read best smallest (or A) first; the rest start with the biggest. */
const ASCENDING_FIRST: SortKey[] = ["id", "name", "type"];

function sortValue(p: DexListItem, key: SortKey): number | string {
  if (key === "id") return p.id;
  if (key === "name") return p.name;
  if (key === "type") return p.types.join(" ");
  if (key === "bst") return p.bst;
  if (key === "height") return p.height;
  if (key === "weight") return p.weight;
  return p.stats[key];
}

function sortLabel(p: DexListItem, key: SortKey): string | null {
  if (key === "id" || key === "name" || key === "type") return null;
  if (key === "height") return `${(p.height / 10).toFixed(1)} m`;
  if (key === "weight") return `${(p.weight / 10).toFixed(1)} kg`;
  return String(sortValue(p, key));
}

export function PokedexExplorer({ rows }: { rows: DexRow[] }) {
  const items = useMemo(() => rows.map(fromRow), [rows]);
  const searchHint = usePlaceholder("Search name, number or category…  ( / )", "Name, number, category…");
  const [query, setQuery] = useState("");
  const [types, setTypes] = useState<string[]>([]);
  const [gens, setGens] = useState<number[]>([]);
  const [legendsOnly, setLegendsOnly] = useState(false);
  const [finalOnly, setFinalOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("id");
  const [desc, setDesc] = useState(false);
  // The server always renders cards; a saved table view is applied after mount.
  const [view, setView] = useState<DexView>("cards");
  const chooseView = (v: DexView) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      // Storage blocked: the choice lasts for this visit.
    }
  };
  /** A table header: the active column flips direction, another column starts from its natural end. */
  const sortBy = (key: SortKey) => {
    if (key === sort) setDesc((d) => !d);
    else {
      setSort(key);
      setDesc(!ASCENDING_FIRST.includes(key));
    }
  };
  // Phones show the filter rows on demand so the sticky bar stays one row tall.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Cards in the prerendered HTML must be visible before hydration; only
  // cards added afterwards (scrolling, filtering) animate in.
  const [animateCards, setAnimateCards] = useState(false);
  useEffect(() => setAnimateCards(true), []);

  // Deep links from the coach / Pokédex pages (?type=fire&gen=3&sort=spe, &dir=asc for smallest first) and the home page's search (?q=pika).
  // Read after mount so the default grid stays in the static HTML for SEO.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (q) setQuery(q.slice(0, 40));
    const type = params.get("type");
    if (type && (TYPES as readonly string[]).includes(type)) setTypes([type]);
    const gen = Number(params.get("gen"));
    if (gen >= 1 && gen <= 9) setGens([gen]);
    const sortKey = SORTS.find((s) => s.key === params.get("sort"))?.key;
    if (sortKey) {
      setSort(sortKey);
      setDesc(params.get("dir") === "asc" ? false : params.get("dir") === "desc" || !ASCENDING_FIRST.includes(sortKey));
    }
    // Cards or table: ?view= first, then the last choice on this device.
    const urlView = params.get("view");
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(VIEW_KEY);
    } catch {
      // Storage blocked: cards.
    }
    const wanted = urlView === "table" || urlView === "cards" ? urlView : saved;
    if (wanted === "table") setView("table");
  }, []);
  const [visible, setVisible] = useState(PAGE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const filtered = useMemo(() => {
    const list = items.filter((p) => {
      if (!matchesDexQuery(p, query)) return false;
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
        {/* Desktop: sort | search (centred, under the section button and as wide) | view. */}
        <div className="flex flex-wrap gap-2 lg:grid lg:grid-cols-[minmax(max-content,1fr)_minmax(0,576px)_minmax(max-content,1fr)] lg:items-center">
          <div className={cn("order-last gap-2 max-md:w-full md:order-none lg:justify-end", filtersOpen ? "flex" : "hidden md:flex")}>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              aria-label="Sort by"
              className="h-11 rounded-md border border-input bg-shade/40 px-3 font-display text-sm max-md:min-w-0 max-md:flex-1 lg:w-[150px]"
            >
              {SORTS.map((s) => (
                <option key={s.key} value={s.key}>{s.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setDesc((d) => !d)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-input bg-shade/40 hover:border-screen/60"
              aria-label={desc ? "Sort ascending" : "Sort descending"}
            >
              {desc ? <ArrowDownWideNarrow className="h-4 w-4" /> : <ArrowUpNarrowWide className="h-4 w-4" />}
            </button>
          </div>
          <div className="relative order-first min-w-[180px] flex-1 max-md:min-w-0 max-md:basis-[calc(100%-6.5rem)] lg:order-none lg:min-w-0" data-testid="dex-search">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchHint}
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
          <div className={cn("order-last max-md:w-full md:order-none lg:justify-start", filtersOpen ? "flex" : "hidden md:flex")}>
            <ViewPicker view={view} onChange={chooseView} />
          </div>
          {/* Phones: Study mode sits in the toolbar instead of floating over the cards. */}
          <Link
            href="/pokedex/study"
            className="flex h-11 w-11 items-center justify-center rounded-md border border-primary/60 bg-primary/10 text-primary md:hidden"
            aria-label="Study mode"
            title="Study mode"
          >
            <BookOpenCheck className="h-5 w-5" />
          </Link>
        </div>

        <div id="dex-filters" className={cn("space-y-3", !filtersOpen && "hidden md:block")}>
          {/* One row: on a laptop or desktop all 18 fit edge to edge (tighter from lg, so Fairy isn't cut off at 1024); narrower, it scrolls. */}
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] lg:gap-1 xl:gap-1.5" data-testid="dex-type-chips">
            {TYPES.map((t) => {
              const active = types.includes(t);
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTypes((cur) => toggle(cur, t, 2))}
                  aria-pressed={active}
                  className={cn(
                    "flex-1 whitespace-nowrap rounded-[4px] border px-2.5 py-1 font-display text-[11px] font-bold uppercase tracking-wider transition-all lg:px-1 lg:tracking-wide xl:px-1.5 xl:tracking-wider",
                    active ? "border-transparent text-white" : "border-foreground/10 bg-shade/20 text-muted-foreground hover:text-foreground"
                  )}
                  style={active ? { background: typeColor(t), boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.35), inset 0 -2px 0 rgb(0 0 0 / 0.25)" } : { borderColor: `${typeColor(t)}66` }}
                >
                  {capitalize(t)}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-center gap-1.5">
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
          </div>
        </div>
      </div>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="py-20 text-center text-muted-foreground">No Pokémon match those filters.</div>
      ) : view === "table" ? (
        <DexTable list={filtered.slice(0, visible)} sort={sort} desc={desc} onSort={sortBy} />
      ) : (
        // No layout animations here: measuring up to 1,025 cards on every
        // keystroke is far too slow. Cards are memoised and fade in on mount.
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
          {filtered.slice(0, visible).map((p, i) => (
            <DexCard key={p.id} p={p} index={i % PAGE} badge={sortLabel(p, sort)} animate={animateCards} eager={i < EAGER_CARDS} />
          ))}
        </div>
      )}
      <div ref={sentinelRef} aria-hidden className="h-4" />

      <Link
        href="/pokedex/study"
        className="fixed bottom-24 right-4 z-40 flex items-center gap-2 max-md:hidden rounded-md bg-primary px-4 py-3 font-display text-sm font-bold uppercase tracking-wider text-primary-foreground shadow-[0_4px_0_hsl(var(--primary-shadow)),0_10px_30px_-8px_hsl(var(--primary)/0.6)] transition active:translate-y-[2px] lg:bottom-8"
      >
        <BookOpenCheck className="h-5 w-5" /> Study mode
      </Link>
    </div>
  );
}

const VIEWS: { id: DexView; label: string; Icon: typeof LayoutGrid }[] = [
  { id: "cards", label: "Cards", Icon: LayoutGrid },
  { id: "table", label: "Table", Icon: Rows3 },
];

/** Cards or table: a small dropdown (a list to pick from, not an on/off switch). */
function ViewPicker({ view, onChange }: { view: DexView; onChange: (v: DexView) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const current = VIEWS.find((v) => v.id === view) ?? VIEWS[0];

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const options = () => [...(listRef.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
  const openList = () => {
    setOpen(true);
    requestAnimationFrame(() => options().find((o) => o.getAttribute("aria-selected") === "true")?.focus());
  };
  const pick = (v: DexView) => {
    onChange(v);
    setOpen(false);
    buttonRef.current?.focus();
  };
  const onListKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = options();
    const at = list.indexOf(document.activeElement as HTMLButtonElement);
    const go = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    if (e.key === "ArrowDown") go(at + 1);
    else if (e.key === "ArrowUp") go(at - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(list.length - 1);
    else if (e.key === "Tab") setOpen(false);
  };

  return (
    <div ref={wrapRef} className="relative z-10 max-md:w-full" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOpen(false)}>
      <button
        ref={buttonRef}
        type="button"
        data-testid="dex-view-button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls="dex-view-list"
        onClick={() => (open ? setOpen(false) : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            openList();
          }
        }}
        className={cn(
          "flex h-11 w-[202px] items-center justify-between max-md:w-full rounded-md border border-input bg-shade/40 px-3 font-display text-sm font-semibold uppercase tracking-[0.08em] hover:border-screen/60",
          open && "border-screen/60"
        )}
      >
        <span className="flex items-center gap-2.5">
          <span className="font-pixel text-[9px] font-normal tracking-[0.12em] text-muted-foreground">View</span>
          <current.Icon className="h-[15px] w-[15px]" strokeWidth={2.2} aria-hidden />
          {current.label}
        </span>
        <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} strokeWidth={2.6} aria-hidden />
      </button>
      <div
        ref={listRef}
        id="dex-view-list"
        role="listbox"
        aria-label="View"
        data-testid="dex-view-list"
        onKeyDown={onListKey}
        className={cn(
          "absolute right-0 top-full mt-1.5 w-[202px] flex-col max-md:left-0 max-md:w-auto gap-0.5 rounded-lg border border-border bg-card p-1.5 shadow-[0_18px_44px_hsl(var(--shade)/0.6)] motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-top-1 motion-safe:duration-150",
          open ? "flex" : "hidden"
        )}
      >
        {VIEWS.map(({ id, label, Icon }) => {
          const on = id === view;
          return (
            <button
              key={id}
              type="button"
              role="option"
              aria-selected={on}
              tabIndex={-1}
              data-testid={`dex-view-${id}`}
              onClick={() => pick(id)}
              className={cn(
                "flex h-10 items-center justify-between rounded-[5px] border px-3 font-display text-[13px] font-semibold uppercase tracking-[0.08em] outline-none transition-colors motion-reduce:transition-none",
                on
                  ? "border-primary/45 bg-primary/[0.14] text-foreground"
                  : "border-transparent text-foreground/80 hover:border-border hover:bg-accent/60 hover:text-foreground focus-visible:border-border focus-visible:bg-accent/60 focus-visible:text-foreground"
              )}
            >
              <span className="flex items-center gap-2.5">
                <Icon className="h-[15px] w-[15px]" strokeWidth={2.2} aria-hidden />
                {label}
              </span>
              <Check className={cn("h-3.5 w-3.5 text-primary", !on && "opacity-0")} strokeWidth={3} aria-hidden />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Base stats, in the table's column order, with each one's bar colour. */
const STAT_COLUMNS: { key: Exclude<SortKey, "id" | "name" | "type" | "bst" | "height" | "weight">; label: string; color: string }[] = [
  { key: "hp", label: "HP", color: "#ff6b6b" },
  { key: "atk", label: "Attack", color: "#f5a65b" },
  { key: "def", label: "Defense", color: "#f7d65a" },
  { key: "spa", label: "Sp. Atk", color: "#7fa8ff" },
  { key: "spd", label: "Sp. Def", color: "#7fd49b" },
  { key: "spe", label: "Speed", color: "#f78fb3" },
];
const TABLE_COLUMNS: { key: SortKey; label: string }[] = [
  { key: "id", label: "No." },
  { key: "name", label: "Pokémon" },
  { key: "type", label: "Type" },
  ...STAT_COLUMNS,
  { key: "bst", label: "Total" },
];
/**
 * The table's columns. It scrolls sideways (No. and Pokémon pinned) when the
 * screen is narrower than its minimum; phones get tighter fixed columns so the
 * pinned two leave room for the stats.
 */
const TABLE_GRID =
  "grid min-w-[788px] grid-cols-[72px_136px_124px_repeat(6,64px)_72px] items-center md:min-w-[1160px] md:grid-cols-[86px_minmax(0,1.6fr)_150px_repeat(6,minmax(0,1fr))_minmax(0,1.15fr)]";
/** Rows in the first screen that load their picture straight away. */
const EAGER_ROWS = 10;

/** The same filtered and sorted list as the cards, as rows of base stats. The headers sort it (the toolbar's sort, shared). */
function DexTable({ list, sort, desc, onSort }: { list: DexListItem[]; sort: SortKey; desc: boolean; onSort: (key: SortKey) => void }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-background [scrollbar-width:thin]" data-testid="dex-table">
      <div className={cn(TABLE_GRID, "border-b bg-card")}>
        {TABLE_COLUMNS.map(({ key, label }, i) => {
          const on = key === sort;
          const Arrow = on ? (desc ? ArrowDown : ArrowUp) : ArrowUpDown;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onSort(key)}
              data-testid={`dex-th-${key}`}
              data-active={on ? "true" : undefined}
              aria-label={on ? `${label}, sorted ${desc ? "high to low" : "low to high"} (reverse)` : `${label} (sort the table)`}
              className={cn(
                "flex h-11 items-center gap-1.5 px-3 font-display text-[11px] font-bold uppercase tracking-[0.12em] transition-colors motion-reduce:transition-none",
                i === 0 && "sticky left-0 z-[1] md:pl-4",
                i === 1 && "sticky left-[72px] z-[1] md:left-[86px]",
                on ? "bg-accent text-foreground shadow-[inset_0_-2px_0_hsl(var(--primary))]" : "bg-inherit text-muted-foreground hover:text-foreground"
              )}
            >
              {label}
              <Arrow className={cn("h-3 w-3 shrink-0", !on && "opacity-35")} aria-hidden />
            </button>
          );
        })}
      </div>
      {list.map((p, i) => (
        <DexRowLink key={p.id} p={p} eager={i < EAGER_ROWS} />
      ))}
    </div>
  );
}

const statTone = (v: number) => (v >= 100 ? "text-foreground" : v < 50 ? "text-muted-foreground" : "text-foreground/85");

const DexRowLink = memo(function DexRowLink({ p, eager }: { p: DexListItem; eager: boolean }) {
  const c1 = typeColor(p.types[0]);
  const c2 = typeColor(p.types[1] ?? p.types[0]);
  return (
    <Link
      href={`/pokemon/${p.slug}`}
      data-testid="dex-table-row"
      className={cn(TABLE_GRID, "group relative h-[72px] border-b border-foreground/5 bg-background transition-colors last:border-b-0 hover:bg-card motion-reduce:transition-none")}
    >
      <span className="sticky left-0 z-[1] flex h-full items-center self-stretch bg-inherit pl-3 font-pixel md:pl-4 text-[10px] tracking-[0.06em] text-muted-foreground">
        <span className="absolute inset-y-0 left-0 flex w-[3px] flex-col" aria-hidden>
          <i className="flex-1" style={{ background: c1 }} />
          <i className="flex-1" style={{ background: c2 }} />
        </span>
        No.{String(p.id).padStart(4, "0")}
      </span>
      <span className="sticky left-[72px] z-[1] flex h-full min-w-0 items-center gap-2 self-stretch bg-inherit pr-0.5 md:left-[86px]">
        <span className="screen h-10 w-10 shrink-0 rounded-md md:h-[52px] md:w-[52px]">
          <span className="absolute inset-0 opacity-30 transition-opacity duration-300 group-hover:opacity-60" style={{ background: `radial-gradient(circle at 50% 60%, ${c1}, transparent 70%)` }} aria-hidden />
          <img
            src={boardArtUrl(p.id)}
            alt=""
            loading={eager ? "eager" : "lazy"}
            decoding="async"
            width={46}
            height={46}
            className="relative z-[1] m-[3px] h-[34px] w-[34px] object-contain drop-shadow-[0_4px_6px_rgba(0,0,0,0.5)] md:h-[46px] md:w-[46px]"
          />
        </span>
        <span className="truncate font-display text-[13px] font-bold uppercase tracking-wide transition-colors group-hover:text-screen md:text-[15px]" title={p.name}>{p.name}</span>
      </span>
      <span className="flex gap-1 px-3">
        {p.types.map((t) => (
          <TypeBadge key={t} type={t} size="sm" />
        ))}
      </span>
      {STAT_COLUMNS.map(({ key, color }) => {
        const v = p.stats[key];
        return (
          <span key={key} className="flex flex-col gap-1.5 px-3 tabular-nums">
            <span className={cn("font-display text-[15px] font-semibold leading-none", statTone(v))}>{v}</span>
            <span className="h-1 overflow-hidden rounded-sm bg-foreground/[0.08]">
              <span className="block h-full rounded-sm" style={{ width: `${Math.min(100, Math.round((v / 150) * 100))}%`, background: color }} />
            </span>
          </span>
        );
      })}
      <span className="flex flex-col gap-1.5 px-3 tabular-nums">
        <span className={cn("font-display text-base font-bold leading-none", p.bst >= 500 ? "text-foreground" : "text-foreground/85")}>{p.bst}</span>
        <span className="h-1 overflow-hidden rounded-sm bg-foreground/[0.08]">
          <span className="block h-full rounded-sm bg-gradient-to-r from-screen to-primary" style={{ width: `${Math.min(100, Math.round((p.bst / 680) * 100))}%` }} />
        </span>
      </span>
    </Link>
  );
});

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
  eager,
}: {
  p: DexListItem;
  index: number;
  badge: string | null;
  animate: boolean;
  /** One of the first cards on screen: its picture is the page's largest paint, so it loads at once. */
  eager: boolean;
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
            src={boardArtUrl(p.id)}
            alt={p.name}
            loading={eager ? "eager" : "lazy"}
            fetchPriority={eager ? "high" : undefined}
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
