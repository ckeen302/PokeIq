"use client";

/* eslint-disable @next/next/no-img-element -- tiny sprites; next/image adds nothing here */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BookOpen, Check, Eraser, EyeOff, Loader2, PencilLine, RotateCcw, Search, X } from "lucide-react";
import { GENERATION_REGIONS, formatHeight, formatWeight } from "@/lib/pokemon/constants";
import { typeColor } from "@/lib/pokemon/type-colors";
import type { CellStatus, DleColumn, DleDexRow } from "@/lib/dle-types";
import { clueStatus, stageLabel } from "@/lib/dle-compare";
import { strictStatus } from "@/lib/dle-format";
import type { DleAssist } from "@/lib/dle-assist";
import { dexFullTraits, ruledOut, type DexClue } from "@/lib/dle-dex";
import { localMeasure, localStage } from "@/lib/dle-i18n";
import { formatNumber } from "@/i18n/catalog";
import { Card, CardContent } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/tooltip";
import { clueText, spriteUrl } from "./parts";
import { normalizeName } from "./search";
import { useDleWords, type DleWords } from "./lexicon";
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

/**
 * Does a row pass the view filters (not the greying, crossing off or hiding)? `match` is the name search, in the
 * page's language (null: nothing typed).
 */
function passes(row: DleDexRow, f: Filters, match: ((row: DleDexRow) => boolean) | null, byId: Map<number, DleDexRow>, close: boolean): boolean {
  const [, , gen, t1, t2, stage, color, height, weight] = row;
  if (match && !match(row)) return false;
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
  const words = useDleWords();
  const { t } = words;
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
    // English: the name as sent. Another language: its name, the English one, or another it answers to (rōmaji).
    const q = words.labels ? normalizeName(filters.q) : normalize(filters.q);
    const match = !q
      ? null
      : words.labels
        ? (row: DleDexRow) => [words.name(row[0], row[1]), row[1], ...words.aliases(row[0])].some((n) => normalizeName(n).includes(q))
        : (row: DleDexRow) => normalize(row[1]).includes(q);
    const shown = base.filter((row) => {
      if (!passes(row, filters, match, byId, close)) return false;
      const id = row[0];
      if (filters.hide && (out.has(id) || crossed.has(id) || guessed.has(id))) return false;
      return true;
    });
    const byGen = new Map<number, DleDexRow[]>();
    for (const r of shown) byGen.set(r[2], [...(byGen.get(r[2]) ?? []), r]);
    return [...byGen.entries()].sort((a, b) => a[0] - b[0]);
  }, [base, filters, out, crossed, guessed, byId, close, words]);

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
  const input = "h-8 max-sm:h-10 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  const iconAction = (on = false) =>
    cn(
      "rounded p-1.5 transition-colors max-sm:p-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-35",
      on ? "bg-screen/15 text-foreground" : "text-muted-foreground hover:text-foreground"
    );

  return (
    <Card className={className} data-assist={assist}>
      <CardContent className="space-y-3 p-4">
        {/* One header row: the title, then how a tap works and the secondary actions, grouped. */}
        <div className="flex items-center justify-between gap-2 max-sm:flex-wrap">
          <p className="hud-label flex items-center gap-1.5 text-screen max-sm:whitespace-nowrap">
            <BookOpen className="h-3.5 w-3.5" aria-hidden /> {t("dex.title")}
            <span className="font-sans normal-case tracking-normal text-muted-foreground">· {t(`assist.${assist}.label`)}</span>
          </p>
          <div className="flex items-center gap-1.5">
            <div className="flex rounded-md border border-foreground/15 p-0.5" role="radiogroup" aria-label={t("dex.tapping")}>
              <ToolButton active={tool === "cross"} onClick={() => setTool("cross")} icon={<X className="h-3 w-3" aria-hidden />} label={t("dex.cross")} />
              <ToolButton active={tool === "fill"} onClick={() => setTool("fill")} icon={<PencilLine className="h-3 w-3" aria-hidden />} label={t("dex.fill")} disabled={!onPick} />
            </div>
            <div className="flex rounded-md border border-foreground/15 p-0.5" role="group" aria-label={t("dex.view")}>
              <button type="button" className={iconAction(filters.hide)} aria-pressed={filters.hide} onClick={() => set("hide", !filters.hide)} aria-label={t("dex.hide")} title={t("dex.hide")}>
                <EyeOff className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button type="button" className={iconAction()} onClick={() => setCrossed(new Set())} disabled={crossed.size === 0} aria-label={t("dex.uncross")} title={t("dex.uncross")}>
                <Eraser className="h-3.5 w-3.5" aria-hidden />
              </button>
              <button type="button" className={iconAction()} onClick={() => setFilters(NO_FILTERS)} disabled={!filtered} aria-label={t("dex.showAllAria")} title={t("dex.showAllTitle")}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
          </div>
        </div>

        <div className="flex gap-2 max-sm:flex-wrap">
          <div className="relative min-w-0 flex-1 max-sm:basis-full">
            <Search className="pointer-events-none absolute left-2 top-2 h-4 w-4 text-muted-foreground" aria-hidden />
            <input value={filters.q} onChange={(e) => set("q", e.target.value)} placeholder={t("dex.search")} aria-label={t("dex.searchAria")} className={cn(input, "w-full pl-8")} />
          </div>
          <select value={filters.types[0] ?? ""} onChange={(e) => setType(0, e.target.value)} aria-label={t("dex.hasType")} className={cn(input, "w-28 max-sm:min-w-0 max-sm:flex-1")}>
            <option value="">{t("dex.anyType")}</option>
            {types.map((type) => (
              <option key={type} value={type}>
                {t("dex.has", { type: words.type(cap(type)) })}
              </option>
            ))}
          </select>
          <select value={filters.types[1] ?? ""} onChange={(e) => setType(1, e.target.value)} aria-label={t("dex.andType")} className={cn(input, "w-28 max-sm:min-w-0 max-sm:flex-1")} disabled={!filters.types[0]}>
            <option value="">{t("dex.andAny")}</option>
            {types.map((type) => (
              <option key={type} value={type}>
                {t("dex.and", { type: words.type(cap(type)) })}
              </option>
            ))}
          </select>
        </div>

        {field && (
          <div className="grid grid-cols-2 gap-2 text-xs">
            <select value={filters.stage} onChange={(e) => set("stage", e.target.value)} aria-label={t("dex.stage")} className={input}>
              <option value="">{t("dex.stageAny")}</option>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {t("dex.stageN", { stage: localStage(s, t) })}
                </option>
              ))}
            </select>
            <select value={filters.color} onChange={(e) => set("color", e.target.value)} aria-label={t("dex.color")} className={input}>
              <option value="">{t("dex.colorAny")}</option>
              {colors.map((c) => (
                <option key={c} value={c}>
                  {words.color(cap(c))}
                </option>
              ))}
            </select>
            {full && (
              <>
                <Range label={t("dex.height")} min={filters.hMin} max={filters.hMax} onMin={(v) => set("hMin", v)} onMax={(v) => set("hMax", v)} className={input} words={words} />
                <Range label={t("dex.weight")} min={filters.wMin} max={filters.wMax} onMin={(v) => set("wMin", v)} onMax={(v) => set("wMax", v)} className={input} words={words} />
              </>
            )}
          </div>
        )}

        <div className="flex items-center gap-1">
          <span className="hud-label mr-1">{t("dex.gen")}</span>
          <div className="flex flex-wrap gap-1" role="group" aria-label={t("dex.generations")}>
            {genChoices.map((g) => (
              <button
                key={g}
                type="button"
                aria-pressed={filters.gens.includes(g)}
                aria-label={t("dex.genN", { n: g })}
                title={t("dex.genRegion", { n: g, region: words.region(GENERATION_REGIONS[g]) })}
                onClick={() => toggleGen(g)}
                className={cn(
                  "h-6 w-6 rounded-sm border font-pixel text-[9px] transition-colors",
                  filters.gens.includes(g) ? "border-primary bg-primary text-primary-foreground" : "border-foreground/10 bg-shade/20 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                )}
              >
                {g}
              </button>
            ))}
          </div>
          <label className="ml-auto flex items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground">
            <input type="checkbox" checked={filters.mono} onChange={(e) => set("mono", e.target.checked)} className="accent-[hsl(var(--primary))]" />
            {t("dex.mono")}
          </label>
        </div>
        {full && filters.picks.length > 0 && (
          <ul className="flex flex-wrap gap-1" aria-label={t("dex.clueFilters")}>
            {filters.picks.map((p) => {
              const text = clueText(t, t(`column.${p.column}`), { value: words.cell(p.column, p.value), status: p.status });
              return (
                <li key={`${p.column}:${p.guessId}`}>
                  <button
                    type="button"
                    onClick={() => set("picks", filters.picks.filter((x) => x !== p))}
                    className="flex items-center gap-1 rounded-full border border-screen/40 bg-screen/10 px-2 py-0.5 text-[11px]"
                    aria-label={t("dex.removeFilter", { clue: text })}
                  >
                    {text} <X className="h-3 w-3" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="h-[26rem] overflow-y-auto pr-1 xl:h-[32rem]" aria-label={t("dex.list")}>
          {!rows ? (
            <p className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              {failed ? t("dex.failed") : <Loader2 className="h-4 w-4 animate-spin" aria-label={t("dex.loading")} />}
            </p>
          ) : groups.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">{t("dex.empty")}</p>
          ) : (
            groups.map(([gen, list]) => (
              <section key={gen} aria-label={t("dex.generation", { n: gen })} className="mb-3">
                <h3 className="sticky top-0 z-10 mb-1 bg-card/95 py-1 font-pixel text-[9px] uppercase tracking-wider text-muted-foreground backdrop-blur">
                  {t("dex.genRegion", { n: gen, region: words.region(GENERATION_REGIONS[gen]) })}
                </h3>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-1">
                  {list.map((row) => (
                    <li key={row[0]}>
                      <Tile
                        row={row}
                        words={words}
                        out={out.has(row[0])}
                        crossed={crossed.has(row[0])}
                        guessed={guessed.has(row[0])}
                        onTap={fill ? () => fill(words.name(row[0], row[1])) : () => toggleCross(row[0])}
                        tool={fill ? "fill" : "cross"}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
        <div className="flex items-center justify-between gap-2 border-t pt-2 text-xs text-muted-foreground">
          <span role="status">{rows ? t("dex.left", { n: formatNumber(left, t.locale) }) : ""}</span>
          <InfoTip label={t("dex.how")} className="left-auto right-0 translate-x-0">
            {assist === "notebook" ? t("dex.howNotebook") : assist === "field" ? t("dex.howField") : t("dex.howFull")}
          </InfoTip>
        </div>
      </CardContent>
    </Card>
  );
}

function Range({
  label,
  min,
  max,
  onMin,
  onMax,
  className,
  words: { t },
}: {
  label: string;
  min: string;
  max: string;
  onMin: (v: string) => void;
  onMax: (v: string) => void;
  className: string;
  words: DleWords;
}) {
  return (
    <fieldset className="col-span-2 flex items-center gap-1.5 sm:col-span-1">
      <legend className="sr-only">{label}</legend>
      <span className="shrink-0 whitespace-nowrap text-muted-foreground">{label}</span>
      <input inputMode="decimal" value={min} onChange={(e) => onMin(e.target.value)} placeholder={t("dex.min")} aria-label={t("dex.atLeast", { label })} className={cn(className, "w-full min-w-0")} />
      <span aria-hidden>–</span>
      <input inputMode="decimal" value={max} onChange={(e) => onMax(e.target.value)} placeholder={t("dex.max")} aria-label={t("dex.atMost", { label })} className={cn(className, "w-full min-w-0")} />
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
        "flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold transition-colors disabled:opacity-40 max-sm:min-h-10 max-sm:whitespace-nowrap",
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

function Tile({ row, words, out, crossed, guessed, tool, onTap }: { row: DleDexRow; words: DleWords; out: boolean; crossed: boolean; guessed: boolean; tool: Tool; onTap: () => void }) {
  const [id, english, , t1, t2, stage, color, height, weight] = row;
  const { t } = words;
  const name = words.name(id, english);
  const state = guessed ? t("dex.guessed") : crossed ? t("dex.crossed") : out ? t("dex.out") : null;
  const action = tool === "fill" ? t("dex.fillName", { name }) : crossed ? t("dex.back", { name }) : t("dex.crossName", { name });
  const facts = [
    `${words.type(cap(t1))}${t2 ? ` / ${words.type(cap(t2))}` : ""}`,
    stage !== undefined && t("dex.stageN", { stage: words.labels ? localStage(stage, t) : stageLabel(stage) }),
    color && words.color(cap(color)),
    height !== undefined && (words.labels ? localMeasure(height, "m", t) : formatHeight(height)),
    weight !== undefined && (words.labels ? localMeasure(weight, "kg", t) : formatWeight(weight)),
  ].filter(Boolean);
  return (
    <button
      type="button"
      onClick={onTap}
      aria-label={state ? t("dex.withState", { action, state }) : action}
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
          {stage === 0 ? t("value.babyShort") : stage}
        </span>
      )}
      {crossed && <X className="absolute left-1/2 top-1 h-9 w-9 -translate-x-1/2 text-destructive" strokeWidth={2.5} aria-hidden />}
      {guessed && <Check className="absolute right-0.5 top-0.5 h-3 w-3 text-screen" aria-hidden />}
    </button>
  );
}
