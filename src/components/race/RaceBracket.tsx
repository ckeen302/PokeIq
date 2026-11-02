"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { formatTime } from "@/lib/race/race";
import { pathOf, type Tournament } from "@/lib/race/tournament";
import { fold } from "@/lib/race/lineup";
import type { Entrant } from "@/lib/race/types";
import { cn } from "@/lib/utils";

/**
 * "Every Pokémon": the knockout as a bracket, round by round: every heat
 * with its runners, times and who went through (Q by place, q as a fastest
 * loser). Search any Pokémon to follow its path.
 */
export function RaceBracket({ t, byKey, onClose, onWatchFinal, onRedraw }: { t: Tournament; byKey: Map<string, Entrant>; onClose(): void; onWatchFinal(): void; onRedraw(): void }) {
  const [round, setRound] = useState(t.rounds.length - 1);
  const [q, setQ] = useState("");
  const hit = useMemo(() => {
    const f = fold(q.trim());
    if (!f) return null;
    const e = [...byKey.values()].find((x) => fold(x.name) === f) ?? [...byKey.values()].find((x) => fold(x.name).startsWith(f) && t.reached.has(x.key));
    return e && t.reached.has(e.key) ? e : null;
  }, [q, byKey, t]);
  const path = hit ? pathOf(t, hit.key) : [];
  const r = t.rounds[round];
  const heats = hit ? r.heats.filter((h) => h.results.some((x) => x.key === hit.key)) : r.heats;
  const name = (k: string) => byKey.get(k)?.name ?? k;
  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-end justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-labelledby="race-bracket-title" data-testid="race-bracket">
      <div className="dark-scope relative flex max-h-full w-full flex-col overflow-hidden rounded-t-2xl border border-white/15 bg-[#0b1226] text-white shadow-2xl sm:max-w-3xl sm:rounded-2xl">
        <div className="border-b border-white/10 p-5 pb-3">
          <button type="button" onClick={onClose} className="absolute right-3 top-3 rounded-md p-1.5 text-white/60 hover:text-white" aria-label="Close" data-testid="race-bracket-close">
            <X className="h-5 w-5" />
          </button>
          <h2 id="race-bracket-title" className="font-display text-lg font-bold uppercase tracking-wider">Every Pokémon: the bracket</h2>
          <p className="mt-1 text-sm text-white/60">
            Champion: <span className="font-semibold text-[#ffd84a]">{name(t.champion)}</span>. Q = through by place, q = fastest loser.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5" role="tablist" aria-label="Rounds">
            {t.rounds.map((x, i) => (
              <button key={x.name} type="button" role="tab" aria-selected={i === round} onClick={() => setRound(i)} className={cn("rounded-md border px-2.5 py-1.5 font-display text-[11px] font-semibold uppercase tracking-wide", i === round ? "border-[#ffd84a] bg-[#ffd84a]/10 text-[#ffd84a]" : "border-white/15 text-white/70 hover:text-white")} data-testid="race-bracket-round">
                {x.name} <span className="text-white/40">({x.heats.length})</span>
              </button>
            ))}
          </div>
          <label className="mt-3 flex h-10 items-center gap-2 rounded-lg border border-white/20 bg-[#121b36] px-3 focus-within:border-[#ffd84a]">
            <Search className="h-4 w-4 text-white/50" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a Pokémon's path…" aria-label="Find a Pokémon in the bracket" className="h-full w-full bg-transparent font-display text-sm outline-none placeholder:text-white/40" data-testid="race-bracket-search" />
          </label>
          {hit && (
            <p className="mt-2 text-sm" data-testid="race-bracket-path">
              <span className="font-semibold">{hit.name}</span>:{" "}
              {path.map((p, i) => (
                <span key={p.round.name}>
                  {i > 0 && " → "}
                  {p.round.name} {p.result.place}
                  {p.result.q ? <span className="text-[#ffd84a]"> {p.result.q}</span> : p.round.name === "Final" ? "" : <span className="text-white/50"> out</span>}
                </span>
              ))}
            </p>
          )}
        </div>
        <div className="grid flex-1 gap-2 overflow-y-auto p-4 sm:grid-cols-2" data-testid="race-bracket-heats">
          {heats.map((h) => (
            <div key={h.index} className="rounded-lg border border-white/10 bg-white/[0.03] p-2.5">
              <div className="mb-1 font-pixel text-[9px] uppercase tracking-wider text-white/50">{r.name === "Final" ? "Final" : `${r.name} · heat ${h.index + 1}`}</div>
              <ol className="space-y-0.5 text-[13px]">
                {h.results.map((x) => (
                  <li key={x.key} className={cn("flex items-center justify-between gap-2 rounded px-1.5 py-0.5", hit?.key === x.key && "bg-[#ffd84a]/15")}>
                    <span className="min-w-0 truncate">
                      <span className="mr-1.5 inline-block w-4 text-white/45 tabular-nums">{x.place}</span>
                      {name(x.key)}
                    </span>
                    <span className="shrink-0 tabular-nums text-white/75">
                      {formatTime(x.time)}
                      <span className={cn("ml-1.5 inline-block w-3 font-bold", x.q === "Q" ? "text-[#ffd84a]" : "text-[#9fd8ff]")}>{x.q ?? ""}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
        <div className="flex gap-2 border-t border-white/10 p-4">
          <button type="button" onClick={onWatchFinal} className="rc-go inline-flex h-11 flex-1 items-center justify-center rounded-lg font-display text-sm font-bold uppercase tracking-wider" data-testid="race-bracket-final">Watch the final</button>
          <button type="button" onClick={onRedraw} className="inline-flex h-11 items-center justify-center rounded-lg border border-white/20 px-4 font-display text-sm font-bold uppercase tracking-wider text-white/85 hover:text-white" data-testid="race-bracket-redraw">Redraw</button>
        </div>
      </div>
    </div>
  );
}
