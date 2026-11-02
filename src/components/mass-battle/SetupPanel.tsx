"use client";

import { useEffect, useState } from "react";
import { Plus, Swords, Trash2, Trophy } from "lucide-react";
import { ARENAS, ARENA_LABEL, FORMATIONS, FORMATION_LABEL, LEVELS, type ArenaId, type BattleLevel, type BattleSpec, type Formation, type Question } from "@/lib/mass-battle/types";
import { MAX_SIDE, MAX_SPECIES, newSeed } from "@/lib/mass-battle/share";
import { fmt, questionText } from "@/lib/mass-battle/copy";
import { HudHeading } from "@/components/game/HudHeading";
import { buttonVariants } from "@/components/ui/button";
import { PokemonPicker, type PickerMon } from "./PokemonPicker";
import type { BattleDesc, PresetCard } from "./MassBattleExperience";
import { cn } from "@/lib/utils";

type Row = { id: number; count: number };
type Side = { rows: Row[]; formation: Formation };

const slug = (list: PickerMon[], s: string) => list.find((p) => p.slug === s)?.id ?? list[0]?.id ?? 1;

/**
 * Setting up a battle: "How many X beat Y?" (the solver), an army against
 * an army (up to four species a side), and the ready-made presets.
 */
export function SetupPanel({ list, presets, busy, current, onAsk, onFight, onPreset, levelDefault, arenaDefault }: {
  list: PickerMon[];
  presets: PresetCard[];
  busy: boolean;
  current: BattleDesc | null;
  onAsk(q: Question): void;
  onFight(spec: BattleSpec): void;
  onPreset(p: PresetCard): void;
  levelDefault: BattleLevel;
  arenaDefault: ArenaId;
}) {
  const [tab, setTab] = useState<"ask" | "army">("ask");
  const [challenger, setChallenger] = useState(() => current?.question?.challenger ?? slug(list, "magikarp"));
  const [boss, setBoss] = useState(() => current?.question?.boss ?? slug(list, "arceus"));
  const [level, setLevel] = useState<BattleLevel>(levelDefault);
  const [arena, setArena] = useState<ArenaId>(arenaDefault);
  const [sides, setSides] = useState<[Side, Side]>(() => [
    { rows: [{ id: slug(list, "rattata"), count: 1000 }], formation: "swarm" },
    { rows: [{ id: slug(list, "mewtwo"), count: 1 }], formation: "line" },
  ]);
  // A shared or preset question fills the form in.
  const q = current?.question ?? current?.bonus?.question ?? null;
  useEffect(() => {
    if (!q) return;
    setChallenger(q.challenger);
    setBoss(q.boss);
    setLevel(q.level);
    setArena(q.arena);
  }, [q?.challenger, q?.boss, q?.level, q?.arena]); // eslint-disable-line react-hooks/exhaustive-deps
  const name = (id: number) => list.find((p) => p.id === id)?.name ?? "";
  const tabBtn = (on: boolean) => cn("flex-1 rounded-md px-3 py-2 font-display text-xs font-bold uppercase tracking-wider transition-colors sm:flex-none", on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground");
  const select = "mt-1 h-11 w-full rounded-lg border bg-card px-2 font-display text-sm font-semibold uppercase tracking-wide";
  const label = "font-pixel text-[9px] uppercase tracking-[0.18em] text-muted-foreground";

  const setRow = (s: 0 | 1, k: number, row: Partial<Row>) =>
    setSides((cur) => {
      const next = [...cur] as [Side, Side];
      next[s] = { ...next[s], rows: next[s].rows.map((r, i) => (i === k ? { ...r, ...row } : r)) };
      return next;
    });
  const total = (s: 0 | 1) => sides[s].rows.reduce((a, r) => a + r.count, 0);

  return (
    <div className="space-y-8">
      <section className="space-y-4 rounded-xl border bg-card/60 p-4 sm:p-6" aria-labelledby="mb-setup">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="mb-setup" className="font-display text-xl font-bold uppercase tracking-tight sm:text-2xl">Set up a battle</h2>
          <div className="flex gap-1 rounded-lg border bg-background/60 p-1" role="tablist" aria-label="Kind of battle">
            <button type="button" role="tab" aria-selected={tab === "ask"} onClick={() => setTab("ask")} className={tabBtn(tab === "ask")} data-testid="mb-tab-ask">How many?</button>
            <button type="button" role="tab" aria-selected={tab === "army"} onClick={() => setTab("army")} className={tabBtn(tab === "army")} data-testid="mb-tab-army">Army vs army</button>
          </div>
        </div>

        {tab === "ask" ? (
          <div className="space-y-4" role="tabpanel">
            <p className="font-display text-lg font-bold uppercase tracking-tight sm:text-2xl" data-testid="mb-question">{questionText(name(challenger), name(boss))}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <PokemonPicker label="How many…" value={challenger} list={list} onChange={setChallenger} testId="mb-pick-challenger" disabled={busy} />
              <PokemonPicker label="…beat" value={boss} list={list} onChange={setBoss} testId="mb-pick-boss" disabled={busy} />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:max-w-md">
              <div>
                <label className={label} htmlFor="mb-ask-level">Level</label>
                <select id="mb-ask-level" value={level} onChange={(e) => setLevel(Number(e.target.value) as BattleLevel)} className={select}>
                  {LEVELS.map((l) => <option key={l} value={l}>Level {l}</option>)}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="mb-ask-arena">Arena</label>
                <select id="mb-ask-arena" value={arena} onChange={(e) => setArena(e.target.value as ArenaId)} className={select}>
                  {ARENAS.map((a) => <option key={a} value={a}>{ARENA_LABEL[a]}</option>)}
                </select>
              </div>
            </div>
            <button type="button" disabled={busy} onClick={() => onAsk({ challenger, boss, level, arena })} className={buttonVariants({ size: "lg" })} data-testid="mb-ask">
              <Trophy className="h-4 w-4" aria-hidden /> Find out
            </button>
          </div>
        ) : (
          <div className="space-y-4" role="tabpanel">
            <div className="grid gap-4 lg:grid-cols-2">
              {([0, 1] as const).map((s) => (
                <div key={s} className={cn("space-y-3 rounded-lg border p-3", s === 0 ? "border-[#4f9bff]/40" : "border-[#ff5a64]/40")} data-testid={`mb-side-${s}`}>
                  <div className="flex items-center justify-between">
                    <span className={cn("font-display text-sm font-bold uppercase tracking-wider", s === 0 ? "text-[#4f9bff]" : "text-[#ff5a64]")}>{s === 0 ? "Blue army" : "Red army"}</span>
                    <span className="font-pixel text-[10px] text-muted-foreground">{fmt(total(s))} / {fmt(MAX_SIDE)}</span>
                  </div>
                  {sides[s].rows.map((r, k) => (
                    <div key={k} className="grid grid-cols-[minmax(0,1fr)_6.5rem_auto] items-end gap-2">
                      <PokemonPicker label={`Pokémon ${k + 1}`} value={r.id} list={list} onChange={(id) => setRow(s, k, { id })} testId={`mb-side-${s}-pick-${k}`} disabled={busy} />
                      <div>
                        <label className={label} htmlFor={`mb-c-${s}-${k}`}>Count</label>
                        <input
                          id={`mb-c-${s}-${k}`}
                          type="number"
                          inputMode="numeric"
                          min={1}
                          max={MAX_SIDE}
                          value={r.count}
                          onChange={(e) => setRow(s, k, { count: Math.max(1, Math.min(MAX_SIDE, Math.floor(Number(e.target.value) || 1))) })}
                          className="mt-1 h-12 w-full rounded-lg border bg-card px-2 font-display text-base font-bold tabular-nums"
                          data-testid={`mb-side-${s}-count-${k}`}
                        />
                      </div>
                      <button
                        type="button"
                        aria-label="Remove"
                        disabled={sides[s].rows.length <= 1 || busy}
                        onClick={() => setSides((cur) => { const next = [...cur] as [Side, Side]; next[s] = { ...next[s], rows: next[s].rows.filter((_, i) => i !== k) }; return next; })}
                        className="mb-0.5 h-11 rounded-lg border px-2 text-muted-foreground hover:text-foreground disabled:opacity-30"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                  <div className="flex flex-wrap items-end gap-2">
                    <button
                      type="button"
                      disabled={sides[s].rows.length >= MAX_SPECIES || busy}
                      onClick={() => setSides((cur) => { const next = [...cur] as [Side, Side]; next[s] = { ...next[s], rows: [...next[s].rows, { id: slug(list, s === 0 ? "pikachu" : "snorlax"), count: s === 0 ? 50 : 1 }] }; return next; })}
                      className={buttonVariants({ variant: "outline", size: "sm" })}
                    >
                      <Plus className="h-4 w-4" aria-hidden /> Add a species
                    </button>
                    <div className="ml-auto min-w-[9rem]">
                      <label className={label} htmlFor={`mb-f-${s}`}>Formation</label>
                      <select id={`mb-f-${s}`} value={sides[s].formation} onChange={(e) => setSides((cur) => { const next = [...cur] as [Side, Side]; next[s] = { ...next[s], formation: e.target.value as Formation }; return next; })} className={select}>
                        {FORMATIONS.map((f) => <option key={f} value={f}>{FORMATION_LABEL[f]}</option>)}
                      </select>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-3 sm:max-w-md">
              <div>
                <label className={label} htmlFor="mb-army-level">Level</label>
                <select id="mb-army-level" value={level} onChange={(e) => setLevel(Number(e.target.value) as BattleLevel)} className={select}>
                  {LEVELS.map((l) => <option key={l} value={l}>Level {l}</option>)}
                </select>
              </div>
              <div>
                <label className={label} htmlFor="mb-army-arena">Arena</label>
                <select id="mb-army-arena" value={arena} onChange={(e) => setArena(e.target.value as ArenaId)} className={select}>
                  {ARENAS.map((a) => <option key={a} value={a}>{ARENA_LABEL[a]}</option>)}
                </select>
              </div>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => onFight({ sides: [{ units: sides[0].rows.map((r) => ({ id: r.id, count: r.count })), formation: sides[0].formation }, { units: sides[1].rows.map((r) => ({ id: r.id, count: r.count })), formation: sides[1].formation }], level, arena, seed: newSeed() })}
              className={buttonVariants({ size: "lg" })}
              data-testid="mb-fight"
            >
              <Swords className="h-4 w-4" aria-hidden /> Battle!
            </button>
          </div>
        )}
      </section>

      <section className="space-y-4" aria-labelledby="mb-presets">
        <HudHeading index={1} id="mb-presets" title="Ready-made battles" aside="Each with its own link" />
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {presets.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPreset(p)}
                className={cn("flex h-full w-full flex-col gap-2 rounded-xl border bg-card p-4 text-left transition-colors hover:border-screen/60", current?.presetId === p.id && "border-primary/70")}
                data-testid={`mb-preset-${p.id}`}
              >
                <span className="font-display text-base font-bold uppercase leading-tight tracking-tight">{p.title}</span>
                <span className="text-xs text-muted-foreground">{p.blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
