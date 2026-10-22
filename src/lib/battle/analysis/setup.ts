import { emptySide } from "@/lib/battle/lab/setup";
import {
  EMPTY_SIDE_FIELD,
  isLabGen,
  LAB_STATUSES,
  LAB_TERRAINS,
  LAB_WEATHERS,
  type BoostId,
  type LabMon,
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
 * (the one in battle first), at their HP, status and stat stages, holding
 * what they hold at that point, the hazards and screens, the weather and
 * terrain, who has Terastallized, both sides playing the Smart strategy.
 * Pokémon that never appeared in the battle can't be included.
 */

const BOOSTS: BoostId[] = ["atk", "def", "spa", "spd", "spe", "accuracy", "evasion"];
/** Weather or terrain whose turns left aren't known: assume the usual five. */
const USUAL_TURNS = 5;

function labMonFor(mon: MonState, assumed: AssumedSet | undefined, active: boolean): LabMon | null {
  if (!assumed) return null;
  const set = { ...assumed.set, item: mon.item === null ? assumed.set.item : mon.item };
  if (mon.terastallized) set.teraType = mon.terastallized;
  const boosts: LabMon["boosts"] = {};
  if (active) for (const b of BOOSTS) if (mon.boosts[b]) boosts[b] = Math.max(-6, Math.min(6, mon.boosts[b]));
  const status = (LAB_STATUSES as readonly string[]).includes(mon.status) ? (mon.status as LabStatus) : "";
  return { set, script: [], hp: Math.max(1, Math.min(100, mon.hp)), status, boosts, terastallized: !!mon.terastallized };
}

/** A Pokémon that hasn't come out yet at this turn but does later: full HP, nothing known about its item yet. */
const fresh = (key: string, species: string, level: number): MonState => ({ key, species, level, hp: 100, fainted: false, status: "", boosts: {}, terastallized: "", item: null });

function sideFor(side: SideState, sets: Map<string, AssumedSet>, later: string[]): LabSide | null {
  const active = side.active[0];
  const seen = new Set(side.team.map((m) => m.key));
  const laterMons = later.filter((k) => !seen.has(k) && sets.has(k)).map((k) => fresh(k, sets.get(k)!.set.species, sets.get(k)!.set.level));
  const alive = [...side.team, ...laterMons].filter((m) => !m.fainted);
  alive.sort((a, b) => Number(b.key === active) - Number(a.key === active));
  const team = alive.map((m) => labMonFor(m, sets.get(m.key), m.key === active)).filter((m): m is LabMon => !!m);
  if (!team.length) return null;
  const c = side.conditions;
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
  };
}

/**
 * The setup for turn `state`; null if a side has no Pokémon to play with
 * (or the generation isn't one the Lab runs). `keys` lists every Pokémon
 * each side showed over the whole battle: those yet to come out join at
 * full HP.
 */
export function turnSetup(state: TurnState, gen: number, sets: Map<string, AssumedSet>, keys: [string[], string[]]): LabSetup | null {
  if (!isLabGen(gen)) return null;
  const a = sideFor(state.sides[0], sets, keys[0]);
  const b = sideFor(state.sides[1], sets, keys[1]);
  if (!a || !b) return null;
  const weather = (LAB_WEATHERS as readonly string[]).includes(state.weather) ? (state.weather as LabWeather) : "";
  const terrain = (LAB_TERRAINS as readonly string[]).includes(state.terrain) ? (state.terrain as LabTerrain) : "";
  return {
    gen,
    doubles: false,
    sides: [a, b],
    weather,
    weatherTurns: weather ? state.weatherTurns || USUAL_TURNS : 0,
    terrain,
    terrainTurns: terrain ? state.terrainTurns || USUAL_TURNS : 0,
  };
}

/** Pokémon a side brought that never appeared in the whole battle, so the simulations leave them out. */
export const neverSeen = (size: number, shown: number) => Math.max(0, size - shown);
