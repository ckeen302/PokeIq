"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Plus, X } from "lucide-react";
import { dexTag } from "@/lib/race/types";
import { searchEntrants } from "@/lib/race/lineup";
import { PRESETS } from "@/lib/race/presets";
import { VS_MAX, VS_MIN, pushRunner } from "@/lib/race/deeplink";
import { DISTANCES, type Distance } from "@/lib/race/track";
import type { Entrant } from "@/lib/race/types";
import { badgeName } from "@/lib/sizes/badges";
import { cn } from "@/lib/utils";

/**
 * Pick a race: any 2 to 8 Pokémon or forms (search by name or Dex number)
 * over 100, 200 or 400 m, or one of the presets.
 */
export function RacePicker({ all, keys, distance, onRun, onPreset, onClose }: {
  all: Entrant[];
  keys: string[];
  distance: Distance;
  onRun(keys: string[], d: Distance): void;
  onPreset(id: string, d?: Distance): void;
  onClose(): void;
}) {
  const [field, setField] = useState<string[]>(keys);
  const [d, setD] = useState<Distance>(distance);
  const [q, setQ] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const byKey = useMemo(() => new Map(all.map((e) => [e.key, e])), [all]);
  const results = useMemo(() => searchEntrants(all, q, 8), [all, q]);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  const add = (e: Entrant) => { setField((f) => pushRunner(f, e.key)); setQ(""); input.current?.focus(); };
  const ok = field.length >= VS_MIN && field.length <= VS_MAX;
  const tile = "rounded-md border px-3 py-2 font-display text-xs font-semibold uppercase tracking-wider transition-colors";
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="race-picker-title" data-testid="race-picker">
      <div className="dark-scope relative max-h-full w-full overflow-y-auto rounded-t-2xl border border-white/15 bg-[#0b1226] p-5 text-white shadow-2xl sm:max-w-lg sm:rounded-2xl">
        <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded-md p-1.5 text-white/60 hover:text-white" aria-label="Close" data-testid="race-picker-close">
          <X className="h-5 w-5" />
        </button>
        <h2 id="race-picker-title" className="font-display text-lg font-bold uppercase tracking-wider">Pick a race</h2>
        <p className="mt-1 text-sm text-white/60">Two to eight Pokémon or forms, over 100, 200 or 400 m.</p>

        <div className="mt-4 flex flex-wrap gap-1.5" data-testid="race-picker-field">
          {field.map((k) => {
            const e = byKey.get(k);
            return (
              <span key={k} className="inline-flex h-8 items-center gap-1 rounded-md bg-white/10 pl-2.5 pr-1 font-display text-[11px] font-semibold uppercase tracking-wide" data-testid="race-picker-chip">
                {e ? badgeName(e.name) : k}
                {e && <span className="ml-1 text-[#ffd84a]">{e.stats.spe}</span>}
                <button type="button" onClick={() => setField((f) => f.filter((x) => x !== k))} className="rounded p-1 text-white/60 hover:text-white" aria-label={`Remove ${e?.name ?? k}`}><X className="h-3.5 w-3.5" /></button>
              </span>
            );
          })}
          {field.length < VS_MAX && (
            <span className="inline-flex h-8 items-center gap-1 rounded-md border border-dashed border-white/30 px-2.5 font-display text-[11px] font-semibold uppercase tracking-wide text-white/60">
              <Plus className="h-3.5 w-3.5" aria-hidden /> {field.length < VS_MIN ? `Add ${VS_MIN - field.length} more` : "Add up to 8"}
            </span>
          )}
        </div>

        <input
          ref={input}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && results[0]) add(results[0]); }}
          placeholder="Add a Pokémon…"
          aria-label="Search for a Pokémon to add"
          className="mt-3 h-11 w-full rounded-lg border border-white/20 bg-[#121b36] px-3 font-display text-sm text-white placeholder:text-white/45 outline-none focus:border-[#ffd84a]"
          data-testid="race-picker-search"
        />
        {results.length > 0 && (
          <ul className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-white/15 bg-[#0e1730] p-1" role="listbox">
            {results.map((e) => (
              <li key={e.key}>
                <button type="button" onClick={() => add(e)} className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-white/10" data-testid="race-picker-result" data-key={e.key}>
                  <span className="min-w-0">
                    <span className="block truncate font-display text-sm font-semibold uppercase tracking-wide">{e.name}</span>
                    <span className="block font-pixel text-[9px] uppercase tracking-wider text-white/50">{dexTag(e.species)}</span>
                  </span>
                  <span className="shrink-0 text-right font-display text-sm font-bold tabular-nums text-[#ffd84a]">{e.stats.spe}<span className="ml-1 font-pixel text-[8px] text-white/45">SPE</span></span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4">
          <div className="font-pixel text-[9px] uppercase tracking-[0.18em] text-white/55">Distance</div>
          <div className="mt-1 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Distance">
            {DISTANCES.map((x) => (
              <button key={x} type="button" role="radio" aria-checked={d === x} onClick={() => setD(x)} className={cn(tile, d === x ? "border-[#ffd84a] bg-[#ffd84a]/10 text-[#ffd84a]" : "border-white/15 text-white/75 hover:text-white")} data-testid={`race-distance-${x}`}>
                {x} m
              </button>
            ))}
          </div>
        </div>

        <button type="button" disabled={!ok} onClick={() => onRun(field, d)} className="rc-go mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg font-display text-sm font-bold uppercase tracking-wider disabled:opacity-45" data-testid="race-picker-run">
          <Play className="h-4 w-4 fill-current" aria-hidden /> Race them
        </button>

        <div className="mt-5 font-pixel text-[9px] uppercase tracking-[0.18em] text-white/55">Or a preset</div>
        <div className="mt-1.5 grid grid-cols-2 gap-1.5">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" onClick={() => onPreset(p.id)} className="rounded-md border border-white/12 px-3 py-2 text-left font-display text-[12px] font-semibold uppercase tracking-wide text-white/85 hover:border-white/35 hover:text-white" data-testid={`race-preset-${p.id}`}>
              {p.label}
              <span className="block font-pixel text-[8px] tracking-wider text-white/45">{p.tournament ? "Knockout" : `${p.distance} m`}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
