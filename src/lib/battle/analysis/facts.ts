import type { Generation } from "@pkmn/data";
import { calcMoves, emptyField, makePokemon, sideFromSet, type CalcField, type CalcModule, type CalcSide, type StatusId } from "@/lib/battle/calc";
import type { AssumedSet } from "./assume";
import { koChance, pct, type Swing } from "./maths";
import { isProtectMove, type Action, type MonState, type ParsedBattle, type SideIndex, type TurnState } from "./parse";

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
 *
 * Double battles: each of the viewer's two Pokémon is looked at on its own,
 * against both foes, with spread moves at their 75% (full power when only
 * one target is left). A KO it passed up isn't a miss when the foe went down
 * anyway (its partner got it), protected itself, or the partner had the KO
 * lined up, or when it went for another likely KO instead. When it used the
 * right move on the wrong foe, the line says so ("missed a KO on X by
 * targeting Y"). The turn's lines name every target, spread hits and the
 * HP they took, and KOs two Pokémon shared.
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
  /** A double battle: the position of the viewer's Pokémon, and the foe it aimed this same move at instead, if it did. */
  doubles?: boolean;
  slot?: number;
  aimedAt?: string;
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
  /** The hit was a spread move (double battles). */
  spread?: boolean;
}

export interface TurnFacts {
  /** The first of each (singles has at most one). */
  missedKo: MissedKo | null;
  riskySwitch: RiskySwitch | null;
  /** All of them (doubles: one per Pokémon of the viewer's at most). */
  missedKos: MissedKo[];
  riskySwitches: RiskySwitch[];
}

export const NO_FACTS: TurnFacts = { missedKo: null, riskySwitch: null, missedKos: [], riskySwitches: [] };

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

/** The turn's field; `targets` is how many Pokémon the move hits (a spread move hitting two or more is at 75% in doubles). */
export function fieldOf(state: TurnState, targets = 1): CalcField {
  return { ...emptyField(), gameType: targets > 1 ? "Doubles" : "Singles", weather: WEATHER[state.weather] ?? "", terrain: TERRAIN[state.terrain] ?? "" };
}

const SPREAD_TARGETS = new Set(["allAdjacentFoes", "allAdjacent"]);
/** How many Pokémon `move` hits from `side` at the start of the turn (doubles). */
function targetsOf(calc: Calc, state: TurnState, side: SideIndex, move: string): number {
  const target = calc.gen.moves.get(move)?.target ?? "normal";
  if (!SPREAD_TARGETS.has(target)) return 1;
  const live = (s: SideIndex) => state.sides[s].active.filter((k) => k && !monAt(state, s, k)?.fainted).length;
  return live(side === 0 ? 1 : 0) + (target === "allAdjacent" ? Math.max(0, live(side) - 1) : 0);
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

/**
 * Does a hit the log shows fit the assumed sets? A survivor that lost
 * clearly less than the calc's lowest roll means the sets (an item, a
 * spread) aren't what was assumed, and the calc's KO chance can't be trusted.
 */
export function hitFitsLog(calc: Calc, move: string, attacker: CalcSide, defender: CalcSide, field: CalcField, lost: number, fainted: boolean): boolean {
  if (fainted) return true;
  const line = calcMoves(calc, { ...attacker, moves: [move] }, defender, field)[0];
  if (!line || !line.rolls.length) return true;
  return lost >= line.percent[0] - 2;
}

const monAt = (state: TurnState, side: SideIndex, key: string | null | undefined) => (key ? state.sides[side].team.find((m) => m.key === key) : undefined);

export function turnFacts(calc: Calc, parsed: ParsedBattle, turn: number, viewer: SideIndex, sets: Map<string, AssumedSet>): TurnFacts {
  if (parsed.doubles) return doublesFacts(calc, parsed, turn, viewer, sets);
  const { missedKo, riskySwitch } = singlesFacts(calc, parsed, turn, viewer, sets);
  return { missedKo, riskySwitch, missedKos: missedKo ? [missedKo] : [], riskySwitches: riskySwitch ? [riskySwitch] : [] };
}

function singlesFacts(
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
        const fainted = events.fainted.includes(choice.to);
        if (chance !== null && chance >= KO_THRESHOLD && hitFitsLog(calc, hit.move, attacker, defender, field, Math.max(0, hit.before - hit.after), fainted)) {
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


/** A double battle's turn: each of the viewer's Pokémon in battle, against both foes. */
function doublesFacts(calc: Calc, parsed: ParsedBattle, turn: number, viewer: SideIndex, sets: Map<string, AssumedSet>): TurnFacts {
  const state = parsed.turns[turn];
  const events = parsed.events[turn];
  const foeSide: SideIndex = viewer === 0 ? 1 : 0;
  const missedKos: MissedKo[] = [];
  const riskySwitches: RiskySwitch[] = [];
  if (!state || !events) return { ...NO_FACTS, missedKos, riskySwitches };
  const myConds = state.sides[viewer].conditions;
  const foeConds = state.sides[foeSide].conditions;
  const foes = state.sides[foeSide].active.map((k) => monAt(state, foeSide, k)).filter((m): m is MonState => !!m && !m.fainted);
  const chanceOf = (attacker: MonState, attackerConds: Record<string, number>, side: SideIndex, move: string, defender: MonState, defenderConds: Record<string, number>, hp?: number): number | null => {
    const a = sets.get(attacker.key);
    const d = sets.get(defender.key);
    if (!a || !d) return null;
    try {
      return moveKoChance(calc, move, calcSide(attacker, a, attackerConds), calcSide(defender, d, defenderConds, hp), fieldOf(state, targetsOf(calc, state, side, move)));
    } catch {
      return null;
    }
  };
  const actionOf = (key: string) =>
    events.actions[viewer].find((a) => (a.kind === "move" && a.mon === key) || (a.kind === "switch" && a.from === key)) as Exclude<Action, { kind: "tera" }> | undefined;

  state.sides[viewer].active.forEach((key, slot) => {
    const mine = monAt(state, viewer, key);
    if (!mine || mine.fainted) return;
    // A Pokémon that didn't get to act (it flinched, slept, fainted first) made no choice we can see.
    const choice = actionOf(mine.key);
    const revealedMoves = parsed.revealed[viewer].get(mine.key)?.moves ?? [];
    if (!choice || !revealedMoves.length) return;
    let best: { move: string; target: MonState; chance: number; spread: boolean } | null = null;
    for (const move of revealedMoves) {
      const spread = SPREAD_TARGETS.has(calc.gen.moves.get(move)?.target ?? "");
      for (const foe of foes) {
        const c = chanceOf(mine, myConds, viewer, move, foe, foeConds);
        if (c !== null && c >= KO_THRESHOLD && (!best || c > best.chance)) best = { move, target: foe, chance: c, spread };
      }
    }
    if (!best) return;
    const used = choice.kind === "move" ? choice : null;
    // It did it: the same move, at that foe (or a spread move, which hits it anyway).
    if (used && toId(used.move) === toId(best.move) && (best.spread || used.target === best.target.key || used.spread?.includes(best.target.key))) return;
    // It went for another likely KO instead.
    const usedOn = used?.target ? monAt(state, foeSide, used.target) : undefined;
    if (used && usedOn && (chanceOf(mine, myConds, viewer, used.move, usedOn, foeConds) ?? 0) >= KO_THRESHOLD) return;
    // The foe wasn't there to hit: it switched out first.
    if (events.actions[foeSide].some((x) => x.kind === "switch" && x.from === best.target.key)) return;
    // The foe went down anyway (the partner got it), or protected itself.
    if (events.fainted.includes(best.target.key) || events.protected.includes(best.target.key)) return;
    // The partner had that KO lined up.
    const partnerKey = state.sides[viewer].active.find((k) => k && k !== mine.key);
    const partner = monAt(state, viewer, partnerKey);
    const partnerMove = partner ? events.actions[viewer].find((a): a is Extract<Action, { kind: "move" }> => a.kind === "move" && a.mon === partner.key) : undefined;
    if (partner && partnerMove && (partnerMove.target === best.target.key || partnerMove.spread?.includes(best.target.key)) && (chanceOf(partner, myConds, viewer, partnerMove.move, best.target, foeConds) ?? 0) >= KO_THRESHOLD) return;
    const aimedAt = used && toId(used.move) === toId(best.move) && usedOn && usedOn.key !== best.target.key ? usedOn.species : undefined;
    missedKos.push({ turn, mon: mine.species, move: best.move, target: best.target.species, chance: best.chance, instead: choice, doubles: true, slot, ...(aimedAt ? { aimedAt } : {}) });
  });

  // Risky switches: a switch-in hit by a move with a 50%+ chance to KO it.
  for (const a of events.actions[viewer]) {
    if (a.kind !== "switch") continue;
    const inSet = sets.get(a.to);
    const switchIn = monAt(parsed.turns[Math.min(turn + 1, parsed.lastTurn)], viewer, a.to) ?? monAt(state, viewer, a.to);
    if (!inSet || !switchIn) continue;
    let worst: RiskySwitch | null = null;
    for (const hit of events.hits) {
      if (hit.target !== a.to || hit.ally) continue;
      const foe = monAt(state, foeSide, hit.by);
      if (!foe) continue;
      const defender = { ...switchIn, boosts: {}, terastallized: monAt(state, viewer, a.to)?.terastallized ?? switchIn.terastallized };
      const chance = chanceOf(foe, foeConds, foeSide, hit.move, defender, myConds, hit.before);
      if (chance === null || chance < KO_THRESHOLD || (worst && worst.chance >= chance)) continue;
      const fainted = events.fainted.includes(a.to);
      const field = fieldOf(state, targetsOf(calc, state, foeSide, hit.move));
      if (!hitFitsLog(calc, hit.move, calcSide(foe, sets.get(foe.key)!, foeConds), calcSide(defender, inSet, myConds, hit.before), field, Math.max(0, hit.before - hit.after), fainted)) continue;
      worst = {
        turn,
        from: speciesOf(parsed, viewer, a.from),
        to: switchIn.species,
        foe: foe.species,
        move: hit.move,
        chance,
        lost: Math.max(0, hit.before - hit.after),
        fainted,
        ...(hit.spread ? { spread: true } : {}),
      };
    }
    if (worst) riskySwitches.push(worst);
  }
  return { missedKo: missedKos[0] ?? null, riskySwitch: riskySwitches[0] ?? null, missedKos, riskySwitches };
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

/** Doubles: what the Pokémon did instead, naming its target ("it used Protect instead", "it used Ice Beam on Amoonguss instead"). */
function insteadDoubles(parsed: ParsedBattle, viewer: SideIndex, a: Action): string {
  if (a.kind === "switch") return `you switched it out for ${speciesOf(parsed, viewer, a.to)} instead`;
  if (a.kind !== "move") return "";
  const foe: SideIndex = viewer === 0 ? 1 : 0;
  const on = a.spread?.length ? "" : a.target && a.target !== a.mon ? ` on ${nameOf(parsed, viewer, sideOfKey(a.target, foe), a.target)}` : "";
  return `it used ${a.move}${on} instead`;
}

export function missedKoText(parsed: ParsedBattle, viewer: SideIndex, m: MissedKo): string {
  if (!m.doubles) return `${m.move} had a ${pct(m.chance)} chance to KO ${m.target}; ${insteadText(parsed, viewer, m.instead)}`;
  if (m.aimedAt) return `your ${m.mon} missed a KO on ${m.target} by targeting ${m.aimedAt} (${m.move} had a ${pct(m.chance)} chance to KO ${m.target})`;
  return `your ${m.mon}'s ${m.move} had a ${pct(m.chance)} chance to KO ${m.target}; ${insteadDoubles(parsed, viewer, m.instead)}`;
}

export function riskySwitchText(r: RiskySwitch): string {
  return `you switched ${r.to} in on ${r.foe}'s ${r.move}${r.spread ? " (a spread move)" : ""}, which had a ${pct(r.chance)} chance to KO it (it ${r.fainted ? "fainted" : `lost ${r.lost}%`})`;
}

// Doubles turns ---------------------------------------------------------------

const sideOfKey = (key: string, otherwise: SideIndex): SideIndex => (key.startsWith("p1") ? 0 : key.startsWith("p2") ? 1 : otherwise);

/** "your Garchomp" for the viewer's, "Heatran" for the opponent's. */
function nameOf(parsed: ParsedBattle, viewer: SideIndex, side: SideIndex, key: string): string {
  const species = speciesOf(parsed, side, key);
  return side === viewer ? `your ${species}` : species;
}

/** One action of a double battle's turn, with its targets and what the spread hits took. */
function doublesAction(parsed: ParsedBattle, viewer: SideIndex, side: SideIndex, a: Action, turn: number): string {
  const events = parsed.events[turn];
  const other: SideIndex = side === 0 ? 1 : 0;
  if (a.kind === "tera") return `${nameOf(parsed, viewer, side, a.mon)} Terastallized into ${a.type}`;
  if (a.kind === "switch") {
    const who = side === viewer ? "you" : "your opponent";
    return a.from ? `${who} switched ${speciesOf(parsed, side, a.from)} out for ${speciesOf(parsed, side, a.to)}` : `${who} sent in ${speciesOf(parsed, side, a.to)}`;
  }
  const name = nameOf(parsed, viewer, side, a.mon);
  if (isProtectMove(a.move)) return events?.protected.includes(a.mon) ? `${name} protected itself` : `${name}'s ${a.move} failed`;
  if (a.spread?.length) {
    const foes = a.spread.filter((k) => sideOfKey(k, other) === other);
    const allies = a.spread.filter((k) => sideOfKey(k, other) === side);
    let phrase = foes.length === 2 ? (side === viewer ? "both foes" : "both of your Pokémon") : foes.map((k) => nameOf(parsed, viewer, other, k)).join(" and ");
    if (allies.length) phrase += `${phrase ? " and " : ""}${allies.map((k) => (side === viewer ? `your ${speciesOf(parsed, side, k)}` : `its partner ${speciesOf(parsed, side, k)}`)).join(" and ")}`;
    const lost = (events?.hits ?? [])
      .filter((h) => h.by === a.mon && h.move === a.move && h.spread && h.before > h.after)
      .map((h) => `${speciesOf(parsed, sideOfKey(h.target, other), h.target)} −${h.before - h.after}%`);
    return `${name}'s ${a.move} hit ${phrase || "nothing"}${lost.length ? ` (${lost.join(", ")})` : ""}`;
  }
  if (a.target && a.target !== a.mon) {
    const targetSide = sideOfKey(a.target, other);
    const on = targetSide === side ? (side === viewer ? `your ${speciesOf(parsed, side, a.target)}` : `its partner ${speciesOf(parsed, side, a.target)}`) : nameOf(parsed, viewer, targetSide, a.target);
    // Into a Protect: the hit (if the log shows one) took nothing.
    const blocked = !a.missed && events?.protected.includes(a.target) && !(events?.hits ?? []).some((h) => h.by === a.mon && h.target === a.target && h.before > h.after);
    return `${name} used ${a.move} on ${on}${a.missed ? " (it missed)" : blocked ? " (blocked by Protect)" : ""}`;
  }
  return `${name} used ${a.move}${a.missed ? " (it missed)" : ""}`;
}

/** Who knocked out whom in a double battle's turn: a shared KO names both. */
function doublesKos(parsed: ParsedBattle, viewer: SideIndex, turn: number): string[] {
  const events = parsed.events[turn];
  if (!events) return [];
  return events.fainted.map((key) => {
    const side = sideOfKey(key, viewer);
    const target = nameOf(parsed, viewer, side, key);
    const hits = events.hits.filter((h) => h.target === key && !h.ally && sideOfKey(h.by, side) !== side);
    const by = [...new Set(hits.map((h) => h.by))];
    if (!hits.length) return `${target} fainted`;
    const last = hits[hits.length - 1];
    const attackerSide = sideOfKey(last.by, side);
    if (by.length >= 2) {
      const [first, second] = [by[0], by[1]].map((k) => speciesOf(parsed, attackerSide, k));
      return `${attackerSide === viewer ? "your " : ""}${first} and ${second} knocked out ${target} together`;
    }
    return `${nameOf(parsed, viewer, attackerSide, last.by)}'s ${last.move} knocked out ${target}`;
  });
}

/** A double battle's turn in words: both sides' actions with their targets, then the KOs. */
export function describeDoublesTurn(parsed: ParsedBattle, viewer: SideIndex, turn: number): string {
  const events = parsed.events[turn];
  if (!events) return "";
  const foe: SideIndex = viewer === 0 ? 1 : 0;
  const parts = [
    ...events.actions[viewer].map((a) => doublesAction(parsed, viewer, viewer, a, turn)),
    ...events.actions[foe].map((a) => doublesAction(parsed, viewer, foe, a, turn)),
    ...doublesKos(parsed, viewer, turn),
  ].filter(Boolean);
  return parts.join("; ");
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Turn 7: Earthquake had an 87% chance to KO Heatran; you switched to Corviknight instead (win chance 61% → 44%)." */
export function keyMomentLine(parsed: ParsedBattle, viewer: SideIndex, swing: Swing, facts: { missedKo: MissedKo | null; riskySwitch: RiskySwitch | null }): string {
  const foe: SideIndex = viewer === 0 ? 1 : 0;
  const events = parsed.events[swing.turn];
  let what = "";
  if (facts.missedKo) what = missedKoText(parsed, viewer, facts.missedKo);
  else if (facts.riskySwitch) what = riskySwitchText(facts.riskySwitch);
  else if (events && parsed.doubles) what = describeDoublesTurn(parsed, viewer, swing.turn);
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
