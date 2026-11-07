"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Dices, Play, Plus, X } from "lucide-react";
import { dexTag } from "@/lib/race/types";
import { searchEntrants } from "@/lib/race/lineup";
import { badgeName } from "@/lib/sizes/badges";
import type { Athlete } from "@/lib/games/athlete";
import { EVENTS, eventOf, type EventId } from "@/lib/games/events";
import { MAX_FIELD } from "@/lib/games/deeplink";
import { funLineup } from "@/lib/games/lineups";
import { newSeed } from "@/lib/games/seed";
import { cn } from "@/lib/utils";

/**
 * Pick an event and up to eight Pokémon or forms (search by name or Dex
 * number), or let the site pick a fun line-up. Two make a head to head.
 */
export function GamesPicker({ all, event, keys, onRun, onClose }: {
  all: Athlete[];
  event: EventId;
  keys: string[];
  onRun(event: EventId, keys: string[]): void;
  onClose(): void;
}) {
  const [field, setField] = useState<string[]>(keys);
  const [ev, setEv] = useState<EventId>(event);
  const [q, setQ] = useState("");
  const [fun, setFun] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const byKey = useMemo(() => new Map(all.map((a) => [a.key, a])), [all]);
  const entrants = useMemo(() => all.map((a) => a.entrant), [all]);
  const results = useMemo(() => searchEntrants(entrants, q, 8), [entrants, q]);
  useEffect(() => { input.current?.focus({ preventScroll: true }); }, []);
  const add = (key: string) => {
    setField((f) => (f.includes(key) ? f : [...f, key].slice(-MAX_FIELD)));
    setQ("");
    setFun(null);
    input.current?.focus();
  };
  const min = ev === "wrestling" || ev === "all-around" ? 2 : 1;
  const ok = field.length >= min && field.length <= MAX_FIELD;
  const stat = (a: Athlete | undefined) => {
    if (!a) return "";
    const e = eventOf(ev);
    const k = e.stats[0];
    return k === "kg" ? `${a.kg} kg` : k === "height" ? `${a.height.toFixed(1)} m` : String(a.stats[k]);
  };
  const statLabel = (() => { const k = eventOf(ev).stats[0]; return k === "kg" ? "KG" : k === "height" ? "HEIGHT" : k.toUpperCase(); })();
  const tile = "rounded-md border px-2 py-1.5 font-display text-[11px] font-semibold uppercase tracking-wide transition-colors";
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="games-picker-title" data-testid="games-picker">
      <div className="dark-scope relative max-h-full w-full overflow-y-auto rounded-t-2xl border border-white/15 bg-[#0b1226] p-5 text-white shadow-2xl sm:max-w-xl sm:rounded-2xl" data-rc-scroll>
        <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded-md p-1.5 text-white/60 hover:text-white" aria-label="Close" data-testid="games-picker-close"><X className="h-5 w-5" /></button>
        <h2 id="games-picker-title" className="font-display text-lg font-bold uppercase tracking-wider">Pick an event and a line-up</h2>
        <p className="mt-1 text-sm text-white/60">Up to eight Pokémon or forms. Two make a head to head.</p>

        <div className="mt-4 grid grid-cols-3 gap-1.5 sm:grid-cols-4" role="radiogroup" aria-label="Event">
          {EVENTS.map((e) => (
            <button key={e.id} type="button" role="radio" aria-checked={ev === e.id} onClick={() => setEv(e.id)} className={cn(tile, ev === e.id ? "border-[#ffd84a] bg-[#ffd84a]/10 text-[#ffd84a]" : "border-white/15 text-white/75 hover:text-white")} data-testid={`games-event-${e.id}`}>
              {e.name}
            </button>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5" data-testid="games-picker-field">
          {field.map((k) => {
            const a = byKey.get(k);
            return (
              <span key={k} className="inline-flex h-8 items-center gap-1 rounded-md bg-white/10 pl-2.5 pr-1 font-display text-[11px] font-semibold uppercase tracking-wide" data-testid="games-picker-chip">
                {a ? badgeName(a.name) : k}
                {a && <span className="ml-1 text-[#ffd84a]">{stat(a)}</span>}
                <button type="button" onClick={() => setField((f) => f.filter((x) => x !== k))} className="rounded p-1 text-white/60 hover:text-white" aria-label={`Remove ${a?.name ?? k}`}><X className="h-3.5 w-3.5" /></button>
              </span>
            );
          })}
          {field.length < MAX_FIELD && (
            <span className="inline-flex h-8 items-center gap-1 rounded-md border border-dashed border-white/30 px-2.5 font-display text-[11px] font-semibold uppercase tracking-wide text-white/60">
              <Plus className="h-3.5 w-3.5" aria-hidden /> {field.length < min ? `Add ${min - field.length} more` : "Add up to 8"}
            </span>
          )}
        </div>

        <div className="mt-3 flex gap-2">
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && results[0]) add(results[0].key); }}
            placeholder="Add a Pokémon…"
            aria-label="Search for a Pokémon to add"
            className="h-11 min-w-0 flex-1 rounded-lg border border-white/20 bg-[#121b36] px-3 font-display text-sm text-white placeholder:text-white/45 outline-none focus:border-[#ffd84a]"
            data-testid="games-picker-search"
          />
          <button type="button" onClick={() => { const l = funLineup(all, newSeed()); setField(l.keys); setFun(l.label); }} className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border border-white/20 px-3 font-display text-xs font-bold uppercase tracking-wider text-white/85 hover:border-white/40 hover:text-white" data-testid="games-picker-fun">
            <Dices className="h-4 w-4 text-[#ffd84a]" aria-hidden /> <span className="hidden min-[400px]:inline">Fun line-up</span>
          </button>
        </div>
        {fun && <p className="mt-1.5 font-pixel text-[9px] uppercase tracking-[0.16em] text-[#9fd8ff]">{fun}</p>}
        {results.length > 0 && (
          <ul className="mt-1 max-h-56 overflow-y-auto rounded-lg border border-white/15 bg-[#0e1730] p-1" role="listbox">
            {results.map((e) => (
              <li key={e.key}>
                <button type="button" onClick={() => add(e.key)} className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left hover:bg-white/10" data-testid="games-picker-result" data-key={e.key}>
                  <span className="min-w-0">
                    <span className="block truncate font-display text-sm font-semibold uppercase tracking-wide">{e.name}</span>
                    <span className="block font-pixel text-[9px] uppercase tracking-wider text-white/50">{dexTag(e.species)}</span>
                  </span>
                  <span className="shrink-0 text-right font-display text-sm font-bold tabular-nums text-[#ffd84a]">{stat(byKey.get(e.key))}<span className="ml-1 font-pixel text-[8px] text-white/45">{statLabel}</span></span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <button type="button" disabled={!ok} onClick={() => onRun(ev, field)} className="rc-go mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg font-display text-sm font-bold uppercase tracking-wider disabled:opacity-45" data-testid="games-picker-run">
          <Play className="h-4 w-4 fill-current" aria-hidden /> {field.length === 2 ? "Head to head" : "Go"}
        </button>
      </div>
    </div>
  );
}
