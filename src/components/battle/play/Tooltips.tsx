"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Generations } from "@pkmn/data";
import { Dex } from "@pkmn/dex";
import type { BattleRequestPokemon } from "@/lib/battle/play";
import type { CalcModule } from "@/lib/battle/calc";
import { loadCalcGenerations } from "@/lib/battle/dex";
import { calcStat, moveDamage, statRange, type FieldMon, type FieldState, type RandSetsInfo } from "@/lib/battle/tooltip-calc";
import { typeColor, typeTextColor } from "@/lib/pokemon/type-colors";
import { cn } from "@/lib/utils";
import type { MonSnap } from "./model";
import type { MoveInfo } from "./moves";
import { STATUS_STYLE } from "./Hud";

/**
 * Showdown-style tooltips for the battle screen (desktop: hover or focus).
 * Moves: type, category, power, accuracy, PP, priority, what it does, and
 * its damage range against each Pokémon you can see, from the Smogon
 * calculator on this battle's generation and field. Pokémon: types, HP,
 * status, boosts, ability and item (or what they could be), stats (exact for
 * yours, the possible range for a foe's) and the moves you've seen.
 */

// ---------------------------------------------------------------------------
// The tooltip itself
// ---------------------------------------------------------------------------

/** Wraps `children`; on hover or focus shows `content()` beside it (rendered only while open). */
export function Tip({ content, children, className, place = "top" }: { content: () => React.ReactNode; children: React.ReactNode; className?: string; place?: "top" | "bottom" }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  // The wrapper has no box of its own (display: contents): measure what it wraps.
  const show = () => {
    const el = anchor.current?.firstElementChild ?? anchor.current;
    if (el) setRect(el.getBoundingClientRect());
  };
  const hide = () => setRect(null);
  return (
    <span ref={anchor} className={cn("contents", className)} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {rect && typeof document !== "undefined" && createPortal(<Floating rect={rect} place={place}>{content()}</Floating>, document.body)}
    </span>
  );
}

function Floating({ rect, place, children }: { rect: DOMRect; place: "top" | "bottom"; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, rect.left + rect.width / 2 - w / 2));
    const above = rect.top - h - 8;
    const below = rect.bottom + 8;
    const top = place === "top" ? (above >= 8 ? above : below) : below + h <= window.innerHeight - 8 ? below : Math.max(8, above);
    setPos({ left, top });
  }, [rect, place]);
  return (
    <div
      ref={box}
      role="tooltip"
      className="pointer-events-none fixed z-[100] w-80 max-w-[calc(100vw-16px)] rounded-lg border border-white/15 bg-[hsl(250_40%_9%/0.97)] p-3 text-left text-xs leading-relaxed text-white/90 shadow-2xl backdrop-blur"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      data-testid="battle-tooltip"
    >
      {children}
    </div>
  );
}

/**
 * Touch screens have no hover: a tap toggles the tooltip instead, and a tap
 * anywhere else closes it (Showdown's long-press, made a plain tap).
 */
export function TapTip({ content, children, place = "top" }: { content: () => React.ReactNode; children: React.ReactNode; place?: "top" | "bottom" }) {
  const anchor = useRef<HTMLButtonElement>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    if (!rect) return;
    const close = (e: Event) => {
      if (!anchor.current?.contains(e.target as Node)) setRect(null);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("scroll", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("scroll", close);
    };
  }, [rect]);
  return (
    <button
      ref={anchor}
      type="button"
      className="block w-full text-left"
      aria-expanded={!!rect}
      onClick={() => setRect((r) => (r ? null : (anchor.current?.getBoundingClientRect() ?? null)))}
      data-testid="tap-tip"
    >
      {children}
      {rect && typeof document !== "undefined" && createPortal(<Floating rect={rect} place={place}>{content()}</Floating>, document.body)}
    </button>
  );
}

/** A field or side condition: what it does (the move or ability's own description) and how long it has left. */
export function ConditionTip({ id, name, turns, level, gen = 9 }: { id: string; name: string; turns?: [number, number]; level?: number; gen?: number }) {
  const dex = Dex.forGen(Math.min(9, Math.max(1, gen)));
  const source = dex.moves.get(id);
  const ability = source.exists ? null : dex.abilities.get(id);
  const desc = source.exists ? source.shortDesc || source.desc : ability?.exists ? ability.shortDesc || ability.desc : "";
  return (
    <div className="space-y-1.5" data-testid="condition-tooltip">
      <p className="font-display text-sm font-bold uppercase tracking-wide text-white">
        {name}
        {level && level > 1 ? <span className="ml-1 text-white/70">×{level}</span> : null}
      </p>
      {desc && <p className="text-white/80">{desc}</p>}
      {turns ? (
        <p className="font-pixel text-[10px] uppercase text-warning">
          {turns[0] === turns[1] ? turns[0] : `${turns[0]} to ${turns[1]}`} turn{turns[1] === 1 ? "" : "s"} left
        </p>
      ) : null}
    </div>
  );
}

function TypeBadge({ type }: { type: string }) {
  return (
    <span className="rounded-sm px-1.5 py-0.5 font-pixel text-[9px] uppercase" style={{ background: typeColor(type.toLowerCase()), color: typeTextColor(type.toLowerCase()) }}>
      {type}
    </span>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-16 shrink-0 font-pixel text-[9px] uppercase text-white/50">{label}</span>
      <span className="min-w-0 flex-1">{children}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data, loaded on the first tooltip that needs it
// ---------------------------------------------------------------------------

let calcLoad: Promise<{ lib: CalcModule; gens: Generations }> | null = null;

/** The damage calculator and its data, once loaded (it loads with the first move tooltip). */
function useCalc() {
  const [calc, setCalc] = useState<{ lib: CalcModule; gens: Generations } | null>(null);
  useEffect(() => {
    let live = true;
    calcLoad ??= Promise.all([import("@smogon/calc/dist/adaptable"), loadCalcGenerations()]).then(([lib, gens]) => ({ lib, gens }));
    calcLoad.then(
      (c) => live && setCalc(c),
      () => (calcLoad = null)
    );
    return () => {
      live = false;
    };
  }, []);
  return calc;
}

const randSets = new Map<string, Promise<RandSetsInfo | null>>();

/** A random battle's possible abilities, items and moves for a species (null in other formats). */
function useRandSets(format: string, species: string): RandSetsInfo | null {
  const [info, setInfo] = useState<RandSetsInfo | null>(null);
  useEffect(() => {
    if (format !== "gen9randombattle" && format !== "gen9randomdoublesbattle") return;
    const key = `${format}:${species}`;
    let p = randSets.get(key);
    if (!p) {
      p = fetch(`/api/battle/randsets?format=${format}&species=${encodeURIComponent(species)}`)
        .then((r) => (r.ok ? (r.json() as Promise<RandSetsInfo>) : null))
        .catch(() => null);
      randSets.set(key, p);
    }
    let live = true;
    void p.then((i) => live && setInfo(i));
    return () => {
      live = false;
    };
  }, [format, species]);
  return info;
}

export const isRandomFormat = (format: string) => format === "gen9randombattle" || format === "gen9randomdoublesbattle" || format === "factory" || format === "bssfactory";

// ---------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------

const CATEGORY: Record<string, string> = { Physical: "✸ Physical", Special: "◎ Special", Status: "◇ Status" };

export interface MoveTipProps {
  info: MoveInfo;
  /** The move's type as it will be used (Tera Blast takes the Tera type). */
  type: string;
  pp?: number;
  maxpp?: number;
  gen: number;
  attacker: FieldMon | null;
  foes: (MonSnap | null)[];
  field: FieldState;
  randomBattle: boolean;
}

/** A foe on the field, as the calculator should see it (only what's been revealed). */
export function foeFieldMon(mon: MonSnap): FieldMon {
  return {
    species: mon.species,
    level: mon.level,
    hpPercent: mon.maxhp ? (mon.hp / mon.maxhp) * 100 : 100,
    boosts: mon.boosts,
    status: mon.status,
    item: mon.item || undefined,
    ability: mon.ability || undefined,
    teraType: mon.terastallized,
    terastallized: !!mon.terastallized,
  };
}

export function MoveTip({ info, type, pp, maxpp, gen, attacker, foes, field, randomBattle }: MoveTipProps) {
  const calc = useCalc();
  const damaging = info.category !== "Status";
  const targets = foes.filter((f): f is MonSnap => !!f && !f.fainted);
  return (
    <div className="space-y-2" data-testid="move-tooltip">
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-sm font-bold uppercase tracking-wide text-white">{info.name}</span>
        <TypeBadge type={type} />
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-pixel text-[10px] uppercase text-white/80">
        <span>{CATEGORY[info.category]}</span>
        <span>Power {info.power > 0 ? info.power : "—"}</span>
        <span>Accuracy {info.accuracy === true ? "—" : `${info.accuracy}%`}</span>
        <span>
          PP {pp ?? "–"}/{maxpp ?? "–"}
        </span>
        {info.priority !== 0 && <span className="text-warning">Priority {info.priority > 0 ? `+${info.priority}` : info.priority}</span>}
        {info.contact && <span>Contact</span>}
      </div>
      {info.desc && <p className="text-white/80">{info.desc}</p>}
      {damaging && attacker && targets.length > 0 && (
        <div className="space-y-1.5 border-t border-white/10 pt-2" data-testid="move-damage">
          {!calc ? (
            <p className="text-white/50">Working out the damage…</p>
          ) : (
            targets.map((foe) => {
              let line = null;
              try {
                line = moveDamage({ gen: calc.gens.get(gen), lib: calc.lib }, info.name, attacker, foeFieldMon(foe), field, randomBattle);
              } catch {
                line = null;
              }
              if (!line) return null;
              return (
                <div key={foe.key}>
                  <p className="font-semibold text-white">
                    vs {foe.name}:{" "}
                    <span className="tabular-nums text-screen" data-testid="damage-range">
                      {line.percent[0]}–{line.percent[1]}%
                    </span>
                    {line.ko && <span className="text-white/70"> · {line.ko}</span>}
                  </p>
                  <p className="text-[10px] text-white/50">{line.desc}</p>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pokémon
// ---------------------------------------------------------------------------

/** What a Pokémon tooltip shows, from the field (MonSnap) and, for yours, the request. */
export interface TipMon {
  name: string;
  species: string;
  level: number;
  hp: number;
  maxhp: number;
  status: string;
  fainted: boolean;
  boosts: Record<string, number>;
  volatiles: string[];
  item: string;
  ability: string;
  moves: string[];
  types?: string[];
  teraType?: string;
  terastallized?: string;
  /** Yours: the exact stats. */
  stats?: Record<"atk" | "def" | "spa" | "spd" | "spe", number>;
}

const levelOf = (details: string) => Number(/, L(\d+)/.exec(details)?.[1] ?? 100);

/** Your Pokémon from its request entry (exact HP, stats, item, ability and moves), with what the field shows. */
export function tipFromRequest(p: BattleRequestPokemon, seen?: MonSnap): TipMon {
  const [hpText, statusText] = p.condition.split(" ");
  const [hp, maxhp] = hpText.split("/").map(Number);
  const fainted = statusText === "fnt" || hp === 0;
  return {
    name: p.ident.split(": ")[1] ?? p.details.split(",")[0],
    species: p.details.split(",")[0],
    level: levelOf(p.details),
    hp: fainted ? 0 : hp || 0,
    maxhp: maxhp || hp || 0,
    status: fainted ? "" : (statusText ?? ""),
    fainted,
    boosts: seen?.boosts ?? {},
    volatiles: seen?.volatiles ?? [],
    item: p.item ? Dex.items.get(p.item).name : "",
    ability: Dex.abilities.get(p.ability || p.baseAbility).name,
    moves: p.moves.map((m) => Dex.moves.get(m).name),
    types: seen?.types,
    teraType: p.teraType,
    terastallized: p.terastallized || seen?.terastallized,
    stats: p.stats,
  };
}

export const tipFromSnap = (m: MonSnap): TipMon => ({ ...m, types: m.types });

const STAT_NAME: Record<string, string> = { atk: "Atk", def: "Def", spa: "SpA", spd: "SpD", spe: "Spe", accuracy: "Acc", evasion: "Eva" };
const boostMult = (stage: number) => (stage >= 0 ? (2 + stage) / 2 : 2 / (2 - stage));

export function MonTip({ mon, mine, gen, format }: { mon: TipMon; mine: boolean; gen: number; format: string }) {
  const dex = Dex.forGen(Math.min(9, Math.max(1, gen)));
  const species = dex.species.get(mon.species);
  const rand = useRandSets(format, species.exists ? species.name : mon.species);
  const types = mon.terastallized ? [mon.terastallized] : mon.types?.length ? mon.types : species.types;
  const percent = mon.maxhp ? Math.round((mon.hp / mon.maxhp) * 100) : 0;
  const abilities = species.exists ? Object.values(species.abilities).filter(Boolean) : [];
  const possibleAbilities = rand?.abilities.length ? rand.abilities : abilities;
  const boosts = Object.entries(mon.boosts).filter(([, v]) => v);
  const status = STATUS_STYLE[mon.status];
  const randomLevel = isRandomFormat(format);
  const shownMoves = mon.moves.filter(Boolean);
  const otherMoves = !mine && rand ? rand.moves.filter((m) => !shownMoves.includes(m)) : [];
  return (
    <div className="space-y-2" data-testid="mon-tooltip">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-display text-sm font-bold uppercase tracking-wide text-white">
          {mon.name}
          {mon.name !== mon.species && <span className="ml-1 text-[11px] font-normal normal-case text-white/60">({mon.species})</span>}
        </span>
        <span className="font-pixel text-[10px] text-white/70">Lv{mon.level}</span>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {types.map((t) => (
          <TypeBadge key={t} type={t} />
        ))}
        {mon.terastallized && <span className="font-pixel text-[9px] uppercase text-white/60">Terastallized</span>}
        {mine && mon.teraType && !mon.terastallized && <span className="font-pixel text-[9px] uppercase text-white/60">Tera {mon.teraType}</span>}
        {status && <span className={cn("rounded-sm px-1 font-pixel text-[9px] leading-4", status.className)}>{status.label}</span>}
      </div>
      <Row label="HP">{mon.fainted ? "Fainted" : mine ? `${mon.hp}/${mon.maxhp} (${percent}%)` : `${percent}%`}</Row>
      <Row label="Ability">{mon.ability ? mon.ability : possibleAbilities.length ? <span className="text-white/70">Possible: {possibleAbilities.join(", ")}</span> : "Unknown"}</Row>
      <Row label="Item">
        {mon.item ? mon.item : !mine && rand?.items.length ? <span className="text-white/70">Possible: {rand.items.join(", ")}</span> : mine ? "None" : "Unknown"}
      </Row>
      {(boosts.length > 0 || mon.volatiles.length > 0) && (
        <Row label="Effects">
          {[...boosts.map(([s, v]) => `${STAT_NAME[s] ?? s} ${v > 0 ? "+" : ""}${v} (×${boostMult(v).toFixed(2).replace(/\.?0+$/, "")})`), ...mon.volatiles].join(" · ")}
        </Row>
      )}
      {species.exists && (
        <Row label={mine ? "Stats" : randomLevel ? "Stats (likely)" : "Stat range"}>
          <span className="grid grid-cols-3 gap-x-2 font-pixel text-[9px] tabular-nums">
            {(["atk", "def", "spa", "spd", "spe"] as const).map((s) => {
              const base = species.baseStats[s];
              // Random battles give every Pokémon 84 EVs and 31 IVs in each stat, with a neutral nature.
              const text = mine && mon.stats ? `${mon.stats[s]}` : randomLevel ? `${calcStat(s, base, mon.level, 31, 84)}` : statRange(s, base, mon.level).join("–");
              return (
                <span key={s}>
                  {STAT_NAME[s]} {text}
                </span>
              );
            })}
          </span>
        </Row>
      )}
      {(shownMoves.length > 0 || otherMoves.length > 0) && (
        <Row label="Moves">
          {shownMoves.length > 0 && <span className="block">{shownMoves.join(", ")}</span>}
          {otherMoves.length > 0 && <span className="block text-white/60">Possible: {otherMoves.join(", ")}</span>}
        </Row>
      )}
    </div>
  );
}
