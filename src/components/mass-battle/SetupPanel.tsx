"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Layers, Plus, Settings2, Swords, Trash2, Trophy } from "lucide-react";
import {
  ARENAS, ARENA_LABEL, CAMERA_LABEL, CAMERA_MODES, FORMATIONS, FORMATION_LABEL, LEVELS, SPACINGS, SPACING_LABEL, SPEEDS, SPREAD_LABEL, SPREAD_USES, STANCES, STANCE_LABEL, TARGETINGS, TARGETING_LABEL,
  TERRAINS, TERRAIN_LABEL, TIMES, TIME_LABEL, TYPE_NAMES, WEATHERS, WEATHER_LABEL,
  type ArenaId, type BattleSpec, type CameraMode, type GroupRule, type MBSpecies, type PlaybackSpec, type Question, type Roster, type Terrain, type TimeOfDay, type Weather,
} from "@/lib/mass-battle/types";
import { MAX_SIDE, MAX_SPECIES, RUN_CHOICES, newSeed } from "@/lib/mass-battle/share";
import { clampLevel, groupDetail, groupLabel, groupMembers, type GroupFacts } from "@/lib/mass-battle/sets";
import { defaultSetup, fromBattle, fromQuestion, rowKey, toBattle, toQuestion, type RowState, type SetupState, type SideState } from "@/lib/mass-battle/setup";
import { fmt, groupName, questionText } from "@/lib/mass-battle/copy";
import { HudHeading } from "@/components/game/HudHeading";
import { buttonVariants } from "@/components/ui/button";
import { PokemonPicker, type PickerMon } from "./PokemonPicker";
import { SetEditor } from "./SetEditor";
import { getLearnsets, getRoster } from "./roster-client";
import type { BattleDesc, PresetCard } from "./MassBattleExperience";
import { cn } from "@/lib/utils";

/** A picker row's group facts. */
export const factsOfRow = (p: PickerMon): GroupFacts => ({ id: p.id, form: p.form, types: p.types, gen: p.gen, legendary: p.rank === "L", mythical: p.rank === "M", fullyEvolved: p.fe, attacks: p.attacks });

const label = "font-pixel text-[9px] uppercase tracking-[0.18em] text-muted-foreground";
const select = "mt-1 h-11 w-full min-w-0 rounded-lg border bg-card px-2 font-display text-sm font-semibold uppercase tracking-wide";
const small = "mt-1 h-10 w-full min-w-0 rounded-md border bg-card px-2 text-sm";

/**
 * The Battle setup panel. Simple by default: "How many X beat Y?" (the
 * solver) or an army against an army (up to four rows a side: a species or
 * form with a count, or a whole group by type, generation, legendaries or
 * mythicals, fully evolved, a type pair), the level and the arena. The
 * Advanced section adds each species' set (level, moves, ability, item,
 * nature, EVs and IVs, Tera), the field (weather, terrain, time of day,
 * held items), how each side fights (formation, spacing, targeting,
 * charging or holding the line, spread moves), the solver's settings and
 * how the battle is shown. Everything here is in the share link; a preset
 * or a link fills the panel in.
 */
export function SetupPanel({ list, presets, busy, current, playback, onPlayback, onAsk, onFight, onPreset }: {
  list: PickerMon[];
  presets: PresetCard[];
  busy: boolean;
  current: BattleDesc | null;
  playback: PlaybackSpec;
  onPlayback(p: PlaybackSpec): void;
  onAsk(q: Question): void;
  onFight(spec: BattleSpec): void;
  onPreset(p: PresetCard): void;
}) {
  const bySlug = useMemo(() => new Map(list.map((p) => [p.slug, p.id])), [list]);
  const byId = useMemo(() => new Map(list.map((p) => [p.id, p])), [list]);
  const facts = useMemo(() => list.map(factsOfRow), [list]);
  const idOf = (slug: string) => bySlug.get(slug) ?? list[0]?.id ?? 1;
  const [s, setS] = useState<SetupState>(() => defaultSetup(idOf));
  const [advanced, setAdvanced] = useState(false);
  const [openSet, setOpenSet] = useState<string | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [learnsets, setLearnsets] = useState<Record<number, number[]> | null>(null);
  const species = useMemo(() => (roster ? new Map<number, MBSpecies>(roster.species.map((x) => [x.id, x])) : null), [roster]);

  // A preset, a link or a solved question fills the panel in.
  const source = current ? current.question ?? current.source ?? current.spec : null;
  useEffect(() => {
    if (!current) return;
    if (current.question) setS((cur) => fromQuestion(cur, current.question!));
    else setS((cur) => fromBattle(cur, current.source ?? current.spec));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // Sets need the roster (and, for their moves, the learnsets): loaded when first opened.
  useEffect(() => {
    if (!advanced || roster) return;
    let live = true;
    getRoster().then((r) => live && setRoster(r), () => undefined);
    return () => { live = false; };
  }, [advanced, roster]);
  useEffect(() => {
    if (!openSet || learnsets) return;
    let live = true;
    getLearnsets().then((l) => live && setLearnsets(l), () => undefined);
    return () => { live = false; };
  }, [openSet, learnsets]);

  const patch = (p: Partial<SetupState>) => setS((cur) => ({ ...cur, ...p }));
  /** Updates one side: "army", "boss", or an army-vs-army side. */
  type SideId = "army" | "boss" | 0 | 1;
  const getSide = (st: SetupState, id: SideId): SideState => (id === "army" ? st.army : id === "boss" ? st.boss : st.sides[id]);
  const setSide = (id: SideId, fn: (sd: SideState) => SideState) =>
    setS((cur) => {
      if (id === "army") return { ...cur, army: fn(cur.army) };
      if (id === "boss") return { ...cur, boss: fn(cur.boss) };
      const sides = [...cur.sides] as [SideState, SideState];
      sides[id] = fn(sides[id]);
      return { ...cur, sides };
    });
  const setRow = (id: SideId, key: string, p: Partial<RowState>) => setSide(id, (sd) => ({ ...sd, rows: sd.rows.map((r) => (r.key === key ? { ...r, ...p } : r)) }));
  const removeRow = (id: SideId, key: string) => setSide(id, (sd) => ({ ...sd, rows: sd.rows.filter((r) => r.key !== key) }));
  const addRow = (id: SideId, row: Omit<RowState, "key">) => setSide(id, (sd) => (sd.rows.length >= MAX_SPECIES ? sd : { ...sd, rows: [...sd.rows, { ...row, key: rowKey() }] }));

  const nameOf = (id: number) => byId.get(id)?.name ?? "";
  const rowName = (r: RowState) => (r.group ? groupName(r.group) : nameOf(r.id));
  const members = (g: GroupRule) => groupMembers(facts, g).length;
  const rowUnits = (r: RowState) => (r.group ? r.count * members(r.group) : r.count);
  const total = (sd: SideState) => sd.rows.reduce((a, r) => a + rowUnits(r), 0);
  const names = (sd: SideState) => {
    const n = sd.rows.map(rowName);
    return n.length <= 1 ? n[0] ?? "" : n.length === 2 ? `${n[0]} and ${n[1]}` : `${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
  };
  const tabBtn = (on: boolean) => cn("flex-1 rounded-md px-3 py-2 font-display text-xs font-bold uppercase tracking-wider transition-colors sm:flex-none", on ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground");
  const askOk = s.army.rows.length > 0 && s.boss.rows.length > 0;
  const armyOk = s.sides.every((sd) => sd.rows.length > 0 && total(sd) <= MAX_SIDE) && s.sides.every((sd) => sd.rows.every((r) => !r.group || members(r.group) > 0));

  /** One row: its Pokémon (or group), its count, its set, remove. */
  const renderRow = ({ sideId, r, k, counts, removable }: { sideId: SideId; r: RowState; k: number; counts: boolean; removable: boolean }) => {
    const tid = `mb-side-${typeof sideId === "number" ? sideId : sideId}-${k}`;
    const max = r.group ? Math.max(1, Math.floor(MAX_SIDE / Math.max(1, members(r.group)))) : MAX_SIDE;
    const setOpen = openSet === r.key;
    return (
      <div key={r.key} className="space-y-2" data-testid={`${tid}-row`}>
        <div className={cn("grid items-end gap-2", counts ? "grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[minmax(0,1fr)_5.5rem_auto]" : "grid-cols-[minmax(0,1fr)_auto]")}>
          {r.group ? (
            <div className={cn("min-w-0", counts && "col-span-2 sm:col-span-1")}>
              <span className={label}>Group</span>
              <div className="mt-1 flex h-12 items-center gap-2 rounded-lg border bg-card px-3" data-testid={`${tid}-group`} title={groupLabel(r.group)}>
                <Layers className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-display text-sm font-bold uppercase leading-tight tracking-wide">{groupName(r.group)}</span>
                  <span className="block truncate text-[11px] leading-tight text-muted-foreground">{groupDetail(r.group)} · {members(r.group)} Pokémon</span>
                </span>
              </div>
            </div>
          ) : counts ? (
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <PokemonPicker label={sideId === "boss" ? "…beat" : `Pokémon ${k + 1}`} value={r.id} list={list} onChange={(id) => setRow(sideId, r.key, { id, set: undefined })} testId={typeof sideId === "number" ? `mb-side-${sideId}-pick-${k}` : sideId === "boss" ? "mb-pick-boss" : `mb-pick-army-${k}`} disabled={busy} />
            </div>
          ) : (
            <PokemonPicker label={sideId === "boss" ? "…beat" : k === 0 && sideId === "army" ? "How many…" : `Pokémon ${k + 1}`} value={r.id} list={list} onChange={(id) => setRow(sideId, r.key, { id, set: undefined })} testId={sideId === "army" ? (k === 0 ? "mb-pick-challenger" : `mb-pick-army-${k}`) : sideId === "boss" ? "mb-pick-boss" : `mb-side-${sideId}-pick-${k}`} disabled={busy} />
          )}
          {counts && (
            <div>
              <label className={label} htmlFor={`${tid}-count`}>{r.group ? "Each" : "Count"}</label>
              <input
                id={`${tid}-count`}
                type="number"
                inputMode="numeric"
                min={1}
                max={max}
                value={r.count}
                onChange={(e) => setRow(sideId, r.key, { count: Math.max(1, Math.min(max, Math.floor(Number(e.target.value) || 1))) })}
                className="mt-1 h-12 w-full rounded-lg border bg-card px-2 font-display text-base font-bold tabular-nums"
                data-testid={typeof sideId === "number" ? `mb-side-${sideId}-count-${k}` : `${tid}-count`}
              />
            </div>
          )}
          <div className="mb-0.5 flex gap-1">
            {advanced && (
              <button type="button" onClick={() => setOpenSet(setOpen ? null : r.key)} aria-expanded={setOpen} aria-label={`${rowName(r)}'s set`} className={cn("h-11 rounded-lg border px-2 text-muted-foreground hover:text-foreground", setOpen && "border-primary text-primary", r.set && "text-primary")} data-testid={`${tid}-set-toggle`}>
                <Settings2 className="h-4 w-4" />
              </button>
            )}
            {removable && (
              <button type="button" aria-label={`Remove ${rowName(r)}`} disabled={busy} onClick={() => removeRow(sideId, r.key)} className="h-11 rounded-lg border px-2 text-muted-foreground hover:text-foreground disabled:opacity-30" data-testid={`${tid}-remove`}>
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
        {advanced && setOpen && (
          species ? (
            <SetEditor
              species={r.group ? null : species.get(r.id) ?? null}
              moves={roster!.moves}
              learnset={learnsets ? learnsets[r.id] ?? [] : null}
              level={s.level}
              items={s.items}
              value={r.set}
              onChange={(set) => setRow(sideId, r.key, { set })}
              group={!!r.group}
              idPrefix={tid}
            />
          ) : (
            <p className="text-xs text-muted-foreground">Loading the sets…</p>
          )
        )}
      </div>
    );
  };

  /** The rows of one side, with Add Pokémon and Add group. */
  const renderRows = ({ sideId, counts, min = 1 }: { sideId: SideId; counts: boolean; min?: number }) => {
    const sd = getSide(s, sideId);
    const full = sd.rows.length >= MAX_SPECIES;
    const key = String(sideId);
    return (
      <div className="space-y-3">
        {sd.rows.map((r, k) => renderRow({ sideId, r, k, counts, removable: sd.rows.length > min }))}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={full || busy} onClick={() => addRow(sideId, { id: idOf(sideId === 1 || sideId === "boss" ? "snorlax" : "pikachu"), count: counts ? (sideId === 1 ? 1 : 50) : 1 })} className={buttonVariants({ variant: "outline", size: "sm" })} data-testid={`mb-add-${key}`}>
            <Plus className="h-4 w-4" aria-hidden /> Pokémon
          </button>
          <button type="button" disabled={full || busy} onClick={() => setAdding(adding === key ? null : key)} aria-expanded={adding === key} className={buttonVariants({ variant: "outline", size: "sm" })} data-testid={`mb-add-group-${key}`}>
            <Layers className="h-4 w-4" aria-hidden /> Group
          </button>
          {full && <span className="self-center text-xs text-muted-foreground">Up to {MAX_SPECIES} rows</span>}
        </div>
        {adding === key && <GroupAdder facts={facts} counts={counts} onAdd={(g, count) => { addRow(sideId, { id: 0, count, group: g }); setAdding(null); }} testId={`mb-group-${key}`} />}
      </div>
    );
  };

  /** How a side fights (Advanced). */
  const renderBehaviour = ({ sideId, title }: { sideId: SideId; title: string }) => {
    const sd = getSide(s, sideId);
    const tid = `mb-beh-${String(sideId)}`;
    const set = (p: Partial<SideState>) => setSide(sideId, (x) => ({ ...x, ...p }));
    return (
      <fieldset className="space-y-2 rounded-lg border p-3" data-testid={tid}>
        <legend className="px-1 font-display text-xs font-bold uppercase tracking-wider">{title}</legend>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <div><label className={label} htmlFor={`${tid}-f`}>Formation</label><select id={`${tid}-f`} value={sd.formation} onChange={(e) => set({ formation: e.target.value as SideState["formation"] })} className={small} data-testid={`${tid}-formation`}>{FORMATIONS.map((f) => <option key={f} value={f}>{FORMATION_LABEL[f]}</option>)}</select></div>
          <div><label className={label} htmlFor={`${tid}-s`}>Spacing</label><select id={`${tid}-s`} value={sd.spacing} onChange={(e) => set({ spacing: e.target.value as SideState["spacing"] })} className={small} data-testid={`${tid}-spacing`}>{SPACINGS.map((f) => <option key={f} value={f}>{SPACING_LABEL[f]}</option>)}</select></div>
          <div><label className={label} htmlFor={`${tid}-t`}>Targets</label><select id={`${tid}-t`} value={sd.targeting} onChange={(e) => set({ targeting: e.target.value as SideState["targeting"] })} className={small} data-testid={`${tid}-targeting`}>{TARGETINGS.map((f) => <option key={f} value={f}>{TARGETING_LABEL[f]}</option>)}</select></div>
          <div><label className={label} htmlFor={`${tid}-st`}>Stance</label><select id={`${tid}-st`} value={sd.stance} onChange={(e) => set({ stance: e.target.value as SideState["stance"] })} className={small} data-testid={`${tid}-stance`}>{STANCES.map((f) => <option key={f} value={f}>{STANCE_LABEL[f]}</option>)}</select></div>
          <div><label className={label} htmlFor={`${tid}-sp`}>Spread moves</label><select id={`${tid}-sp`} value={sd.spread} onChange={(e) => set({ spread: e.target.value as SideState["spread"] })} className={small} data-testid={`${tid}-spread`}>{SPREAD_USES.map((f) => <option key={f} value={f}>{SPREAD_LABEL[f]}</option>)}</select></div>
        </div>
      </fieldset>
    );
  };

  const toggle = (on: boolean, onChange: (v: boolean) => void, text: string, testId: string) => (
    <button type="button" role="switch" aria-checked={on} onClick={() => onChange(!on)} className={cn("inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm transition-colors", on ? "border-primary/60 bg-primary/10 text-foreground" : "text-muted-foreground hover:text-foreground")} data-testid={testId}>
      <span className={cn("relative inline-block h-4 w-7 shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-muted-foreground/30")} aria-hidden>
        <span className={cn("absolute left-0 top-0.5 h-3 w-3 rounded-full bg-background transition-transform", on ? "translate-x-3.5" : "translate-x-0.5")} />
      </span>
      {text}
    </button>
  );

  return (
    <div className="space-y-8">
      <section className="space-y-5 rounded-xl border bg-card/60 p-4 sm:p-6" aria-labelledby="mb-setup" data-testid="mb-setup">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 id="mb-setup" className="font-display text-xl font-bold uppercase tracking-tight sm:text-2xl">Battle setup</h2>
          <div className="flex gap-1 rounded-lg border bg-background/60 p-1" role="tablist" aria-label="Kind of battle">
            <button type="button" role="tab" aria-selected={s.tab === "ask"} onClick={() => patch({ tab: "ask" })} className={tabBtn(s.tab === "ask")} data-testid="mb-tab-ask">How many?</button>
            <button type="button" role="tab" aria-selected={s.tab === "army"} onClick={() => patch({ tab: "army" })} className={tabBtn(s.tab === "army")} data-testid="mb-tab-army">Army vs army</button>
          </div>
        </div>

        {s.tab === "ask" ? (
          <div className="space-y-4" role="tabpanel">
            <p className="font-display text-lg font-bold uppercase tracking-tight sm:text-2xl" data-testid="mb-question">{questionText(names(s.army), names(s.boss))}</p>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                {renderRows({ sideId: "army", counts: false })}
                {s.army.rows.length > 1 && <p className="text-xs text-muted-foreground">The army is shared evenly between its rows (a group shares it between all its species).</p>}
              </div>
              <div className="space-y-2">
                {s.boss.rows.map((r, k) => renderRow({ sideId: "boss", r, k, counts: advanced, removable: false }))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4" role="tabpanel">
            <div className="grid gap-4 lg:grid-cols-2">
              {([0, 1] as const).map((sd) => (
                <div key={sd} className={cn("space-y-3 rounded-lg border p-3", sd === 0 ? "border-[#4f9bff]/40" : "border-[#ff5a64]/40")} data-testid={`mb-side-${sd}`}>
                  <div className="flex items-center justify-between">
                    <span className={cn("font-display text-sm font-bold uppercase tracking-wider", sd === 0 ? "text-[#4f9bff]" : "text-[#ff5a64]")}>{sd === 0 ? "Blue army" : "Red army"}</span>
                    <span className={cn("font-pixel text-[10px]", total(s.sides[sd]) > MAX_SIDE ? "text-destructive" : "text-muted-foreground")} data-testid={`mb-side-${sd}-total`}>{fmt(total(s.sides[sd]))} / {fmt(MAX_SIDE)}</span>
                  </div>
                  {renderRows({ sideId: sd, counts: true })}
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <div>
            <label className={label} htmlFor="mb-level">Level</label>
            <input id="mb-level" type="number" inputMode="numeric" min={1} max={100} list="mb-levels" value={s.level} onChange={(e) => patch({ level: clampLevel(Number(e.target.value) || 1) })} className={cn(select, "tabular-nums")} data-testid="mb-level" />
            <datalist id="mb-levels">{LEVELS.map((l) => <option key={l} value={l} />)}</datalist>
          </div>
          <div>
            <label className={label} htmlFor="mb-arena">Arena</label>
            <select id="mb-arena" value={s.arena} onChange={(e) => patch({ arena: e.target.value as ArenaId })} className={select} data-testid="mb-arena">
              {ARENAS.map((a) => <option key={a} value={a}>{ARENA_LABEL[a]}</option>)}
            </select>
          </div>
        </div>

        <div className="rounded-lg border">
          <button type="button" onClick={() => setAdvanced((a) => !a)} aria-expanded={advanced} className="flex w-full items-center justify-between gap-2 px-3 py-3 text-left" data-testid="mb-advanced">
            <span className="font-display text-sm font-bold uppercase tracking-wider">Advanced</span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="hidden sm:inline">Sets, weather and terrain, how each side fights{s.tab === "ask" ? ", the solver" : ""}, playback</span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", advanced && "rotate-180")} aria-hidden />
            </span>
          </button>
          {advanced && (
            <div className="space-y-5 border-t p-3 sm:p-4" data-testid="mb-advanced-panel">
              <p className="text-xs text-muted-foreground">Open a row&apos;s <Settings2 className="inline h-3 w-3" aria-label="set" /> for its set: level, moves, ability, item, nature, EVs and IVs, Tera type.</p>
              <fieldset className="space-y-2" data-testid="mb-field">
                <legend className="font-display text-xs font-bold uppercase tracking-wider">Field</legend>
                <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
                  <div><label className={label} htmlFor="mb-weather">Weather</label><select id="mb-weather" value={s.field.weather} onChange={(e) => patch({ field: { ...s.field, weather: e.target.value as Weather } })} className={small} data-testid="mb-weather">{WEATHERS.map((w) => <option key={w} value={w}>{WEATHER_LABEL[w]}</option>)}</select></div>
                  <div><label className={label} htmlFor="mb-terrain">Terrain</label><select id="mb-terrain" value={s.field.terrain} onChange={(e) => patch({ field: { ...s.field, terrain: e.target.value as Terrain } })} className={small} data-testid="mb-terrain">{TERRAINS.map((t) => <option key={t} value={t}>{TERRAIN_LABEL[t]}</option>)}</select></div>
                  <div><label className={label} htmlFor="mb-time">Time of day</label><select id="mb-time" value={s.field.time} onChange={(e) => patch({ field: { ...s.field, time: e.target.value as TimeOfDay } })} className={small} data-testid="mb-time">{TIMES.map((t) => <option key={t} value={t}>{TIME_LABEL[t]}</option>)}</select></div>
                  <div><label className={label} htmlFor="mb-items">Held items</label><select id="mb-items" value={s.items} onChange={(e) => patch({ items: e.target.value as SetupState["items"] })} className={small} data-testid="mb-items"><option value="none">None</option><option value="sets">Random-battle items</option></select></div>
                </div>
              </fieldset>
              <fieldset className="space-y-2" data-testid="mb-rules">
                <legend className="font-display text-xs font-bold uppercase tracking-wider">Rules</legend>
                <div className="flex flex-wrap gap-2">
                  {toggle(s.pp, (v) => patch({ pp: v }), "Real PP", "mb-pp")}
                  {toggle(s.friendlyFire, (v) => patch({ friendlyFire: v }), "Friendly fire", "mb-ff")}
                </div>
                <p className="text-xs text-muted-foreground">Real PP: moves run out as in the games (Pressure takes two), then Struggle. Friendly fire: Earthquake, Surf and Explosion hit partners too, and Lightning Rod and Storm Drain pull a partner&apos;s moves in.</p>
              </fieldset>
              {s.tab === "ask" ? (
                <div className="grid gap-3 lg:grid-cols-2">
                  {renderBehaviour({ sideId: "army", title: `The army (${names(s.army)})` })}
                  {renderBehaviour({ sideId: "boss", title: `The boss (${names(s.boss)})` })}
                </div>
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {renderBehaviour({ sideId: 0, title: "Blue army" })}
                  {renderBehaviour({ sideId: 1, title: "Red army" })}
                </div>
              )}
              {s.tab === "ask" && (
                <fieldset className="space-y-2" data-testid="mb-solver">
                  <legend className="font-display text-xs font-bold uppercase tracking-wider">The answer</legend>
                  <div className="grid grid-cols-2 gap-2 sm:max-w-md">
                    <div><label className={label} htmlFor="mb-threshold">Wins needed</label><select id="mb-threshold" value={s.threshold} onChange={(e) => patch({ threshold: Number(e.target.value) })} className={small} data-testid="mb-threshold"><option value={0.5}>Half (50%)</option><option value={0.9}>Nine in ten (90%)</option></select></div>
                    <div><label className={label} htmlFor="mb-runs">Battles per size</label><select id="mb-runs" value={s.runs} onChange={(e) => patch({ runs: Number(e.target.value) })} className={small} data-testid="mb-runs">{RUN_CHOICES.map((n) => <option key={n} value={n}>{n}</option>)}</select></div>
                  </div>
                </fieldset>
              )}
              <fieldset className="space-y-2" data-testid="mb-playback">
                <legend className="font-display text-xs font-bold uppercase tracking-wider">Playback</legend>
                <div className="grid grid-cols-2 gap-2 sm:max-w-md">
                  <div><label className={label} htmlFor="mb-speed-pick">Speed</label><select id="mb-speed-pick" value={playback.speed} onChange={(e) => onPlayback({ ...playback, speed: Number(e.target.value) })} className={small} data-testid="mb-speed-pick">{SPEEDS.map((x) => <option key={x} value={x}>{x}×</option>)}</select></div>
                  <div><label className={label} htmlFor="mb-camera-pick">Camera</label><select id="mb-camera-pick" value={playback.camera} onChange={(e) => onPlayback({ ...playback, camera: e.target.value as CameraMode })} className={small} data-testid="mb-camera-pick">{CAMERA_MODES.map((c) => <option key={c} value={c}>{CAMERA_LABEL[c]}</option>)}</select></div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {toggle(playback.slowmo, (v) => onPlayback({ ...playback, slowmo: v }), "Slow motion on big hits", "mb-slowmo")}
                  {toggle(playback.numbers, (v) => onPlayback({ ...playback, numbers: v }), "Damage numbers", "mb-numbers")}
                  {toggle(playback.hud, (v) => onPlayback({ ...playback, hud: v }), "HUD", "mb-hud-toggle")}
                </div>
              </fieldset>
            </div>
          )}
        </div>

        {s.tab === "ask" ? (
          <button type="button" disabled={busy || !askOk} onClick={() => onAsk(toQuestion(s))} className={buttonVariants({ size: "lg" })} data-testid="mb-ask">
            <Trophy className="h-4 w-4" aria-hidden /> Find out
          </button>
        ) : (
          <button type="button" disabled={busy || !armyOk} onClick={() => onFight(toBattle(s, newSeed()))} className={buttonVariants({ size: "lg" })} data-testid="mb-fight">
            <Swords className="h-4 w-4" aria-hidden /> Battle!
          </button>
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

/** Adds a whole group: by type (or a type pair), generation, legendaries or mythicals, fully evolved. */
function GroupAdder({ facts, counts, onAdd, testId }: { facts: GroupFacts[]; counts: boolean; onAdd(g: GroupRule, count: number): void; testId: string }) {
  const [t1, setT1] = useState("fire");
  const [t2, setT2] = useState("");
  const [gen, setGen] = useState(0);
  const [kind, setKind] = useState<"any" | "legendary" | "mythical" | "both" | "no">("no");
  const [fe, setFe] = useState(true);
  const [count, setCount] = useState(5);
  const rule = useMemo<GroupRule>(() => {
    const g: GroupRule = {};
    const types = [t1, t2].filter(Boolean);
    if (types.length) g.types = [...new Set(types)];
    if (gen) g.gen = gen;
    if (kind === "legendary") g.legendary = true;
    else if (kind === "mythical") g.mythical = true;
    else if (kind === "both") { g.legendary = true; g.mythical = true; }
    else if (kind === "no") g.legendary = "no";
    if (fe) g.fullyEvolved = true;
    return g;
  }, [t1, t2, gen, kind, fe]);
  const n = useMemo(() => groupMembers(facts, rule).length, [facts, rule]);
  const max = Math.max(1, Math.floor(MAX_SIDE / Math.max(1, n)));
  return (
    <div className="space-y-3 rounded-lg border border-dashed p-3" data-testid={testId}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <div><label className={label} htmlFor={`${testId}-t1`}>Type</label><select id={`${testId}-t1`} value={t1} onChange={(e) => setT1(e.target.value)} className={small} data-testid={`${testId}-type`}><option value="">Any type</option>{TYPE_NAMES.map((t) => <option key={t} value={t.toLowerCase()}>{t}</option>)}</select></div>
        <div><label className={label} htmlFor={`${testId}-t2`}>And type</label><select id={`${testId}-t2`} value={t2} onChange={(e) => setT2(e.target.value)} className={small} data-testid={`${testId}-type2`}><option value="">—</option>{TYPE_NAMES.map((t) => <option key={t} value={t.toLowerCase()}>{t}</option>)}</select></div>
        <div><label className={label} htmlFor={`${testId}-gen`}>Generation</label><select id={`${testId}-gen`} value={gen} onChange={(e) => setGen(Number(e.target.value))} className={small} data-testid={`${testId}-gen`}><option value={0}>Any</option>{Array.from({ length: 9 }, (_, k) => <option key={k} value={k + 1}>Gen {k + 1}</option>)}</select></div>
        <div><label className={label} htmlFor={`${testId}-kind`}>Legendaries</label><select id={`${testId}-kind`} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={small} data-testid={`${testId}-kind`}><option value="no">Leave them out</option><option value="any">Include them</option><option value="legendary">Only legendaries</option><option value="mythical">Only mythicals</option><option value="both">Legendaries and mythicals</option></select></div>
        <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" checked={fe} onChange={(e) => setFe(e.target.checked)} className="h-4 w-4" data-testid={`${testId}-fe`} /> Fully evolved only</label>
        {counts && (
          <div><label className={label} htmlFor={`${testId}-count`}>Each</label><input id={`${testId}-count`} type="number" inputMode="numeric" min={1} max={max} value={Math.min(count, max)} onChange={(e) => setCount(Math.max(1, Math.min(max, Math.floor(Number(e.target.value) || 1))))} className={cn(small, "tabular-nums")} data-testid={`${testId}-count`} /></div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground" data-testid={`${testId}-matches`}>{groupLabel(rule)}: <b className="text-foreground">{n}</b> Pokémon{counts && n ? `, ${fmt(n * Math.min(count, max))} in all` : ""}</span>
        <button type="button" disabled={!n} onClick={() => onAdd(rule, counts ? Math.min(count, max) : 1)} className={buttonVariants({ size: "sm" })} data-testid={`${testId}-add`}>
          <Plus className="h-4 w-4" aria-hidden /> Add the group
        </button>
      </div>
    </div>
  );
}
