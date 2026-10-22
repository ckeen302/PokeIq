import type { Generation } from "@pkmn/data";
import { calcMoves, emptyField, makePokemon, sideFromSet, type CalcModule, type CalcSide } from "./calc";
import type { TeamSet } from "./sets";

/**
 * Threats: the format's most used Pokémon on their most common set, each
 * checked against every team member with the damage calculator. A member
 * answers a threat if it survives every roll of the threat's strongest
 * common attack from full HP, or if it's faster and knocks the threat out
 * in one hit at least half the time. A threat no member answers is one the
 * team struggles against; the lines say why, member by member.
 */

type Calc = { gen: Generation; lib: CalcModule };

export interface Matchup {
  member: string;
  /** The threat's hardest-hitting move on this member, and its damage range (% of max HP, from full). */
  takes: { move: string; percent: [number, number] } | null;
  survives: boolean;
  /** The member's best move on the threat. */
  deals: { move: string; percent: [number, number]; koChance: number } | null;
  faster: boolean;
  answers: boolean;
}

export interface ThreatReport {
  species: string;
  /** "Choice Band · Adamant 252 Atk / 4 Def / 252 Spe". */
  setLabel: string;
  usage: number;
  matchups: Matchup[];
  struggles: boolean;
}

/** Share of rolls that do at least `hp` damage. */
export function koShare(rolls: readonly number[], hp: number): number {
  if (!rolls.length) return 0;
  return rolls.filter((r) => r >= hp).length / rolls.length;
}

const speedOf = (calc: Calc, side: CalcSide) => makePokemon(calc, side).stats.spe;

function best(calc: Calc, attacker: TeamSet, defender: TeamSet) {
  const a = sideFromSet(attacker);
  const d = sideFromSet(defender);
  const lines = calcMoves(calc, a, d, emptyField()).filter((l) => l.damage[1] > 0);
  if (!lines.length) return null;
  const top = lines.reduce((x, y) => (y.damage[1] > x.damage[1] ? y : x));
  const hp = makePokemon(calc, d).maxHP();
  return { move: top.move, percent: top.percent, max: top.damage[1], hp, koChance: koShare(top.rolls, hp) };
}

export function matchup(calc: Calc, member: TeamSet, threat: TeamSet): Matchup {
  const takes = best(calc, threat, member);
  const deals = best(calc, member, threat);
  const survives = !takes || takes.max < takes.hp;
  const faster = speedOf(calc, sideFromSet(member)) > speedOf(calc, sideFromSet(threat));
  const ohko = !!deals && deals.koChance >= 0.5;
  return {
    member: member.name || member.species,
    takes: takes && { move: takes.move, percent: takes.percent },
    survives,
    deals: deals && { move: deals.move, percent: deals.percent, koChance: deals.koChance },
    faster,
    answers: survives || (faster && ohko),
  };
}

export function threatReports(calc: Calc, team: readonly TeamSet[], threats: { set: TeamSet; label: string; usage: number }[]): ThreatReport[] {
  const members = team.filter((s) => calc.gen.species.get(s.species));
  return threats
    .filter((t) => calc.gen.species.get(t.set.species))
    .map((t) => {
      const matchups = members.map((m) => matchup(calc, m, t.set));
      return { species: t.set.species, setLabel: t.label, usage: t.usage, matchups, struggles: matchups.length > 0 && !matchups.some((m) => m.answers) };
    });
}

/** "Garchomp: takes 54–64% from Earthquake; does 31–37% back with Moonblast (slower)". */
export function matchupLine(m: Matchup): string {
  const took = m.takes ? `takes ${m.takes.percent[0]}–${m.takes.percent[1]}% from ${m.takes.move}` : "takes nothing it can't shrug off";
  const back = m.deals
    ? `does ${m.deals.percent[0]}–${m.deals.percent[1]}% back with ${m.deals.move}${m.deals.koChance > 0 ? ` (${Math.round(m.deals.koChance * 100)}% to OHKO)` : ""}`
    : "has no attack that hurts it";
  return `${m.member}: ${took}; ${back}, ${m.faster ? "faster" : "slower"}`;
}
