"use client";

import { ArrowDown, ArrowUp, Crown, LoaderCircle, Plus, X } from "lucide-react";
import { HpBar } from "@/components/game/HpBar";
import type { FormatDex } from "@/lib/battle/dex";
import { labMon } from "@/lib/battle/lab/setup";
import {
  BOOST_NAMES,
  LAB_STATUSES,
  SIDE_NAMES,
  STATUS_NAMES,
  activeCount,
  boostIdsFor,
  type LabMon,
  type LabSetup,
  type LabSide,
  type LabStatus,
} from "@/lib/battle/lab/types";
import type { TeamSet } from "@/lib/battle/sets";
import { cn } from "@/lib/utils";
import { inputClass, NumberInput } from "../controls";
import { SetEditor } from "../SetEditor";
import { SIDE_COLOR, Swatch } from "./charts";

const STAGES = [6, 5, 4, 3, 2, 1, 0, -1, -2, -3, -4, -5, -6];

/**
 * The Pokémon picked in a side card: the team builder's own set editor
 * (species, level, item, ability, nature, EVs / IVs, gender, moves, shiny),
 * then how it starts the battle, and its move list when its side plays
 * Scripted.
 */
export function MonEditor({
  dex,
  error,
  setup,
  side,
  slot,
  onChange,
  onSelect,
}: {
  dex: FormatDex | null;
  error: boolean;
  setup: LabSetup;
  side: 0 | 1;
  slot: number;
  onChange: (side: LabSide) => void;
  onSelect: (slot: number) => void;
}) {
  const data = setup.sides[side];
  const mon = data.team[slot] ?? null;
  const leads = activeCount(setup);
  const lead = slot < leads;

  const setTeam = (team: LabMon[]) => onChange({ ...data, team });
  const setMon = (patch: Partial<LabMon>) => setTeam(data.team.map((m, i) => (i === slot ? { ...m, ...patch } : m)));

  function onSet(set: TeamSet | null) {
    if (!set) {
      setTeam(data.team.filter((_, i) => i !== slot));
      onSelect(Math.max(0, Math.min(slot, data.team.length - 2)));
      return;
    }
    if (!mon) {
      setTeam([...data.team, labMon(set)]);
      return;
    }
    // A new species keeps the slot's starting conditions but not a script of moves it may not have.
    const script = mon.script.filter((m) => set.moves.includes(m));
    setMon({ set, script });
  }

  function move(to: number) {
    if (!mon || to < 0 || to >= data.team.length) return;
    const team = [...data.team];
    team.splice(slot, 1);
    team.splice(to, 0, mon);
    setTeam(team);
    onSelect(to);
  }

  return (
    <div className="hud space-y-4 rounded-lg border bg-card p-4 sm:p-5" aria-label="Pokémon editor">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 font-display text-lg font-bold uppercase tracking-wide">
          <Swatch color={SIDE_COLOR[side]} /> {SIDE_NAMES[side]} · {mon ? mon.set.name || mon.set.species : "New Pokémon"}
          {mon && lead && <span className="hud-label text-screen">Lead</span>}
        </p>
        {mon && data.team.length > 1 && (
          <div className="flex gap-1.5">
            {!lead && (
              <button type="button" onClick={() => move(0)} className="inline-flex items-center gap-1 rounded-md border border-foreground/10 bg-shade/30 px-2 py-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
                <Crown className="h-3.5 w-3.5" aria-hidden /> Lead with it
              </button>
            )}
            <button type="button" onClick={() => move(slot - 1)} disabled={slot === 0} aria-label="Move up the team" className="rounded-md border border-foreground/10 bg-shade/30 p-1 text-muted-foreground hover:text-foreground disabled:opacity-30">
              <ArrowUp className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => move(slot + 1)}
              disabled={slot >= data.team.length - 1}
              aria-label="Move down the team"
              className="rounded-md border border-foreground/10 bg-shade/30 p-1 text-muted-foreground hover:text-foreground disabled:opacity-30"
            >
              <ArrowDown className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        )}
      </div>

      {dex ? (
        <SetEditor key={`${side}:${slot}:${setup.gen}`} dex={dex} set={mon?.set ?? null} slot={slot} problems={[]} onChange={onSet} />
      ) : error ? (
        <p className="py-10 text-center text-sm text-destructive">Couldn&apos;t load the Pokédex data. Check your connection and reload.</p>
      ) : (
        <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> Loading Gen {setup.gen} data…
        </p>
      )}

      {mon && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Starting conditions */}
          <fieldset className="min-w-0 space-y-3 rounded-lg border bg-shade/20 p-3">
            <legend className="hud-label px-1">How it starts the battle</legend>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-sm">HP</span>
                <span className="flex items-center gap-1 text-xs">
                  <NumberInput label="Starting HP %" value={mon.hp} min={1} max={100} onChange={(hp) => setMon({ hp })} className="h-7 w-14" />%
                </span>
              </div>
              <input
                type="range"
                min={1}
                max={100}
                value={mon.hp}
                aria-label="Starting HP"
                onChange={(e) => setMon({ hp: Number(e.target.value) })}
                className="h-2 w-full cursor-pointer accent-[hsl(var(--success))]"
              />
              <HpBar value={mon.hp / 100} />
            </div>
            <label className="flex items-center justify-between gap-3 text-sm">
              Status
              <select aria-label="Starting status" value={mon.status} onChange={(e) => setMon({ status: e.target.value as LabStatus })} className={cn(inputClass, "w-44")}>
                {LAB_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_NAMES[s]}
                  </option>
                ))}
              </select>
            </label>
            {lead ? (
              <div className="space-y-1.5">
                <span className="text-sm">Stat stages</span>
                <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                  {boostIdsFor(setup.gen).map((b) => {
                    const v = mon.boosts[b] ?? 0;
                    return (
                      <label key={b} className="space-y-0.5 text-center">
                        <span className="hud-label block">{setup.gen === 1 && b === "spa" ? "Spc" : BOOST_NAMES[b]}</span>
                        <select
                          aria-label={`Starting ${BOOST_NAMES[b]} stage`}
                          value={v}
                          onChange={(e) => {
                            const boosts = { ...mon.boosts, [b]: Number(e.target.value) };
                            if (!boosts[b]) delete boosts[b];
                            setMon({ boosts });
                          }}
                          className={cn(inputClass, "h-8 px-0.5 text-center font-mono text-xs", v > 0 && "text-success", v < 0 && "text-destructive")}
                        >
                          {STAGES.map((n) => (
                            <option key={n} value={n}>
                              {n > 0 ? `+${n}` : n}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Stat stages only stick to the Pokémon that start in battle ({leads === 1 ? "the lead" : "the two leads"}).</p>
            )}
            <p className="text-xs text-muted-foreground">Set once the leads are out (so Intimidate and weather abilities have already happened).</p>
          </fieldset>

          {/* Script */}
          {data.strategy === "scripted" ? (
            <fieldset className="min-w-0 space-y-2 rounded-lg border bg-shade/20 p-3">
              <legend className="hud-label px-1">Its moves, in order</legend>
              {mon.script.length ? (
                <ol className="flex flex-wrap items-center gap-1.5" aria-label="Move order">
                  {mon.script.map((m, i) => (
                    <li key={`${m}-${i}`} className="inline-flex items-center gap-1 rounded-md border border-screen/40 bg-screen/10 py-0.5 pl-2 pr-0.5 text-sm">
                      <span className="font-mono text-[10px] text-muted-foreground">{i + 1}</span> {m}
                      <button type="button" aria-label={`Remove ${m} from the order`} onClick={() => setMon({ script: mon.script.filter((_, j) => j !== i) })} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
                        <X className="h-3 w-3" aria-hidden />
                      </button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">No list: it uses its first move every turn.</p>
              )}
              <div className="flex flex-wrap gap-1.5">
                {mon.set.moves.filter(Boolean).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMon({ script: [...mon.script, m].slice(0, 8) })}
                    disabled={mon.script.length >= 8}
                    className="inline-flex items-center gap-1 rounded-md border border-foreground/10 bg-shade/30 px-2 py-1 text-xs font-semibold text-muted-foreground hover:border-screen/50 hover:text-foreground disabled:opacity-40"
                  >
                    <Plus className="h-3 w-3" aria-hidden /> {m}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                One move means always that move. After the last, it {data.loop ? "starts the list over" : "repeats the last move"}; a move it can&apos;t use (no PP, disabled) is skipped
                for the next one it can.
              </p>
            </fieldset>
          ) : (
            <div className="min-w-0 space-y-1 rounded-lg border border-dashed border-foreground/15 p-3 text-sm text-muted-foreground">
              <p className="hud-label">Its moves</p>
              <p>
                {SIDE_NAMES[side]} plays <strong className="text-foreground">{data.strategy === "smart" ? "Smart" : data.strategy === "greedy" ? "Greedy" : "Random"}</strong>, so the strategy picks each move. Switch
                the side to Scripted to set a fixed order.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
