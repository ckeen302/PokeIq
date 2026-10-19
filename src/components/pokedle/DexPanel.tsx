"use client";

/* eslint-disable @next/next/no-img-element -- tiny sprites; next/image adds nothing here */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, BookOpen, Loader2, RotateCcw, Search } from "lucide-react";
import { formatHeight, formatWeight } from "@/lib/pokemon/constants";
import { typeColor, typeTextColor } from "@/lib/pokemon/type-colors";
import type { DleDexRow } from "@/lib/dle-types";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { spriteUrl } from "./parts";
import { cn } from "@/lib/utils";

/**
 * A reference Pokédex beside the Pokédle board, for working the puzzle out
 * by elimination: every guessable Pokémon with exactly the attributes the
 * clues are about, filtered and sorted by hand. It never reads the board:
 * applying the clues is the player's job (an auto-solver would make a duel
 * pointless), and the list is the same for every puzzle, so it can't give
 * an answer away. Clicking a row fills it into the guess box.
 */

const ROW_H = 32;
/** The list's height: only the rows in view (plus a few) are rendered. */
const VIEW_H = 448;
const OVERSCAN = 6;
const ALL_GENS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

let dex: Promise<DleDexRow[]> | null = null;
/** Loaded once per visit (and cached by the browser): the same list for every puzzle. */
function loadDex(): Promise<DleDexRow[]> {
  if (!dex) {
    dex = fetch("/api/pokedle/dex").then((res) => {
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return res.json() as Promise<DleDexRow[]>;
    });
    // A failed load is tried again next time.
    dex.catch(() => (dex = null));
  }
  return dex;
}

type SortKey = "id" | "name" | "gen" | "type1" | "type2" | "height" | "weight" | "color" | "stage";
const FIELD: Record<SortKey, number> = { id: 0, name: 1, gen: 2, type1: 3, type2: 4, height: 5, weight: 6, color: 7, stage: 8 };
/** The board's columns, in the board's order. */
const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Pokémon" },
  { key: "gen", label: "Gen" },
  { key: "type1", label: "Type 1" },
  { key: "type2", label: "Type 2" },
  { key: "height", label: "Height" },
  { key: "weight", label: "Weight" },
  { key: "color", label: "Color" },
  { key: "stage", label: "Stage" },
];
const GRID = "grid grid-cols-[1.25rem_minmax(0,1fr)_1.6rem_3rem_3rem_2.7rem_3.1rem_2.7rem_2.2rem] items-center gap-1";

interface Filters {
  q: string;
  gens: number[];
  /** Has every one of these types (one or two). */
  types: string[];
  /** Only one type. */
  mono: boolean;
  color: string;
  stage: number;
  /** Metres and kilograms, as typed. */
  hMin: string;
  hMax: string;
  wMin: string;
  wMax: string;
}

const NO_FILTERS: Filters = { q: "", gens: [], types: [], mono: false, color: "", stage: 0, hMin: "", hMax: "", wMin: "", wMax: "" };

const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A typed bound, or null when blank or not a number. */
const bound = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));

function matches(row: DleDexRow, f: Filters, q: string): boolean {
  const [, name, gen, t1, t2, height, weight, color, stage] = row;
  if (q && !normalize(name).includes(q)) return false;
  if (f.gens.length && !f.gens.includes(gen)) return false;
  if (f.types.some((t) => t !== t1 && t !== t2)) return false;
  if (f.mono && t2) return false;
  if (f.color && color !== f.color) return false;
  if (f.stage && stage !== f.stage) return false;
  const [hMin, hMax, wMin, wMax] = [bound(f.hMin), bound(f.hMax), bound(f.wMin), bound(f.wMax)];
  if (hMin !== null && height / 10 < hMin) return false;
  if (hMax !== null && height / 10 > hMax) return false;
  if (wMin !== null && weight / 10 < wMin) return false;
  if (wMax !== null && weight / 10 > wMax) return false;
  return true;
}

export function DexPanel({
  gens: limit,
  guessed,
  onPick,
  className,
}: {
  /** A duel's generations: the list holds only these (none: every generation). */
  gens?: number[];
  /** Already guessed this puzzle: dimmed. */
  guessed: ReadonlySet<number>;
  /** Fills a Pokémon into the guess box; absent once you can't guess. */
  onPick?: (name: string) => void;
  className?: string;
}) {
  const [rows, setRows] = useState<DleDexRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "id", dir: 1 });
  const [top, setTop] = useState(0);
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let live = true;
    loadDex()
      .then((data) => live && setRows(data))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, []);

  const limitKey = (limit ?? []).join(",");
  const base = useMemo(() => {
    const gens = limitKey ? limitKey.split(",").map(Number) : null;
    return (rows ?? []).filter((r) => !gens || gens.includes(r[2]));
  }, [rows, limitKey]);
  const genChoices = limitKey ? limitKey.split(",").map(Number) : ALL_GENS;
  const types = useMemo(() => [...new Set(base.flatMap((r) => [r[3], r[4] ?? r[3]]))].sort(), [base]);
  const colors = useMemo(() => [...new Set(base.map((r) => r[7]))].sort(), [base]);

  const list = useMemo(() => {
    const q = normalize(filters.q);
    const i = FIELD[sort.key];
    return base
      .filter((r) => matches(r, filters, q))
      .sort((a, b) => {
        const [x, y] = [a[i] ?? "", b[i] ?? ""];
        const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
        return c * sort.dir || a[0] - b[0];
      });
  }, [base, filters, sort]);

  // New filters or order: back to the top of the list.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
    setTop(0);
  }, [list]);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const toggleGen = (g: number) => set("gens", filters.gens.includes(g) ? filters.gens.filter((x) => x !== g) : [...filters.gens, g].sort((a, b) => a - b));
  const setType = (slot: number, type: string) => {
    const next = [...filters.types];
    if (type) next[slot] = type;
    else next.splice(slot, 1);
    set("types", [...new Set(next.filter(Boolean))]);
  };
  const sortBy = (key: SortKey) => setSort((s) => (s.key === key ? { key, dir: s.dir === 1 ? -1 : 1 } : { key, dir: 1 }));

  const first = Math.max(0, Math.floor(top / ROW_H) - OVERSCAN);
  const last = Math.min(list.length, Math.ceil((top + VIEW_H) / ROW_H) + OVERSCAN);
  const field = "h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <Card className={className}>
      <CardContent className="space-y-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="hud-label flex items-center gap-1.5 text-screen">
            <BookOpen className="h-3.5 w-3.5" aria-hidden /> Pokédex
          </p>
          <span className="text-xs text-muted-foreground" role="status">
            {rows ? `${list.length.toLocaleString("en-US")} Pokémon match` : ""}
          </span>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setFilters(NO_FILTERS)} disabled={filters === NO_FILTERS}>
            <RotateCcw className="h-3 w-3" aria-hidden /> Reset filters
          </Button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" aria-hidden />
          <input
            value={filters.q}
            onChange={(e) => set("q", e.target.value)}
            placeholder="Search by name"
            aria-label="Search the Pokédex"
            className={cn(field, "w-full pl-8")}
          />
        </div>

        <div className="flex flex-wrap gap-1" role="group" aria-label="Generations">
          {genChoices.map((g) => (
            <button
              key={g}
              type="button"
              aria-pressed={filters.gens.includes(g)}
              onClick={() => toggleGen(g)}
              className={cn(
                "rounded-sm border px-1.5 py-1 font-pixel text-[9px] uppercase tracking-wider transition-colors",
                filters.gens.includes(g) ? "border-primary bg-primary text-primary-foreground" : "border-foreground/10 bg-shade/20 text-muted-foreground hover:border-primary/50 hover:text-foreground"
              )}
            >
              Gen {g}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <select value={filters.types[0] ?? ""} onChange={(e) => setType(0, e.target.value)} aria-label="Has type" className={field}>
            <option value="">Has type: any</option>
            {types.map((t) => (
              <option key={t} value={t}>
                Has {cap(t)}
              </option>
            ))}
          </select>
          <select value={filters.types[1] ?? ""} onChange={(e) => setType(1, e.target.value)} aria-label="And type" className={field} disabled={!filters.types[0]}>
            <option value="">And type: any</option>
            {types.map((t) => (
              <option key={t} value={t}>
                And {cap(t)}
              </option>
            ))}
          </select>
          <select value={filters.color} onChange={(e) => set("color", e.target.value)} aria-label="Color" className={field}>
            <option value="">Color: any</option>
            {colors.map((c) => (
              <option key={c} value={c}>
                {cap(c)}
              </option>
            ))}
          </select>
          <select value={filters.stage} onChange={(e) => set("stage", Number(e.target.value))} aria-label="Stage" className={field}>
            <option value={0}>Stage: any</option>
            {[1, 2, 3].map((s) => (
              <option key={s} value={s}>
                Stage {s}
              </option>
            ))}
          </select>
          <label className="col-span-2 flex items-center gap-2 text-muted-foreground">
            <input type="checkbox" checked={filters.mono} onChange={(e) => set("mono", e.target.checked)} className="accent-[hsl(var(--primary))]" />
            No second type
          </label>
          <Range label="Height (m)" min={filters.hMin} max={filters.hMax} onMin={(v) => set("hMin", v)} onMax={(v) => set("hMax", v)} field={field} />
          <Range label="Weight (kg)" min={filters.wMin} max={filters.wMax} onMin={(v) => set("wMin", v)} onMax={(v) => set("wMax", v)} field={field} />
        </div>

        <div className="-mx-3 overflow-x-auto px-3">
          <div className="min-w-[24rem]">
            <div className={cn(GRID, "border-b border-foreground/10 pb-1 font-pixel text-[9px] uppercase tracking-wider text-muted-foreground")}>
              <span />
              {COLUMNS.map((c) => (
                <button key={c.key} type="button" onClick={() => sortBy(c.key)} className={cn("flex items-center gap-0.5 truncate text-left hover:text-foreground", sort.key === c.key && "text-screen")}>
                  {c.label}
                  {sort.key === c.key && (sort.dir === 1 ? <ArrowUp className="h-2.5 w-2.5 shrink-0" aria-hidden /> : <ArrowDown className="h-2.5 w-2.5 shrink-0" aria-hidden />)}
                </button>
              ))}
            </div>
            <div ref={scroller} onScroll={(e) => setTop(e.currentTarget.scrollTop)} style={{ height: VIEW_H }} className="overflow-y-auto" aria-label="Pokédex list">
              {!rows ? (
                <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  {failed ? "Couldn't load the Pokédex." : <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading the Pokédex" />}
                </p>
              ) : list.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No Pokémon match these filters.</p>
              ) : (
                <div style={{ height: list.length * ROW_H }} className="relative">
                  {list.slice(first, last).map((row, k) => {
                    const [id, name, gen, t1, t2, height, weight, color, stage] = row;
                    return (
                      <button
                        key={id}
                        type="button"
                        disabled={!onPick}
                        onClick={() => onPick?.(name)}
                        aria-label={`Fill in ${name}`}
                        title={onPick ? `Fill in ${name}` : name}
                        style={{ top: (first + k) * ROW_H, height: ROW_H }}
                        className={cn(
                          GRID,
                          "absolute inset-x-0 rounded-sm px-0.5 text-left text-[11px] transition-colors",
                          onPick && "hover:bg-screen/10",
                          guessed.has(id) && "opacity-40"
                        )}
                      >
                        <img src={spriteUrl(id)} alt="" width={20} height={20} loading="lazy" className="h-5 w-5" />
                        <span className="truncate font-semibold">{name}</span>
                        <span className="tabular-nums">{gen}</span>
                        <TypeChip type={t1} />
                        {t2 ? <TypeChip type={t2} /> : <span className="text-muted-foreground">None</span>}
                        <span className="tabular-nums">{formatHeight(height)}</span>
                        <span className="tabular-nums">{formatWeight(weight)}</span>
                        <span className="truncate">{cap(color)}</span>
                        <span className="text-center tabular-nums">{stage}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">Filters are yours to set: the Pokédex never reads your clues. Click a Pokémon to fill it in.</p>
      </CardContent>
    </Card>
  );
}

function TypeChip({ type }: { type: string }) {
  return (
    <span className="truncate rounded-sm px-1 text-center text-[10px] font-semibold leading-4" style={{ background: typeColor(type), color: typeTextColor(type) }}>
      {cap(type)}
    </span>
  );
}

function Range({ label, min, max, onMin, onMax, field }: { label: string; min: string; max: string; onMin: (v: string) => void; onMax: (v: string) => void; field: string }) {
  return (
    <div className="space-y-1">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <input type="number" min={0} step="0.1" inputMode="decimal" value={min} onChange={(e) => onMin(e.target.value)} placeholder="min" aria-label={`${label} from`} className={cn(field, "w-full min-w-0")} />
        <span className="text-muted-foreground">–</span>
        <input type="number" min={0} step="0.1" inputMode="decimal" value={max} onChange={(e) => onMax(e.target.value)} placeholder="max" aria-label={`${label} to`} className={cn(field, "w-full min-w-0")} />
      </div>
    </div>
  );
}
