"use client";

import { useMemo, useState } from "react";
import { Play, Plus, X } from "lucide-react";
import { searchEntrants } from "@/lib/race/lineup";
import { badgeName } from "@/lib/sizes/badges";
import type { Athlete } from "@/lib/games/athlete";
import { MAX_NATIONS, NATION_SIZE, NATION_TYPES, TYPE_COLORS, typeLabel, type NationSpec } from "@/lib/games/games";
import { cn } from "@/lib/utils";

/**
 * The Games' nations: up to eight, each a type (its three best
 * all-rounders) or a team of three you build.
 */
export function NationsPicker({ all, specs, onRun, onClose }: {
  all: Athlete[];
  specs: NationSpec[];
  onRun(specs: NationSpec[]): void;
  onClose(): void;
}) {
  const [list, setList] = useState<NationSpec[]>(specs);
  const [team, setTeam] = useState<string[]>([]);
  const [q, setQ] = useState("");
  const byKey = useMemo(() => new Map(all.map((a) => [a.key, a])), [all]);
  const entrants = useMemo(() => all.map((a) => a.entrant), [all]);
  const results = useMemo(() => searchEntrants(entrants, q, 6), [entrants, q]);
  const has = (t: string) => list.some((s) => "type" in s && s.type === t);
  const toggle = (t: string) => setList((l) => (has(t) ? l.filter((s) => !("type" in s && s.type === t)) : l.length < MAX_NATIONS ? [...l, { type: t }] : l));
  const full = list.length >= MAX_NATIONS;
  const label = (s: NationSpec) => ("type" in s ? `Team ${typeLabel(s.type)}` : `Team ${byKey.get(s.keys[0])?.name ?? s.keys[0]}`);
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="games-nations-title" data-testid="games-nations">
      <div className="dark-scope relative max-h-full w-full overflow-y-auto rounded-t-2xl border border-white/15 bg-[#0b1226] p-5 text-white shadow-2xl sm:max-w-xl sm:rounded-2xl" data-rc-scroll>
        <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded-md p-1.5 text-white/60 hover:text-white" aria-label="Close"><X className="h-5 w-5" /></button>
        <h2 id="games-nations-title" className="font-display text-lg font-bold uppercase tracking-wider">Nations</h2>
        <p className="mt-1 text-sm text-white/60">Up to eight. A type sends its three best all-rounders (no Legendaries); or build a team of three.</p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          {list.map((s, i) => (
            <span key={i} className="inline-flex h-8 items-center gap-1 rounded-md bg-white/10 pl-2.5 pr-1 font-display text-[11px] font-semibold uppercase tracking-wide" data-testid="games-nation-chip">
              <span className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: "type" in s ? TYPE_COLORS[s.type] : "#9fd8ff" }} />
              {label(s)}
              <button type="button" onClick={() => setList((l) => l.filter((_, j) => j !== i))} className="rounded p-1 text-white/60 hover:text-white" aria-label={`Remove ${label(s)}`}><X className="h-3.5 w-3.5" /></button>
            </span>
          ))}
        </div>

        <div className="mt-4 font-pixel text-[9px] uppercase tracking-[0.18em] text-white/55">Type nations</div>
        <div className="mt-1.5 grid grid-cols-3 gap-1.5 sm:grid-cols-6">
          {NATION_TYPES.map((t) => (
            <button key={t} type="button" aria-pressed={has(t)} disabled={!has(t) && full} onClick={() => toggle(t)} className={cn("rounded-md border px-2 py-1.5 font-display text-[11px] font-semibold uppercase tracking-wide transition-colors disabled:opacity-40", has(t) ? "text-[#0b1226]" : "border-white/15 text-white/80 hover:text-white")} style={has(t) ? { background: TYPE_COLORS[t], borderColor: TYPE_COLORS[t] } : undefined} data-testid={`games-type-${t}`}>
              {typeLabel(t)}
            </button>
          ))}
        </div>

        <div className="mt-4 font-pixel text-[9px] uppercase tracking-[0.18em] text-white/55">Build a team of three</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {team.map((k) => (
            <span key={k} className="inline-flex h-8 items-center gap-1 rounded-md bg-white/10 pl-2.5 pr-1 font-display text-[11px] font-semibold uppercase tracking-wide">
              {badgeName(byKey.get(k)?.name ?? k)}
              <button type="button" onClick={() => setTeam((x) => x.filter((y) => y !== k))} className="rounded p-1 text-white/60 hover:text-white" aria-label="Remove"><X className="h-3.5 w-3.5" /></button>
            </span>
          ))}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a Pokémon to your team…" aria-label="Search for a Pokémon" className="mt-2 h-10 w-full rounded-lg border border-white/20 bg-[#121b36] px-3 font-display text-sm text-white placeholder:text-white/45 outline-none focus:border-[#ffd84a]" data-testid="games-team-search" />
        {q && results.length > 0 && (
          <ul className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-white/15 bg-[#0e1730] p-1">
            {results.map((e) => (
              <li key={e.key}>
                <button type="button" disabled={team.length >= NATION_SIZE} onClick={() => { setTeam((x) => (x.includes(e.key) ? x : [...x, e.key].slice(0, NATION_SIZE))); setQ(""); }} className="w-full rounded-md px-3 py-1.5 text-left font-display text-sm font-semibold uppercase tracking-wide hover:bg-white/10 disabled:opacity-40" data-testid="games-team-result">{e.name}</button>
              </li>
            ))}
          </ul>
        )}
        <button type="button" disabled={!team.length || full} onClick={() => { setList((l) => [...l, { keys: team }]); setTeam([]); }} className="mt-2 inline-flex h-10 items-center gap-1.5 rounded-lg border border-white/20 px-3 font-display text-xs font-bold uppercase tracking-wider text-white/85 hover:text-white disabled:opacity-40" data-testid="games-team-add">
          <Plus className="h-4 w-4" aria-hidden /> Add this team
        </button>

        <button type="button" disabled={list.length < 2} onClick={() => onRun(list)} className="rc-go mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg font-display text-sm font-bold uppercase tracking-wider disabled:opacity-45" data-testid="games-nations-run">
          <Play className="h-4 w-4 fill-current" aria-hidden /> Open the Games
        </button>
      </div>
    </div>
  );
}
