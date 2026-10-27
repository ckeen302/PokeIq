import type { Generation } from "@pkmn/data";
import { calcMoves, emptyField, makePokemon, sideFromSet, type CalcField, type CalcModule, type CalcSide, type StatusId } from "@/lib/battle/calc";
import type { AssumedSet } from "./assume";
import { koChance, pct, type Swing } from "./maths";
import type { Action, MonState, ParsedBattle, SideIndex, TurnState } from "./parse";

/**
 * Facts about a turn worked out with the damage calc on the turn's own
 * state (HP, stat stages, status, Tera, weather, terrain, screens), and the
 * plain-English lines built from them. Every number in a line comes from
 * the calc or the rollouts; when a figure can't be worked out (a move the
 * calc doesn't model, a multi-hit move, a Pokémon with no set), the line
 * leaves it out rather than guess.
 *
 * - Missed KO: a move the viewer's Pokémon revealed in the battle had at
 *   least a 50% chance to KO the foe in front of it (non-critical rolls ×
 *   accuracy), and the viewer did something else.
 * - Risky switch: the viewer switched in, and the move the foe used on the
 *   switch-in had at least a 50% chance to KO it.
 */

type Calc = { gen: Generation; lib: CalcModule };

export const KO_THRESHOLD = 0.5;

export interface MissedKo {
  turn: number;
  mon: string;
  move: string;
  target: string;
  chance: number;
  /** What the viewer did instead. */
  instead: Action;
}

export interface RiskySwitch {
  turn: number;
  from: string | null;
  to: string;
  foe: string;
  move: string;
  chance: number;
  /** HP the switch-in lost to the hit, in % (from the log). */
  lost: number;
  fainted: boolean;
}

const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
const WEATHER: Record<string, string> = { sunnyday: "Sun", desolateland: "Harsh Sunshine", raindance: "Rain", primordialsea: "Heavy Rain", sandstorm: "Sand", snowscape: "Snow", snow: "Snow", hail: "Hail", deltastream: "Strong Winds" };
const TERRAIN: Record<string, string> = { electricterrain: "Electric", grassyterrain: "Grassy", psychicterrain: "Psychic", mistyterrain: "Misty" };
const STATUSES = new Set(["brn", "par", "psn", "tox", "slp", "frz"]);

export function calcSide(mon: MonState, assumed: AssumedSet, conditions: Record<string, number>, hpOverride?: number): CalcSide {
  const side = sideFromSet({ ...assumed.set, item: mon.item === null ? assumed.set.item : mon.item, teraType: mon.terastallized || assumed.set.teraType });
  side.hpPercent = Math.max(1, Math.min(100, hpOverride ?? mon.hp));
  side.status = (STATUSES.has(mon.status) ? mon.status : "") as StatusId;
  side.terastallized = !!mon.terastallized;
  for (const b of ["atk", "def", "spa", "spd", "spe"] as const) side.boosts[b] = Math.max(-6, Math.min(6, mon.boosts[b] ?? 0));
  side.flags = { isReflect: !!conditions.reflect, isLightScreen: !!conditions.lightscreen, isAuroraVeil: !!conditions.auroraveil, isSR: !!conditions.stealthrock };
  side.spikes = conditions.spikes ?? 0;
  return side;
}

export function fieldOf(state: TurnState): CalcField {
  return { ...emptyField(), weather: WEATHER[state.weather] ?? "", terrain: TERRAIN[state.terrain] ?? "" };
}

/** The chance `move` from `attacker` knocks out `defender` this hit; null when the calc can't say (no single-hit rolls). */
export function moveKoChance(calc: Calc, move: string, attacker: CalcSide, defender: CalcSide, field: CalcField): number | null {
  const line = calcMoves(calc, { ...attacker, moves: [move] }, defender, field)[0];
  if (!line || !line.rolls.length || line.category === "Status") return null;
  const hp = makePokemon(calc, defender).originalCurHP;
  const data = calc.gen.moves.get(move);
  if (!data || (data.multihit && data.multihit !== 1)) return null;
  return koChance(line.rolls, hp, data.accuracy);
}

const monAt = (state: TurnState, side: SideIndex, key: string | null | undefined) => (key ? state.sides[side].team.find((m) => m.key === key) : undefined);

export function turnFacts(
  calc: Calc,
  parsed: ParsedBattle,
  turn: number,
  viewer: SideIndex,
  sets: Map<string, AssumedSet>
): { missedKo: MissedKo | null; riskySwitch: RiskySwitch | null } {
  const state = parsed.turns[turn];
  const events = parsed.events[turn];
  const foeSide: SideIndex = viewer === 0 ? 1 : 0;
  const mine = monAt(state, viewer, state.sides[viewer].active[0]);
  const foe = monAt(state, foeSide, state.sides[foeSide].active[0]);
  const choice = events?.actions[viewer].find((a) => a.kind !== "tera");
  let missedKo: MissedKo | null = null;
  let riskySwitch: RiskySwitch | null = null;
  if (!mine || !foe || !choice) return { missedKo, riskySwitch };
  const field = fieldOf(state);
  const myConds = state.sides[viewer].conditions;
  const foeConds = state.sides[foeSide].conditions;

  // Missed KO: the best of the moves this Pokémon revealed in the battle.
  const mySet = sets.get(mine.key);
  const foeSet = sets.get(foe.key);
  const revealedMoves = parsed.revealed[viewer].get(mine.key)?.moves ?? [];
  if (mySet && foeSet && revealedMoves.length) {
    const attacker = calcSide(mine, mySet, myConds);
    const defender = calcSide(foe, foeSet, foeConds);
    let best: { move: string; chance: number } | null = null;
    const chances = new Map<string, number>();
    for (const move of revealedMoves) {
      try {
        const c = moveKoChance(calc, move, attacker, defender, field);
        if (c === null) continue;
        chances.set(toId(move), c);
        if (!best || c > best.chance) best = { move, chance: c };
      } catch {
        // the calc can't model it: leave it out
      }
    }
    const used = choice.kind === "move" ? chances.get(toId(choice.move)) : undefined;
    if (best && best.chance >= KO_THRESHOLD && !(choice.kind === "move" && (toId(choice.move) === toId(best.move) || (used ?? 0) >= KO_THRESHOLD))) {
      missedKo = { turn, mon: mine.species, move: best.move, target: foe.species, chance: best.chance, instead: choice };
    }
  }

  // Risky switch: the foe's move on the switch-in, at the switch-in's HP before the hit.
  if (choice.kind === "switch") {
    const hit = events.hits.find((h) => h.target === choice.to && h.by === foe.key);
    const inSet = sets.get(choice.to);
    const switchIn = monAt(parsed.turns[Math.min(turn + 1, parsed.lastTurn)], viewer, choice.to) ?? monAt(state, viewer, choice.to);
    if (hit && inSet && foeSet && switchIn) {
      try {
        const attacker = calcSide(foe, foeSet, foeConds);
        const defender = calcSide({ ...switchIn, boosts: {}, terastallized: monAt(state, viewer, choice.to)?.terastallized ?? switchIn.terastallized }, inSet, myConds, hit.before);
        const chance = moveKoChance(calc, hit.move, attacker, defender, field);
        if (chance !== null && chance >= KO_THRESHOLD) {
          riskySwitch = {
            turn,
            from: mine.species,
            to: switchIn.species,
            foe: foe.species,
            move: hit.move,
            chance,
            lost: Math.max(0, hit.before - hit.after),
            fainted: events.fainted.includes(choice.to),
          };
        }
      } catch {
        // leave it out
      }
    }
  }
  return { missedKo, riskySwitch };
}

// ---------------------------------------------------------------------------
// Lines
// ---------------------------------------------------------------------------

const speciesOf = (parsed: ParsedBattle, side: SideIndex, key: string | null) => {
  if (!key) return "";
  return parsed.revealed[side].get(key)?.species ?? key.replace(/^p[12]: /, "");
};

/** "you used Earthquake", "you switched to Corviknight", "you Terastallized into Ground and used Earthquake". */
export function describeActions(parsed: ParsedBattle, side: SideIndex, actions: readonly Action[], you: boolean): string {
  const who = you ? "you" : "your opponent";
  const tera = actions.find((a): a is Extract<Action, { kind: "tera" }> => a.kind === "tera");
  const main = actions.find((a) => a.kind !== "tera");
  const parts: string[] = [];
  if (tera) parts.push(`Terastallized into ${tera.type}`);
  if (main?.kind === "move") parts.push(`used ${main.move}${main.missed ? " (it missed)" : ""}`);
  if (main?.kind === "switch") parts.push(`switched to ${speciesOf(parsed, side, main.to)}`);
  return parts.length ? `${who} ${parts.join(" and ")}` : "";
}

const insteadText = (parsed: ParsedBattle, side: SideIndex, a: Action) =>
  a.kind === "move" ? `you used ${a.move} instead` : a.kind === "switch" ? `you switched to ${speciesOf(parsed, side, a.to)} instead` : "";

export function missedKoText(parsed: ParsedBattle, viewer: SideIndex, m: MissedKo): string {
  return `${m.move} had a ${pct(m.chance)} chance to KO ${m.target}; ${insteadText(parsed, viewer, m.instead)}`;
}

export function riskySwitchText(r: RiskySwitch): string {
  return `you switched ${r.to} in on ${r.foe}'s ${r.move}, which had a ${pct(r.chance)} chance to KO it (it ${r.fainted ? "fainted" : `lost ${r.lost}%`})`;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Turn 7: Earthquake had an 87% chance to KO Heatran; you switched to Corviknight instead (win chance 61% → 44%)." */
export function keyMomentLine(parsed: ParsedBattle, viewer: SideIndex, swing: Swing, facts: { missedKo: MissedKo | null; riskySwitch: RiskySwitch | null }): string {
  const foe: SideIndex = viewer === 0 ? 1 : 0;
  const events = parsed.events[swing.turn];
  let what = "";
  if (facts.missedKo) what = missedKoText(parsed, viewer, facts.missedKo);
  else if (facts.riskySwitch) what = riskySwitchText(facts.riskySwitch);
  else if (events) {
    const mine = describeActions(parsed, viewer, events.actions[viewer], true);
    const theirs = describeActions(parsed, foe, events.actions[foe], false);
    what = [mine, theirs].filter(Boolean).join("; ");
    const lost = events.fainted.map((k) => speciesOf(parsed, k.startsWith(viewer === 0 ? "p1" : "p2") ? viewer : foe, k));
    if (lost.length) what += `${what ? "; " : ""}${lost.join(" and ")} fainted`;
  }
  const end = swing.after.n > 0 ? pct(swing.after.p) : swing.after.p === 1 ? "won" : swing.after.p === 0 ? "lost" : "draw";
  return `Turn ${swing.turn}: ${capital(what || "both sides played on")} (win chance ${pct(swing.before.p)} → ${end}).`;
}
