"use client";

import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import tierList from "@/messages/tier-list";
import { applyFilter, isFiltered, NO_FILTER, type FormFilter, type PoolFilter, type SortKey } from "@/lib/tier-list/filter";
import { CATEGORIES, GENERATIONS, TYPES, type Category, type Mon } from "@/lib/tier-list/types";
import type { ArtStyle } from "@/lib/tier-list/art";
import { Tile } from "./Tile";

export interface PoolHandle {
  focusSearch(): void;
}

interface Props {
  mons: readonly Mon[];
  art: ArtStyle;
  shiny: boolean;
  tile: number;
  names: boolean;
  selected: ReadonlySet<string>;
  moving: ReadonlySet<string>;
  /** The drop zone's name (tiles dropped here go back to the pool). */
  zone?: string;
  from: string;
  onTileDown?(e: React.PointerEvent<HTMLElement>, key: string, from: string): void;
  onTileClick?(e: React.MouseEvent<HTMLElement>, key: string, from: string): void;
  onTileDouble?(key: string, from: string): void;
  /** Shown above the grid, under the search (the Add Pokémon button). */
  actions?: ReactNode;
  empty: ReactNode;
  /** Marks tiles (the Add picker's "added"). */
  badge?(m: Mon): ReactNode;
  className?: string;
  testId?: string;
}

const GAP = 6;
const OVERSCAN = 3;

/**
 * The pool: search by name or number, filters (generation, type, form, category) and a sort, over a virtualised grid
 * (only the rows in view are in the page, so every Pokémon and form at once still scrolls and drags smoothly).
 */
export const Pool = forwardRef<PoolHandle, Props>(function Pool(
  { mons, art, shiny, tile, names, selected, moving, zone, from, onTileDown, onTileClick, onTileDouble, actions, empty, badge, className, testId },
  ref
) {
  const t = useT(tierList);
  const [filter, setFilter] = useState<PoolFilter>(NO_FILTER);
  const [showFilters, setShowFilters] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focusSearch: () => search.current?.focus() }), []);
  const shown = useMemo(() => applyFilter(mons, filter), [mons, filter]);
  const set = <K extends keyof PoolFilter>(k: K, v: PoolFilter[K]) => setFilter((f) => ({ ...f, [k]: v }));

  return (
    <div className={cn("flex min-h-0 flex-col", className)} data-testid={testId}>
      <div className="space-y-2 pb-3">
        <div className="flex gap-2">
          <label className="relative flex h-11 min-w-0 flex-1 items-center rounded-xl bg-foreground/[0.05] focus-within:ring-2 focus-within:ring-ring">
            <Search className="pointer-events-none absolute left-3 h-4 w-4 text-muted-foreground" aria-hidden />
            <span className="sr-only">{t("pool.searchLabel")}</span>
            <input
              ref={search}
              type="search"
              value={filter.q}
              onChange={(e) => set("q", e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && (set("q", ""), e.currentTarget.blur())}
              placeholder={t("pool.search")}
              className="h-full w-full min-w-0 bg-transparent pl-9 pr-9 text-[15px] outline-none placeholder:text-muted-foreground/80 [&::-webkit-search-cancel-button]:hidden"
              data-testid={testId ? `${testId}-search` : undefined}
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
            />
            {filter.q && (
              <button type="button" onClick={() => set("q", "")} className="absolute right-1.5 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground" aria-label={t("pool.clear")}>
                <X className="h-4 w-4" aria-hidden />
              </button>
            )}
          </label>
          <button
            type="button"
            onClick={() => setShowFilters((s) => !s)}
            aria-expanded={showFilters}
            className={cn("relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.05] text-muted-foreground transition-colors hover:text-foreground", showFilters && "bg-foreground/[0.1] text-foreground")}
            aria-label={t("pool.filters")}
            title={t("pool.filters")}
            data-testid={testId ? `${testId}-filters` : undefined}
          >
            <SlidersHorizontal className="h-[18px] w-[18px]" aria-hidden />
            {isFiltered({ ...filter, q: "" }) && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary" aria-hidden />}
          </button>
        </div>
        {showFilters && (
          <div className="grid grid-cols-2 gap-2" data-testid={testId ? `${testId}-filter-row` : undefined}>
            <Select label={t("pool.gen")} value={filter.gen ?? ""} onChange={(v) => set("gen", v ? Number(v) : null)} options={[["", t("pool.anyGen")], ...GENERATIONS.map((g) => [String(g), t("pool.genN", { n: g })] as [string, string])]} />
            <Select label={t("pool.type")} value={filter.type ?? ""} onChange={(v) => set("type", v || null)} options={[["", t("pool.anyType")], ...TYPES.map((ty) => [ty, t(`typeNames.${ty}`)] as [string, string])]} />
            <Select
              label={t("pool.form")}
              value={filter.form}
              onChange={(v) => set("form", v as FormFilter)}
              options={[["any", t("pool.anyForm")], ...(["species", "mega", "gmax", "regional", "other"] as const).map((f) => [f, t(`pool.forms.${f}`)] as [string, string])]}
            />
            <Select label={t("pool.category")} value={filter.cat ?? ""} onChange={(v) => set("cat", (v || null) as Category | null)} options={[["", t("pool.anyCategory")], ...CATEGORIES.map((c) => [c, t(`pool.categories.${c}`)] as [string, string])]} />
            <Select label={t("pool.sort")} value={filter.sort} onChange={(v) => set("sort", v as SortKey)} options={(["dex", "name", "bst"] as const).map((s) => [s, t(`pool.sorts.${s}`)] as [string, string])} />
            <button type="button" disabled={!isFiltered(filter) && filter.sort === "dex"} onClick={() => setFilter(NO_FILTER)} className="h-10 rounded-xl text-sm font-medium text-muted-foreground transition-colors hover:bg-foreground/[0.05] hover:text-foreground disabled:opacity-40">
              {t("pool.resetFilters")}
            </button>
          </div>
        )}
        {actions}
      </div>
      <Grid
        mons={shown}
        art={art}
        shiny={shiny}
        tile={tile}
        names={names}
        selected={selected}
        moving={moving}
        zone={zone}
        from={from}
        onTileDown={onTileDown}
        onTileClick={onTileClick}
        onTileDouble={onTileDouble}
        badge={badge}
        empty={mons.length ? <p className="px-2 py-10 text-center text-sm text-muted-foreground">{t("pool.noMatch")}</p> : empty}
        testId={testId}
      />
    </div>
  );
});

function Select({ label, value, onChange, options }: { label: string; value: string | number; onChange(v: string): void; options: [string, string][] }) {
  return (
    <label className="relative block">
      <span className="sr-only">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 w-full appearance-none rounded-xl bg-foreground/[0.05] px-3 pr-8 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={label}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <svg className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" viewBox="0 0 12 12" aria-hidden>
        <path d="M2 4l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </label>
  );
}

interface GridProps extends Pick<Props, "art" | "shiny" | "tile" | "names" | "selected" | "moving" | "zone" | "from" | "onTileDown" | "onTileClick" | "onTileDouble" | "badge" | "testId"> {
  mons: readonly Mon[];
  empty: ReactNode;
}

/** The virtualised grid: fixed-size cells, only the rows in view (and a few either side) rendered. */
function Grid({ mons, art, shiny, tile, names, selected, moving, zone, from, onTileDown, onTileClick, onTileDouble, badge, empty, testId }: GridProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ w: 0, h: 0, top: 0 });
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setView({ w: el.clientWidth, h: el.clientHeight, top: el.scrollTop });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    let raf = 0;
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(() => ((raf = 0), setView((v) => (v.top === el.scrollTop ? v : { ...v, top: el.scrollTop }))));
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);
  // A new list starts at the top.
  const first = mons[0]?.k;
  useEffect(() => {
    if (scroller.current && scroller.current.scrollTop > 0 && first === undefined) scroller.current.scrollTop = 0;
  }, [first]);

  const inner = Math.max(0, view.w - 8);
  const cols = Math.max(1, Math.floor((inner + GAP) / (tile + GAP)));
  // Spread the spare width between the columns, so the grid fills its panel edge to edge.
  const cell = cols > 1 ? (inner - tile) / (cols - 1) : tile + GAP;
  const rows = Math.ceil(mons.length / cols);
  const rowH = tile + GAP;
  const startRow = Math.max(0, Math.floor(view.top / rowH) - OVERSCAN);
  const endRow = Math.min(rows, Math.ceil((view.top + (view.h || 800)) / rowH) + OVERSCAN);
  const items: ReactNode[] = [];
  for (let r = startRow; r < endRow; r++) {
    for (let c = 0; c < cols; c++) {
      const m = mons[r * cols + c];
      if (!m) break;
      items.push(
        <div key={m.k} className="absolute" style={{ transform: `translate3d(${4 + c * cell}px, ${r * rowH}px, 0)`, width: tile, height: tile }}>
          <Tile
            mon={m}
            art={art}
            shiny={shiny}
            size={tile}
            from={from}
            names={names}
            selected={selected.has(m.k)}
            moving={moving.has(m.k)}
            onPointerDown={onTileDown}
            onClick={onTileClick}
            onDoubleClick={onTileDouble}
          />
          {badge?.(m)}
        </div>
      );
    }
  }
  return (
    <div
      ref={scroller}
      className="tlm-scroll relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden rounded-2xl"
      data-scroll
      {...(zone && { "data-drop": zone })}
      data-testid={testId ? `${testId}-grid` : undefined}
    >
      {mons.length ? (
        <div className="relative" style={{ height: rows * rowH }}>
          {items}
        </div>
      ) : (
        empty
      )}
    </div>
  );
}
