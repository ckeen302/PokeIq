import { emptySide } from "@/lib/battle/lab/setup";
import {
  EMPTY_SIDE_FIELD,
  isLabGen,
  LAB_STATUSES,
  LAB_TERRAINS,
  LAB_WEATHERS,
  type BoostId,
  type LabMon,
  type LabMonProgress,
  type LabSetup,
  type LabSide,
  type LabStatus,
  type LabTerrain,
  type LabWeather,
} from "@/lib/battle/lab/types";
import type { AssumedSet } from "./assume";
import type { MonState, SideState, TurnState } from "./parse";

/**
 * A turn's state as a Battle Lab setup: each side's Pokémon still standing
 * (the ones in battle first, in position order: a, then b in a double
 * battle), at their HP, status and stat stages, holding what they hold at
 * that point, the hazards, screens and Tailwind with the turns they have
 * left, the weather, terrain and Trick Room, who has Terastallized, and
 * what a spectator can see on each Pokémon in battle (it has already used
 * Fake Out's one chance, a Choice lock, a Protect streak, a Substitute,
 * how long it has slept or been badly poisoned), both sides playing the
 * Smart strategy. Pokémon that never appeared in the battle can't be
 * included.
 */

const BOOSTS: BoostId[] = ["atk", "def", "spa", "spd", "spe", "accuracy", "evasion"];
/** Weather or terrain whose turns left aren't known: assume the usual five. */
const USUAL_TURNS = 5;

const CHOICE = /^choice (band|specs|scarf)$/i;
const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

function progressOf(mon: MonState, item: string): LabMonProgress | undefined {
  const out: LabMonProgress = {};
  if (mon.moved) out.moved = true;
  if (mon.moved && mon.lastMove && CHOICE.test(item)) out.choiceLock = toId(mon.lastMove);
  if (mon.protectStreak) out.protectStreak = mon.protectStreak;
  if (mon.volatiles?.includes("substitute")) out.substitute = true;
  if (mon.status === "slp" && mon.sleepTurns) out.sleepTurns = mon.sleepTurns;
  if (mon.status === "tox" && mon.toxicTurns) out.toxicTurns = mon.toxicTurns;
  return Object.keys(out).length ? out : undefined;
}

function labMonFor(mon: MonState, assumed: AssumedSet | undefined, active: boolean): LabMon | null {
  if (!assumed) return null;
  const set = { ...assumed.set, item: mon.item === null ? assumed.set.item : mon.item };
  if (mon.terastallized) set.teraType = mon.terastallized;
  const boosts: LabMon["boosts"] = {};
  if (active) for (const b of BOOSTS) if (mon.boosts[b]) boosts[b] = Math.max(-6, Math.min(6, mon.boosts[b]));
  const status = (LAB_STATUSES as readonly string[]).includes(mon.status) ? (mon.status as LabStatus) : "";
  const out: LabMon = { set, script: [], hp: Math.max(1, Math.min(100, mon.hp)), status, boosts, terastallized: !!mon.terastallized };
  const progress = progressOf(active ? mon : { ...mon, moved: false, lastMove: "", protectStreak: 0, volatiles: [] }, set.item);
  if (progress) out.progress = progress;
  return out;
}

/** A Pokémon that hasn't come out yet at this turn but does later: full HP, nothing known about its item yet. */
const fresh = (key: string, species: string, level: number): MonState => ({ key, species, level, hp: 100, fainted: false, status: "", boosts: {}, terastallized: "", item: null });

function sideFor(side: SideState, sets: Map<string, AssumedSet>, later: string[], positions: number): LabSide | null {
  const active = side.active.slice(0, positions).filter((k): k is string => !!k);
  const seen = new Set(side.team.map((m) => m.key));
  const laterMons = later.filter((k) => !seen.has(k) && sets.has(k)).map((k) => fresh(k, sets.get(k)!.set.species, sets.get(k)!.set.level));
  const alive = [...side.team, ...laterMons].filter((m) => !m.fainted);
  // The Pokémon in battle lead, in position order; the rest follow in the order they appeared.
  const rank = (m: MonState) => (active.includes(m.key) ? active.indexOf(m.key) : positions);
  alive.sort((a, b) => rank(a) - rank(b));
  const team = alive.map((m) => labMonFor(m, sets.get(m.key), active.includes(m.key))).filter((m): m is LabMon => !!m);
  if (!team.length) return null;
  const c = side.conditions;
  const turns = side.conditionTurns ?? {};
  const screenTurns: LabSide["screenTurns"] = {};
  for (const id of ["reflect", "lightscreen", "auroraveil"] as const) if (c[id] && turns[id]) screenTurns[id] = turns[id];
  return {
    ...emptySide(),
    team,
    strategy: "smart",
    field: {
      ...EMPTY_SIDE_FIELD,
      stealthrock: !!c.stealthrock,
      spikes: Math.min(3, c.spikes ?? 0),
      toxicspikes: Math.min(2, c.toxicspikes ?? 0),
      stickyweb: !!c.stickyweb,
      reflect: !!c.reflect,
      lightscreen: !!c.lightscreen,
      auroraveil: !!c.auroraveil,
    },
    teraUsed: side.teraUsed,
    ...(c.tailwind ? { tailwind: turns.tailwind || TAILWIND_TURNS } : {}),
    ...(Object.keys(screenTurns).length ? { screenTurns } : {}),
  };
}

/** Tailwind whose turns left aren't known: the most it lasts. */
const TAILWIND_TURNS = 4;

/**
 * The setup for turn `state`; null if a side has no Pokémon to play with
 * (or the generation isn't one the Lab runs). `keys` lists every Pokémon
 * each side showed over the whole battle: those yet to come out join at
 * full HP.
 */
export function turnSetup(state: TurnState, gen: number, sets: Map<string, AssumedSet>, keys: [string[], string[]], doubles = state.sides[0].active.length === 2): LabSetup | null {
  if (!isLabGen(gen)) return null;
  const positions = doubles ? 2 : 1;
  const a = sideFor(state.sides[0], sets, keys[0], positions);
  const b = sideFor(state.sides[1], sets, keys[1], positions);
  if (!a || !b) return null;
  const weather = (LAB_WEATHERS as readonly string[]).includes(state.weather) ? (state.weather as LabWeather) : "";
  const terrain = (LAB_TERRAINS as readonly string[]).includes(state.terrain) ? (state.terrain as LabTerrain) : "";
  return {
    gen,
    doubles,
    sides: [a, b],
    weather,
    weatherTurns: weather ? state.weatherTurns || USUAL_TURNS : 0,
    terrain,
    terrainTurns: terrain ? state.terrainTurns || USUAL_TURNS : 0,
    inProgress: true,
    ...(state.trickRoom ? { trickRoom: state.trickRoom } : {}),
  };
}

/** Pokémon a side brought that never appeared in the whole battle, so the simulations leave them out. */
export const neverSeen = (size: number, shown: number) => Math.max(0, size - shown);
