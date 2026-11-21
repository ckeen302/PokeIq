"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowDownUp, Check, ChevronDown, Search, SlidersHorizontal, X } from "lucide-react";
import { TYPES } from "@/lib/pokemon/type-matrix";
import { typeColor } from "@/lib/pokemon/type-colors";
import { ROLES } from "@/lib/lab-dex/roles";
import { DEFAULT_VIEW, STAT_SORTS, searchSequence, type LabView, type SortKey } from "@/lib/lab-dex/sequence";
import type { LabMon } from "@/lib/lab-dex/types";
import { cn } from "@/lib/utils";
import { GEN_NUMERALS, S, SORT_TEXT } from "./strings";
import { dexNo } from "./panels";

/**
 * The lab's controls along the top: filters like the Pokédex page (types,
 * generations, Legendary + Mythical, Fully evolved) plus Forms, the sort,
 * and search, which jumps the wheel to a Pokémon by name or number.
 */

const chip = "rounded-lg border border-white/10 bg-[#050a17]/70 backdrop-blur-md";
const SORTS: SortKey[] = ["id", "name", "bst", ...STAT_SORTS, ...ROLES.map((r) => r.key)];

function useOutside(ref: React.RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    document.addEventListener("pointerdown", down);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("pointerdown", down); document.removeEventListener("keydown", key, true); };
  }, [ref, open, close]);
}

function TypeDot({ t }: { t: string }) {
  return <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: typeColor(t), boxShadow: `0 0 8px ${typeColor(t)}` }} />;
}

export function TypePicker({ types, onChange, inline = false }: { types: string[]; onChange: (t: string[]) => void; inline?: boolean }) {
  const toggle = (t: string) => onChange(types.includes(t) ? types.filter((x) => x !== t) : [...types, t].slice(-2));
  return (
    <div className={cn("grid gap-1", inline ? "grid-cols-3" : "grid-cols-3 p-2")} role="group" aria-label={S.types}>
      {TYPES.map((t) => {
        const on = types.includes(t);
        return (
          <button
            key={t}
            type="button"
            aria-pressed={on}
            onClick={() => toggle(t)}
            data-testid={`lab-type-${t}`}
            className={cn("flex items-center gap-1.5 rounded-md px-2 py-1.5 font-display text-[11px] font-semibold uppercase tracking-wider transition-colors", on ? "bg-white/[0.14] text-white" : "text-white/60 hover:bg-white/[0.06] hover:text-white")}
          >
            <TypeDot t={t} />
            {t}
            {on && <Check className="ml-auto h-3 w-3" aria-hidden />}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ on, onClick, children, testId }: { on: boolean; onClick: () => void; children: React.ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      data-testid={testId}
      className={cn("flex w-full items-center justify-between gap-3 rounded-md px-2.5 py-2 text-left font-display text-[12px] font-semibold uppercase tracking-wider transition-colors", on ? "bg-cyan-300/15 text-white" : "text-white/65 hover:bg-white/[0.06] hover:text-white")}
    >
      {children}
      <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded-sm border", on ? "border-cyan-300 bg-cyan-300 text-[#04121c]" : "border-white/30")}>{on && <Check className="h-3 w-3" aria-hidden />}</span>
    </button>
  );
}

export function GenPicker({ gens, onChange, compact = false }: { gens: number[]; onChange: (g: number[]) => void; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-0.5", compact && "flex-wrap")} role="group" aria-label={S.gen}>
      {GEN_NUMERALS.map((g, i) => {
        const on = gens.includes(i + 1);
        return (
          <button
            key={g}
            type="button"
            aria-pressed={on}
            aria-label={`Gen ${g}`}
            onClick={() => onChange(on ? gens.filter((x) => x !== i + 1) : [...gens, i + 1].sort((a, b) => a - b))}
            data-testid={`lab-gen-${i + 1}`}
            className={cn("min-w-[28px] rounded-md px-1.5 py-1 font-display text-[11px] font-bold tracking-wider transition-colors", on ? "bg-cyan-300/90 text-[#04121c]" : "text-white/60 hover:text-white")}
          >
            {g}
          </button>
        );
      })}
    </div>
  );
}

export function TogglesList({ view, set }: { view: LabView; set: (v: Partial<LabView>) => void }) {
  return (
    <div className="space-y-0.5">
      <Toggle on={view.legends} onClick={() => set({ legends: !view.legends })} testId="lab-legends">{S.legends}</Toggle>
      <Toggle on={view.final} onClick={() => set({ final: !view.final })} testId="lab-final">{S.final}</Toggle>
      <Toggle on={view.forms} onClick={() => set({ forms: !view.forms })} testId="lab-forms">
        <span>
          {S.forms}
          <span className="block font-sans text-[10.5px] font-normal normal-case tracking-normal text-white/45">{S.formsHint}</span>
        </span>
      </Toggle>
    </div>
  );
}

export function SortPicker({ view, set, wide = false }: { view: LabView; set: (v: Partial<LabView>) => void; wide?: boolean }) {
  const id = useId();
  return (
    <div className={cn("flex items-center gap-1", wide && "w-full")}>
      <label htmlFor={id} className="sr-only">{S.sortBy}</label>
      <div className={cn("relative", wide && "flex-1")}>
        <select
          id={id}
          value={view.sort}
          onChange={(e) => set({ sort: e.target.value as SortKey, reverse: false })}
          data-testid="lab-sort"
          className="h-9 w-full appearance-none rounded-md border border-white/10 bg-[#050a17] pl-2.5 pr-7 font-display text-[12px] font-semibold uppercase tracking-wider text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        >
          {SORTS.map((k) => (
            <option key={k} value={k}>{SORT_TEXT[k]}</option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-white/50" aria-hidden />
      </div>
      <button
        type="button"
        onClick={() => set({ reverse: !view.reverse })}
        aria-label={view.reverse ? S.sortDesc : S.sortAsc}
        aria-pressed={view.reverse}
        data-testid="lab-sort-dir"
        className={cn("grid h-9 w-9 place-items-center rounded-md border border-white/10 transition-colors", view.reverse ? "bg-white/[0.14] text-white" : "text-white/60 hover:text-white")}
      >
        <ArrowDownUp className="h-4 w-4" aria-hidden />
      </button>
    </div>
  );
}

export function activeCount(v: LabView) {
  return v.types.length + v.gens.length + Number(v.legends) + Number(v.final) + Number(v.forms);
}

/** Search: suggestions as you type (best first), Enter takes the first; a Pokémon outside the filters offers to show it anyway. */
export function SearchBox({ all, seq, onJump, onShowAnyway, className, inputRef }: {
  all: LabMon[];
  seq: number[];
  onJump: (pos: number) => void;
  onShowAnyway: (id: number) => void;
  className?: string;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();
  useOutside(box, open, () => setOpen(false));
  const hits = useMemo(() => searchSequence(all, seq, q, 6), [all, seq, q]);
  const everyone = useMemo(() => (q.trim() && hits.length === 0 ? searchSequence(all, all.map((_, i) => i), q, 3) : []), [all, hits.length, q]);
  useEffect(() => setHi(0), [q]);
  const go = (pos: number) => {
    onJump(pos);
    setOpen(false);
    setQ("");
    inputRef?.current?.blur();
  };
  return (
    <div ref={box} className={cn("relative", className)}>
      <div className={cn(chip, "flex h-9 items-center gap-2 px-3 focus-within:border-cyan-300/60")}>
        <Search className="h-4 w-4 shrink-0 text-white/50" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, Math.max(0, hits.length - 1))); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
            else if (e.key === "Enter" && hits.length) { e.preventDefault(); go(hits[hi] ?? hits[0]); }
            else if (e.key === "Enter" && everyone.length) { e.preventDefault(); onShowAnyway(all[everyone[0]].id); setOpen(false); setQ(""); }
            else if (e.key === "Escape") { setOpen(false); (e.target as HTMLInputElement).blur(); }
          }}
          placeholder={S.searchPlaceholder}
          aria-label={S.searchLabel}
          role="combobox"
          aria-expanded={open && q.trim().length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && hits.length ? `${listId}-${hi}` : undefined}
          data-testid="lab-search"
          className="min-w-0 flex-1 bg-transparent text-sm text-white placeholder:text-white/45 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
        />
        {q ? (
          <button type="button" onClick={() => setQ("")} aria-label={S.clearSearch} className="text-white/50 hover:text-white"><X className="h-4 w-4" aria-hidden /></button>
        ) : (
          <kbd className="hidden rounded border border-white/15 px-1.5 font-pixel text-[9px] text-white/50 lg:inline">/</kbd>
        )}
      </div>
      {open && q.trim() && (
        <div className="absolute right-0 top-full z-50 mt-1.5 w-full min-w-[260px] overflow-hidden rounded-lg border border-white/12 bg-[#060c1a]/95 shadow-2xl backdrop-blur-md">
          <ul id={listId} role="listbox" aria-label={S.searchLabel}>
            {hits.map((pos, i) => {
              const m = all[seq[pos]];
              return (
                <li key={pos} id={`${listId}-${i}`} role="option" aria-selected={i === hi}>
                  <button
                    type="button"
                    onMouseEnter={() => setHi(i)}
                    onClick={() => go(pos)}
                    data-testid="lab-search-hit"
                    className={cn("flex w-full items-center gap-3 px-3 py-2 text-left", i === hi ? "bg-white/[0.08]" : "")}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/sizes/art/256/${m.id}.webp`} alt="" width={32} height={32} className="h-8 w-8 object-contain" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-display text-[13px] font-semibold uppercase tracking-wide text-white">{m.name}</span>
                      <span className="block font-pixel text-[8.5px] uppercase tracking-[0.14em] text-white/45">{dexNo(m.species)}</span>
                    </span>
                    <span className="flex gap-1">{m.types.map((t) => <TypeDot key={t} t={t} />)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {hits.length === 0 && (
            <div className="px-3 py-2.5 text-[12.5px] text-white/60">
              {everyone.length ? (
                <>
                  <p className="font-pixel text-[8.5px] uppercase tracking-[0.14em] text-white/45">{S.notInView}</p>
                  {everyone.map((i) => (
                    <button key={i} type="button" onClick={() => { onShowAnyway(all[i].id); setOpen(false); setQ(""); }} className="mt-1.5 flex w-full items-center justify-between rounded-md px-1 py-1 text-left hover:bg-white/[0.06]" data-testid="lab-search-anyway">
                      <span className="font-display text-[13px] font-semibold uppercase tracking-wide text-white">{all[i].name}</span>
                      <span className="text-[11px] text-cyan-200">{S.showAll}</span>
                    </button>
                  ))}
                </>
              ) : (
                S.noSearchMatch
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** The desktop toolbar: brand, types, generations, more filters, sort, search. */
export function Toolbar({ view, set, all, seq, onJump, onShowAnyway, searchRef }: {
  view: LabView;
  set: (v: Partial<LabView>) => void;
  all: LabMon[];
  seq: number[];
  onJump: (pos: number) => void;
  onShowAnyway: (id: number) => void;
  searchRef: React.RefObject<HTMLInputElement | null>;
}) {
  const [typesOpen, setTypesOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const tRef = useRef<HTMLDivElement>(null);
  const mRef = useRef<HTMLDivElement>(null);
  useOutside(tRef, typesOpen, () => setTypesOpen(false));
  useOutside(mRef, moreOpen, () => setMoreOpen(false));
  const more = Number(view.legends) + Number(view.final) + Number(view.forms);
  const dirty = activeCount(view) > 0 || view.sort !== "id" || view.reverse;
  return (
    <div className="flex items-center gap-2.5" data-testid="lab-toolbar">
      <div className={cn(chip, "flex h-9 items-center gap-2 px-3")}>
        <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan-300 opacity-50 motion-reduce:animate-none" /><span className="relative inline-flex h-2 w-2 rounded-full bg-cyan-300" /></span>
        <span className="whitespace-nowrap font-pixel text-[10px] uppercase tracking-[0.14em] text-cyan-100">{S.brand}</span>
      </div>
      <div ref={tRef} className="relative">
        <button
          type="button"
          onClick={() => setTypesOpen((o) => !o)}
          aria-expanded={typesOpen}
          aria-haspopup="true"
          data-testid="lab-types"
          className={cn(chip, "flex h-9 items-center gap-2 px-3 font-display text-[11px] font-semibold uppercase tracking-wider", view.types.length ? "text-white" : "text-white/70")}
        >
          {view.types.length ? view.types.map((t) => <span key={t} className="flex items-center gap-1.5"><TypeDot t={t} />{t}</span>) : S.allTypes}
          <ChevronDown className="h-3.5 w-3.5 text-white/50" aria-hidden />
        </button>
        {typesOpen && (
          <div className="absolute left-0 top-full z-50 mt-1.5 w-[330px] rounded-lg border border-white/12 bg-[#060c1a]/95 shadow-2xl backdrop-blur-md">
            <div className="flex items-center justify-between px-3 pt-2.5">
              <span className="hud-label !text-[9px]">{S.typesHint}</span>
              {view.types.length > 0 && <button type="button" onClick={() => set({ types: [] })} className="text-[11px] text-cyan-200 hover:underline">{S.allTypes}</button>}
            </div>
            <TypePicker types={view.types} onChange={(types) => set({ types })} />
          </div>
        )}
      </div>
      <div className={cn(chip, "hidden h-9 items-center gap-0.5 px-1 xl:flex")}>
        <span className="px-2 font-pixel text-[9px] uppercase tracking-[0.14em] text-white/45">{S.gen}</span>
        <GenPicker gens={view.gens} onChange={(gens) => set({ gens })} />
      </div>
      <div ref={mRef} className="relative">
        <button
          type="button"
          onClick={() => setMoreOpen((o) => !o)}
          aria-expanded={moreOpen}
          aria-haspopup="true"
          data-testid="lab-filters"
          className={cn(chip, "flex h-9 items-center gap-2 px-3 font-display text-[11px] font-semibold uppercase tracking-wider", more ? "text-white" : "text-white/70")}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden />
          {S.filters}
          {more > 0 && <span className="grid h-4 min-w-4 place-items-center rounded-full bg-cyan-300 px-1 text-[10px] text-[#04121c]">{more}</span>}
        </button>
        {moreOpen && (
          <div className="absolute left-0 top-full z-50 mt-1.5 w-[300px] space-y-2 rounded-lg border border-white/12 bg-[#060c1a]/95 p-2 shadow-2xl backdrop-blur-md">
            <div className="xl:hidden">
              <p className="hud-label px-2 pb-1 pt-1 !text-[9px]">{S.gen}</p>
              <GenPicker gens={view.gens} onChange={(gens) => set({ gens })} compact />
            </div>
            <TogglesList view={view} set={set} />
          </div>
        )}
      </div>
      <div className={cn(chip, "flex items-center gap-1.5 py-0 pl-2.5 pr-0")}>
        <span className="font-pixel text-[9px] uppercase tracking-[0.14em] text-white/45">{S.sortBy}</span>
        <SortPicker view={view} set={set} />
      </div>
      {dirty && (
        <button type="button" onClick={() => set(DEFAULT_VIEW)} data-testid="lab-reset" className="whitespace-nowrap px-1 text-[12px] text-white/60 underline-offset-2 hover:text-white hover:underline">
          {S.reset}
        </button>
      )}
      <SearchBox all={all} seq={seq} onJump={onJump} onShowAnyway={onShowAnyway} className="ml-auto w-60" inputRef={searchRef} />
    </div>
  );
}
