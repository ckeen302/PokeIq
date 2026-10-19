"use client";

/* eslint-disable @next/next/no-img-element -- tiny sprites; next/image adds nothing here */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { BookOpen, Check, Eraser, Loader2, PencilLine, RotateCcw, Search, X } from "lucide-react";
import { GENERATION_REGIONS } from "@/lib/pokemon/constants";
import { typeColor } from "@/lib/pokemon/type-colors";
import type { DleDexRow } from "@/lib/dle-types";
import { ruledOut, type DexClue } from "@/lib/dle-dex";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { spriteUrl } from "./parts";
import { cn } from "@/lib/utils";

/**
 * A Pokédex notebook beside the Pokédle board, for working the puzzle out
 * by elimination, as in Guess Who: every guessable Pokémon as a sprite, by
 * generation. Like Wordle's keyboard it keeps the easy bookkeeping for you,
 * greying out whatever the generation and type clues rule out, and nothing
 * more: it doesn't know any Pokémon's height, weight, colour or stage (the
 * API never sends them), so those clues are the player's to apply, by
 * crossing Pokémon off by hand. Both players in a duel get the same panel.
 * Its parent keys it by puzzle, so a new game starts with nothing crossed
 * off and no filters.
 */

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

const ALL_GENS = [1, 2, 3, 4, 5, 6, 7, 8, 9];

interface Filters {
  q: string;
  gens: number[];
  /** Has every one of these types (one or two). */
  types: string[];
  /** Only one type. */
  mono: boolean;
  /** Hide what the clues rule out, what's crossed off and what's been guessed. */
  hide: boolean;
}
const NO_FILTERS: Filters = { q: "", gens: [], types: [], mono: false, hide: false };

/** What a tap on a Pokémon does. */
type Tool = "cross" | "fill";

const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function DexPanel({
  gens: limit,
  clues,
  guessed,
  onPick,
  className,
}: {
  /** A duel's generations: the list holds only these (none: every generation). */
  gens?: number[];
  /** The board's generation and type clues, which grey out what they rule out. */
  clues: readonly DexClue[];
  /** Already guessed this puzzle. */
  guessed: ReadonlySet<number>;
  /** Fills a Pokémon into the guess box; absent once you can't guess. */
  onPick?: (name: string) => void;
  className?: string;
}) {
  const [rows, setRows] = useState<DleDexRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [crossed, setCrossed] = useState<ReadonlySet<number>>(() => new Set());
  const [tool, setTool] = useState<Tool>("cross");

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

  const out = useMemo(() => ruledOut(base, clues), [base, clues]);
  const left = base.filter((r) => !out.has(r[0]) && !crossed.has(r[0]) && !guessed.has(r[0])).length;

  const groups = useMemo(() => {
    const q = normalize(filters.q);
    const shown = base.filter(([id, name, gen, t1, t2]) => {
      if (q && !normalize(name).includes(q)) return false;
      if (filters.gens.length && !filters.gens.includes(gen)) return false;
      if (filters.types.some((t) => t !== t1 && t !== t2)) return false;
      if (filters.mono && t2) return false;
      if (filters.hide && (out.has(id) || crossed.has(id) || guessed.has(id))) return false;
      return true;
    });
    const byGen = new Map<number, DleDexRow[]>();
    for (const r of shown) byGen.set(r[2], [...(byGen.get(r[2]) ?? []), r]);
    return [...byGen.entries()].sort((a, b) => a[0] - b[0]);
  }, [base, filters, out, crossed, guessed]);

  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));
  const toggleGen = (g: number) => set("gens", filters.gens.includes(g) ? filters.gens.filter((x) => x !== g) : [...filters.gens, g].sort((a, b) => a - b));
  const setType = (slot: number, type: string) => {
    const next = [...filters.types];
    if (type) next[slot] = type;
    else next.splice(slot, 1);
    set("types", [...new Set(next.filter(Boolean))]);
  };
  const toggleCross = (id: number) =>
    setCrossed((c) => {
      const next = new Set(c);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const fill = tool === "fill" && onPick ? onPick : undefined;
  const filtered = filters.q !== "" || filters.gens.length > 0 || filters.types.length > 0 || filters.mono || filters.hide;
  const field = "h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <Card className={className}>
      <CardContent className="space-y-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="hud-label flex items-center gap-1.5 text-screen">
            <BookOpen className="h-3.5 w-3.5" aria-hidden /> Pokédex
          </p>
          <span className="text-xs text-muted-foreground" role="status">
            {rows ? `${left.toLocaleString("en-US")} left in play` : ""}
          </span>
          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setFilters(NO_FILTERS)} disabled={!filtered}>
            <RotateCcw className="h-3 w-3" aria-hidden /> Show all
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-md border border-foreground/15 p-0.5" role="radiogroup" aria-label="Tapping a Pokémon">
            <ToolButton active={tool === "cross"} onClick={() => setTool("cross")} icon={<X className="h-3 w-3" aria-hidden />} label="Cross off" />
            <ToolButton active={tool === "fill"} onClick={() => setTool("fill")} icon={<PencilLine className="h-3 w-3" aria-hidden />} label="Fill in" disabled={!onPick} />
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <input type="checkbox" checked={filters.hide} onChange={(e) => set("hide", e.target.checked)} className="accent-[hsl(var(--primary))]" />
            Hide what&apos;s out
          </label>
          <Button size="sm" variant="ghost" className="ml-auto h-7 px-2" onClick={() => setCrossed(new Set())} disabled={crossed.size === 0}>
            <Eraser className="h-3 w-3" aria-hidden /> Uncross all
          </Button>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" aria-hidden />
          <input value={filters.q} onChange={(e) => set("q", e.target.value)} placeholder="Search by name" aria-label="Search the Pokédex" className={cn(field, "w-full pl-8")} />
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
          <label className="col-span-2 flex items-center gap-2 text-muted-foreground">
            <input type="checkbox" checked={filters.mono} onChange={(e) => set("mono", e.target.checked)} className="accent-[hsl(var(--primary))]" />
            No second type
          </label>
        </div>

        <div className="h-[26rem] overflow-y-auto pr-1 xl:h-[32rem]" aria-label="Pokédex">
          {!rows ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              {failed ? "Couldn't load the Pokédex." : <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading the Pokédex" />}
            </p>
          ) : groups.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No Pokémon here. Try “Show all”.</p>
          ) : (
            groups.map(([gen, list]) => (
              <section key={gen} aria-label={`Generation ${gen}`} className="mb-3">
                <h3 className="sticky top-0 z-10 mb-1 bg-card/95 py-1 font-pixel text-[9px] uppercase tracking-wider text-muted-foreground backdrop-blur">
                  Gen {gen} · {GENERATION_REGIONS[gen]}
                </h3>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-1">
                  {list.map((row) => (
                    <li key={row[0]}>
                      <Tile row={row} out={out.has(row[0])} crossed={crossed.has(row[0])} guessed={guessed.has(row[0])} onTap={fill ? () => fill(row[1]) : () => toggleCross(row[0])} tool={fill ? "fill" : "cross"} />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Greyed out: ruled out by your generation and type clues. Height, weight, color and stage are yours to work out: cross off what they rule out.
        </p>
      </CardContent>
    </Card>
  );
}

function ToolButton({ active, onClick, icon, label, disabled }: { active: boolean; onClick: () => void; icon: ReactNode; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold transition-colors disabled:opacity-40",
        active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {icon} {label}
    </button>
  );
}

function Tile({ row, out, crossed, guessed, tool, onTap }: { row: DleDexRow; out: boolean; crossed: boolean; guessed: boolean; tool: Tool; onTap: () => void }) {
  const [id, name, , t1, t2] = row;
  const state = guessed ? "guessed" : crossed ? "crossed off" : out ? "ruled out by the clues" : null;
  const action = tool === "fill" ? `Fill in ${name}` : crossed ? `Put ${name} back` : `Cross off ${name}`;
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={state ? `${action} (${state})` : action}
      aria-pressed={tool === "cross" ? crossed : undefined}
      title={`${name} · ${cap(t1)}${t2 ? ` / ${cap(t2)}` : ""}${state ? ` · ${state}` : ""}`}
      className={cn(
        "relative flex w-full flex-col items-center rounded-md border border-transparent px-0.5 pb-1 pt-0.5 transition-colors hover:border-screen/40 hover:bg-screen/10",
        out && !guessed && "opacity-30 grayscale",
        crossed && "opacity-45 grayscale",
        guessed && "opacity-50"
      )}
    >
      <img src={spriteUrl(id)} alt="" width={40} height={40} loading="lazy" className="h-10 w-10" />
      <span className="w-full truncate text-center text-[10px] font-semibold leading-tight">{name}</span>
      <span className="mt-0.5 flex h-1 w-8 overflow-hidden rounded-full" aria-hidden>
        <span className="flex-1" style={{ background: typeColor(t1) }} />
        <span className="flex-1" style={{ background: typeColor(t2 ?? t1) }} />
      </span>
      {crossed && <X className="absolute left-1/2 top-1 h-9 w-9 -translate-x-1/2 text-destructive" strokeWidth={2.5} aria-hidden />}
      {guessed && <Check className="absolute right-0.5 top-0.5 h-3 w-3 text-screen" aria-hidden />}
    </button>
  );
}
