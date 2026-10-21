"use client";

/* eslint-disable @next/next/no-img-element -- tiny sprites; next/image adds nothing here */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, Check, Eraser, Loader2, PencilLine, RotateCcw, Search, X } from "lucide-react";
import { GENERATION_REGIONS, formatHeight, formatWeight } from "@/lib/pokemon/constants";
import { typeColor } from "@/lib/pokemon/type-colors";
import { DLE_COLUMNS, type CellStatus, type DleColumn, type DleDexRow } from "@/lib/dle-types";
import { clueStatus, stageLabel } from "@/lib/dle-compare";
import { strictStatus } from "@/lib/dle-format";
import { DLE_ASSIST_INFO, type DleAssist } from "@/lib/dle-assist";
import { dexFullTraits, ruledOut, type DexClue } from "@/lib/dle-dex";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { STATUS_TEXT, spriteUrl } from "./parts";
import { cn } from "@/lib/utils";

/**
 * A Pokédex notebook beside the Pokédle board, for working the puzzle out
 * by elimination, as in Guess Who: every guessable Pokémon as a sprite, by
 * generation. Like Wordle's keyboard it keeps the easy bookkeeping for you,
 * greying out whatever the generation and type clues rule out. How much
 * more it does is the game's assist level (dle-assist.ts):
 * - Notebook: nothing more. It doesn't know any Pokémon's height, weight,
 *   colour or stage (the API never sends them), so those clues are the
 *   player's to apply, by crossing Pokémon off by hand.
 * - Field Guide: each tile shows the stage and colour, with filters for them.
 * - Full Pokédex: height and weight too, with range filters, and a clue
 *   clicked on the board becomes an exact filter.
 * Both players in a duel get the same panel. Its parent keys it by puzzle,
 * so a new game starts with nothing crossed off and no filters.
 */

type PanelAssist = Exclude<DleAssist, "off">;

const dex = new Map<PanelAssist, Promise<DleDexRow[]>>();
/** Loaded once per visit and level (and cached by the browser): the same list for every puzzle. */
function loadDex(assist: PanelAssist): Promise<DleDexRow[]> {
  let p = dex.get(assist);
  if (!p) {
    p = fetch(`/api/pokedle/dex?assist=${assist}`).then((res) => {
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return res.json() as Promise<DleDexRow[]>;
    });
    dex.set(assist, p);
    // A failed load is tried again next time.
    p.catch(() => dex.delete(assist));
  }
  return p;
}

const ALL_GENS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const STAGES = [0, 1, 2, 3];

/** One board clue, picked at the Full Pokédex level: the guess's `column` got `status` (`value` is how the board shows it). */
export interface DexPick {
  column: DleColumn;
  guessId: number;
  status: CellStatus;
  value: string;
}

interface Filters {
  q: string;
  gens: number[];
  /** Has every one of these types (one or two). */
  types: string[];
  /** Only one type. */
  mono: boolean;
  /** Hide what the clues rule out, what's crossed off and what's been guessed. */
  hide: boolean;
  /** Field Guide up: "" for any. */
  color: string;
  /** Field Guide up: "" for any, else a stage (0 is Baby). */
  stage: string;
  /** Full Pokédex: metres and kilograms, as typed. */
  hMin: string;
  hMax: string;
  wMin: string;
  wMax: string;
  /** Full Pokédex: clues picked on the board. */
  picks: DexPick[];
}
const NO_FILTERS: Filters = { q: "", gens: [], types: [], mono: false, hide: false, color: "", stage: "", hMin: "", hMax: "", wMin: "", wMax: "", picks: [] };

/** What a tap on a Pokémon does. */
type Tool = "cross" | "fill";

const normalize = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** A typed bound, or null when blank or not a number. */
const bound = (s: string) => (s.trim() === "" || Number.isNaN(Number(s)) ? null : Number(s));

/** Does a row pass the view filters (not the greying, crossing off or hiding)? */
function passes(row: DleDexRow, f: Filters, q: string, byId: Map<number, DleDexRow>, close: boolean): boolean {
  const [, name, gen, t1, t2, stage, color, height, weight] = row;
  if (q && !normalize(name).includes(q)) return false;
  if (f.gens.length && !f.gens.includes(gen)) return false;
  if (f.types.some((t) => t !== t1 && t !== t2)) return false;
  if (f.mono && t2) return false;
  if (f.color && color !== undefined && color !== f.color) return false;
  if (f.stage !== "" && stage !== undefined && stage !== Number(f.stage)) return false;
  if (height !== undefined && weight !== undefined) {
    const [hMin, hMax, wMin, wMax] = [bound(f.hMin), bound(f.hMax), bound(f.wMin), bound(f.wMax)];
    if (hMin !== null && height / 10 < hMin) return false;
    if (hMax !== null && height / 10 > hMax) return false;
    if (wMin !== null && weight / 10 < wMin) return false;
    if (wMax !== null && weight / 10 > wMax) return false;
  }
  const traits = f.picks.length ? dexFullTraits(row) : null;
  if (traits) {
    for (const p of f.picks) {
      const guess = byId.get(p.guessId);
      const g = guess && dexFullTraits(guess);
      if (g && strictStatus(clueStatus(p.column, g, traits), close) !== p.status) return false;
    }
  }
  return true;
}

export function DexPanel({
  assist,
  gens: limit,
  close = true,
  clues,
  guessed,
  onPick,
  pick,
  className,
}: {
  /** The game's assist level: what the Pokédex knows and filters by. */
  assist: PanelAssist;
  /** The game's generations: the list holds only these (none: every generation). */
  gens?: number[];
  /** False: the game shows no close states, so its clues read without them. */
  close?: boolean;
  /** The board's generation and type clues, which grey out what they rule out. */
  clues: readonly DexClue[];
  /** Already guessed this puzzle. */
  guessed: ReadonlySet<number>;
  /** Fills a Pokémon into the guess box; absent once you can't guess. */
  onPick?: (name: string) => void;
  /** Full Pokédex: a clue clicked on the board, to add as a filter; `n` changes with every click. */
  pick?: (DexPick & { n: number }) | null;
  className?: string;
}) {
  const [rows, setRows] = useState<DleDexRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [crossed, setCrossed] = useState<ReadonlySet<number>>(() => new Set());
  const [tool, setTool] = useState<Tool>("cross");
  const field = assist !== "notebook";
  const full = assist === "full";
  // A click from before this panel appeared (an earlier puzzle) stays out of it.
  const seenPick = useRef(pick?.n);

  useEffect(() => {
    if (!full || !pick || pick.n === seenPick.current) return;
    seenPick.current = pick.n;
    const { column, guessId, status, value } = pick;
    setFilters((f) =>
      f.picks.some((c) => c.column === column && c.guessId === guessId) ? f : { ...f, picks: [...f.picks, { column, guessId, status, value }] }
    );
  }, [pick, full]);

  useEffect(() => {
    let live = true;
    loadDex(assist)
      .then((data) => live && setRows(data))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [assist]);

  const limitKey = (limit ?? []).join(",");
  const base = useMemo(() => {
    const gens = limitKey ? limitKey.split(",").map(Number) : null;
    return (rows ?? []).filter((r) => !gens || gens.includes(r[2]));
  }, [rows, limitKey]);
  const genChoices = limitKey ? limitKey.split(",").map(Number) : ALL_GENS;
  const types = useMemo(() => [...new Set(base.flatMap((r) => [r[3], r[4] ?? r[3]]))].sort(), [base]);
  const colors = useMemo(() => [...new Set(base.flatMap((r) => (r[6] ? [r[6]] : [])))].sort(), [base]);
  const byId = useMemo(() => new Map((rows ?? []).map((r) => [r[0], r])), [rows]);

  const out = useMemo(() => ruledOut(base, clues, close), [base, clues, close]);
  const left = base.filter((r) => !out.has(r[0]) && !crossed.has(r[0]) && !guessed.has(r[0])).length;

  const groups = useMemo(() => {
    const q = normalize(filters.q);
    const shown = base.filter((row) => {
      if (!passes(row, filters, q, byId, close)) return false;
      const id = row[0];
      if (filters.hide && (out.has(id) || crossed.has(id) || guessed.has(id))) return false;
      return true;
    });
    const byGen = new Map<number, DleDexRow[]>();
    for (const r of shown) byGen.set(r[2], [...(byGen.get(r[2]) ?? []), r]);
    return [...byGen.entries()].sort((a, b) => a[0] - b[0]);
  }, [base, filters, out, crossed, guessed, byId, close]);

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
  const filtered = JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
  const input = "h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <Card className={className} data-assist={assist}>
      <CardContent className="space-y-3 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="hud-label flex items-center gap-1.5 text-screen">
            <BookOpen className="h-3.5 w-3.5" aria-hidden /> Pokédex
            <span className="font-sans normal-case tracking-normal text-muted-foreground">· {DLE_ASSIST_INFO[assist].label}</span>
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
          <input value={filters.q} onChange={(e) => set("q", e.target.value)} placeholder="Search by name" aria-label="Search the Pokédex" className={cn(input, "w-full pl-8")} />
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
          <select value={filters.types[0] ?? ""} onChange={(e) => setType(0, e.target.value)} aria-label="Has type" className={input}>
            <option value="">Has type: any</option>
            {types.map((t) => (
              <option key={t} value={t}>
                Has {cap(t)}
              </option>
            ))}
          </select>
          <select value={filters.types[1] ?? ""} onChange={(e) => setType(1, e.target.value)} aria-label="And type" className={input} disabled={!filters.types[0]}>
            <option value="">And type: any</option>
            {types.map((t) => (
              <option key={t} value={t}>
                And {cap(t)}
              </option>
            ))}
          </select>
          {field && (
            <>
              <select value={filters.stage} onChange={(e) => set("stage", e.target.value)} aria-label="Stage" className={input}>
                <option value="">Stage: any</option>
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    Stage {stageLabel(s)}
                  </option>
                ))}
              </select>
              <select value={filters.color} onChange={(e) => set("color", e.target.value)} aria-label="Color" className={input}>
                <option value="">Color: any</option>
                {colors.map((c) => (
                  <option key={c} value={c}>
                    {cap(c)}
                  </option>
                ))}
              </select>
            </>
          )}
          {full && (
            <>
              <Range label="Height (m)" min={filters.hMin} max={filters.hMax} onMin={(v) => set("hMin", v)} onMax={(v) => set("hMax", v)} className={input} />
              <Range label="Weight (kg)" min={filters.wMin} max={filters.wMax} onMin={(v) => set("wMin", v)} onMax={(v) => set("wMax", v)} className={input} />
            </>
          )}
          <label className="col-span-2 flex items-center gap-2 text-muted-foreground">
            <input type="checkbox" checked={filters.mono} onChange={(e) => set("mono", e.target.checked)} className="accent-[hsl(var(--primary))]" />
            No second type
          </label>
        </div>

        {full && filters.picks.length > 0 && (
          <ul className="flex flex-wrap gap-1" aria-label="Clue filters">
            {filters.picks.map((p) => {
              const label = DLE_COLUMNS.find((c) => c.key === p.column)!.label;
              const text = `${label} ${p.value}: ${STATUS_TEXT[p.status]}`;
              return (
                <li key={`${p.column}:${p.guessId}`}>
                  <button
                    type="button"
                    onClick={() => set("picks", filters.picks.filter((x) => x !== p))}
                    className="flex items-center gap-1 rounded-full border border-screen/40 bg-screen/10 px-2 py-0.5 text-[11px]"
                    aria-label={`Remove the filter ${text}`}
                  >
                    {text} <X className="h-3 w-3" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

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
          {assist === "notebook"
            ? "Greyed out: ruled out by your generation and type clues. Height, weight, color and stage are yours to work out: cross off what they rule out."
            : assist === "field"
              ? "Greyed out: ruled out by your generation and type clues. Filter by stage and color; height and weight are yours to work out."
              : "Greyed out: ruled out by your generation and type clues. Filter by any attribute, or click a clue on the board to add it as a filter."}
        </p>
      </CardContent>
    </Card>
  );
}

function Range({ label, min, max, onMin, onMax, className }: { label: string; min: string; max: string; onMin: (v: string) => void; onMax: (v: string) => void; className: string }) {
  return (
    <fieldset className="col-span-2 flex items-center gap-1.5 sm:col-span-1">
      <legend className="sr-only">{label}</legend>
      <span className="shrink-0 whitespace-nowrap text-muted-foreground">{label}</span>
      <input inputMode="decimal" value={min} onChange={(e) => onMin(e.target.value)} placeholder="min" aria-label={`${label}, at least`} className={cn(className, "w-full min-w-0")} />
      <span aria-hidden>–</span>
      <input inputMode="decimal" value={max} onChange={(e) => onMax(e.target.value)} placeholder="max" aria-label={`${label}, at most`} className={cn(className, "w-full min-w-0")} />
    </fieldset>
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

/** A Pokédex colour as a swatch. */
const SWATCH: Record<string, string> = {
  black: "#222",
  blue: "#3b82f6",
  brown: "#92603a",
  gray: "#9ca3af",
  green: "#22c55e",
  pink: "#f472b6",
  purple: "#a855f7",
  red: "#ef4444",
  white: "#f5f5f5",
  yellow: "#facc15",
};

function Tile({ row, out, crossed, guessed, tool, onTap }: { row: DleDexRow; out: boolean; crossed: boolean; guessed: boolean; tool: Tool; onTap: () => void }) {
  const [id, name, , t1, t2, stage, color, height, weight] = row;
  const state = guessed ? "guessed" : crossed ? "crossed off" : out ? "ruled out by the clues" : null;
  const action = tool === "fill" ? `Fill in ${name}` : crossed ? `Put ${name} back` : `Cross off ${name}`;
  const facts = [
    `${cap(t1)}${t2 ? ` / ${cap(t2)}` : ""}`,
    stage !== undefined && `Stage ${stageLabel(stage)}`,
    color && cap(color),
    height !== undefined && formatHeight(height),
    weight !== undefined && formatWeight(weight),
  ].filter(Boolean);
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={state ? `${action} (${state})` : action}
      aria-pressed={tool === "cross" ? crossed : undefined}
      title={`${name} · ${facts.join(" · ")}${state ? ` · ${state}` : ""}`}
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
      {stage !== undefined && (
        <span className="absolute left-0.5 top-0.5 flex items-center gap-0.5 font-pixel text-[7px] uppercase text-muted-foreground" aria-hidden>
          {color && <span className="h-2 w-2 rounded-full border border-foreground/30" style={{ background: SWATCH[color] ?? color }} />}
          {stage === 0 ? "B" : stage}
        </span>
      )}
      {crossed && <X className="absolute left-1/2 top-1 h-9 w-9 -translate-x-1/2 text-destructive" strokeWidth={2.5} aria-hidden />}
      {guessed && <Check className="absolute right-0.5 top-0.5 h-3 w-3 text-screen" aria-hidden />}
    </button>
  );
}
