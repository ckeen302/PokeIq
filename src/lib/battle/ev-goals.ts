import type { Generation } from "@pkmn/data";
import { calcMoves, emptyField, sideFromSet, type CalcField, type CalcModule } from "./calc";
import { MAX_EVS, MAX_TOTAL_EVS, type StatsTable, type TeamSet } from "./sets";
import { calcStat, NATURES } from "./tooltip-calc";

/**
 * Goal-based EV spreads: "survive this attack" and "outspeed that speed",
 * solved with the damage calculator for the fewest EVs and the best nature.
 *
 * - Survive: every damage roll of the attacker's move (no critical hit) is
 *   less than the Pokémon's HP from full.
 * - Outspeed: the Pokémon's Speed is strictly higher (a tie is a coin flip).
 *
 * Only HP, Def, SpD and Spe are spent on goals; everything else is left
 * for the player. A goal that can't be met, alone or together with the
 * others, is reported as impossible with the numbers that show it.
 */

export interface SurviveGoal {
  kind: "survive";
  attacker: TeamSet;
  move: string;
}

export interface OutspeedGoal {
  kind: "outspeed";
  /** The Speed stat to beat. */
  speed: number;
  /** "Dragapult (Jolly 252 Spe)". */
  label: string;
}

export type EvGoal = SurviveGoal | OutspeedGoal;

export interface GoalCheck {
  goal: EvGoal;
  /** "Takes 71.2–84.1% from Garchomp's Earthquake", "Speed 306 vs 305". */
  detail: string;
}

export type OptimizeResult =
  | {
      ok: true;
      nature: string;
      /** The EVs the goals need (HP, Def, SpD, Spe; others 0). */
      evs: StatsTable;
      used: number;
      /** EVs left for the player. */
      remaining: number;
      checks: GoalCheck[];
    }
  | { ok: false; reason: string };

type Calc = { gen: Generation; lib: CalcModule };
type DefStat = "def" | "spd";
const zeros = (): StatsTable => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });
const EV_STEPS = Array.from({ length: MAX_EVS / 4 + 1 }, (_, i) => i * 4);

/** The defensive stat a move hits (Psyshock and friends hit Def). */
export function targetStat(gen: Generation, move: string): DefStat | null {
  const m = gen.moves.get(move);
  if (!m || m.category === "Status") return null;
  const override = (m as { overrideDefensiveStat?: string }).overrideDefensiveStat;
  if (override === "def") return "def";
  return m.category === "Physical" ? "def" : "spd";
}

function natureMult(nature: string, stat: keyof StatsTable): number {
  const n = NATURES.find(([name]) => name === nature);
  if (!n) return 1;
  return n[1] === stat ? 1.1 : n[2] === stat ? 0.9 : 1;
}

/** The set's Speed with `ev` Speed EVs and `nature`. */
export function speedWith(gen: Generation, set: TeamSet, nature: string, ev: number): number {
  const species = gen.species.get(set.species);
  if (!species) return 0;
  return calcStat("spe", species.baseStats.spe, set.level || 100, set.ivs.spe ?? 31, ev, natureMult(nature, "spe"));
}

/** The fewest Speed EVs that beat `speed` with `nature`; null if 252 doesn't. */
export function speedEvsFor(gen: Generation, set: TeamSet, nature: string, speed: number): number | null {
  for (const ev of EV_STEPS) if (speedWith(gen, set, nature, ev) > speed) return ev;
  return null;
}

interface SurviveResult {
  survives: boolean;
  /** Damage as % of max HP, from full. */
  percent: [number, number];
}

/** Whether `set` with these EVs and nature takes every roll of the goal's attack and lives. */
export function survives(calc: Calc, set: TeamSet, nature: string, evs: StatsTable, goal: SurviveGoal, field: CalcField = emptyField()): SurviveResult {
  const attacker = { ...sideFromSet(goal.attacker), moves: [goal.move] };
  const defender = { ...sideFromSet({ ...set, nature, evs }), moves: [] };
  const line = calcMoves(calc, attacker, defender, field)[0];
  if (!line) return { survives: true, percent: [0, 0] };
  const species = calc.gen.species.get(set.species);
  const hp = species ? calcStat("hp", species.baseStats.hp, set.level || 100, set.ivs.hp ?? 31, evs.hp) : 1;
  return { survives: line.damage[1] < hp, percent: line.percent };
}

/** Candidate natures: the set's own, a neutral one, and each "+Def/SpD/Spe" nature that lowers an attacking stat the set doesn't use. */
export function candidateNatures(gen: Generation, set: TeamSet): string[] {
  const out = new Set<string>([set.nature || "Serious"]);
  out.add(NATURES.some(([n, plus]) => n === set.nature && plus === null) ? set.nature : "Serious");
  const categories = new Set(set.moves.map((m) => gen.moves.get(m)?.category).filter(Boolean));
  const unused: string[] = [];
  if (!categories.has("Physical")) unused.push("atk");
  if (!categories.has("Special")) unused.push("spa");
  for (const [name, plus, minus] of NATURES) {
    if (plus && minus && ["def", "spd", "spe"].includes(plus) && unused.includes(minus)) out.add(name);
  }
  return [...out];
}

const label = (set: TeamSet) => set.name || set.species;

function describe(calc: Calc, set: TeamSet, nature: string, evs: StatsTable, goals: EvGoal[], field: CalcField): GoalCheck[] {
  return goals.map((goal) => {
    if (goal.kind === "outspeed") return { goal, detail: `Speed ${speedWith(calc.gen, set, nature, evs.spe)} vs ${goal.speed} (${goal.label})` };
    const r = survives(calc, set, nature, evs, goal, field);
    return { goal, detail: `Takes ${r.percent[0]}–${r.percent[1]}% from ${label(goal.attacker)}'s ${goal.move}` };
  });
}

/** Why a goal can't be met even alone, with all 252 EVs and the best nature in it; null if it can. */
export function impossibleAlone(calc: Calc, set: TeamSet, goal: EvGoal, field: CalcField = emptyField()): string | null {
  const natures = candidateNatures(calc.gen, set);
  if (goal.kind === "outspeed") {
    const best = Math.max(...natures.map((n) => speedWith(calc.gen, set, n, MAX_EVS)));
    return best > goal.speed ? null : `${label(set)} reaches ${best} Speed at most, and ${goal.label} has ${goal.speed}.`;
  }
  const stat = targetStat(calc.gen, goal.move);
  if (!stat) return `${goal.move} doesn't deal damage.`;
  let least: SurviveResult | null = null;
  for (const n of natures) {
    const evs = { ...zeros(), hp: MAX_EVS, [stat]: MAX_EVS };
    const r = survives(calc, set, n, evs, goal, field);
    if (r.survives) return null;
    if (!least || r.percent[1] < least.percent[1]) least = r;
  }
  return `Even with 252 HP / 252 ${stat === "def" ? "Def" : "SpD"} EVs, ${label(goal.attacker)}'s ${goal.move} does up to ${least?.percent[1]}% to ${label(set)}.`;
}

/**
 * The cheapest spread meeting every goal: for each candidate nature, the
 * fewest Speed EVs for the speed goals, then for each HP investment the
 * fewest Def and SpD EVs (binary search: more never hurts) for the attacks.
 * Fewest EVs in total wins; on a tie, the set's own nature.
 */
export function optimizeSpread(calc: Calc, set: TeamSet, goals: EvGoal[], field: CalcField = emptyField()): OptimizeResult {
  const { gen } = calc;
  if (gen.num <= 2) return { ok: false, reason: "Gen 1 and 2 have no EV limit: max every stat." };
  if (!gen.species.get(set.species)) return { ok: false, reason: `${set.species} isn't in this generation.` };
  if (!goals.length) return { ok: false, reason: "Add a goal first." };
  for (const goal of goals) {
    const why = impossibleAlone(calc, set, goal, field);
    if (why) return { ok: false, reason: `Impossible: ${why}` };
  }
  const speedTarget = Math.max(-1, ...goals.filter((g): g is OutspeedGoal => g.kind === "outspeed").map((g) => g.speed));
  const surviveGoals = goals.filter((g): g is SurviveGoal => g.kind === "survive");
  const byStat: Record<DefStat, SurviveGoal[]> = { def: [], spd: [] };
  for (const g of surviveGoals) byStat[targetStat(gen, g.move)!].push(g);

  let best: { nature: string; evs: StatsTable; used: number } | null = null;
  for (const nature of candidateNatures(gen, set)) {
    const spe = speedTarget >= 0 ? speedEvsFor(gen, set, nature, speedTarget) : 0;
    if (spe === null) continue;
    for (const hp of surviveGoals.length ? EV_STEPS : [0]) {
      const evs: StatsTable = { ...zeros(), hp, spe };
      let ok = true;
      for (const stat of ["def", "spd"] as const) {
        const list = byStat[stat];
        if (!list.length) continue;
        const lives = (ev: number) => list.every((g) => survives(calc, set, nature, { ...evs, [stat]: ev }, g, field).survives);
        if (!lives(MAX_EVS)) {
          ok = false;
          break;
        }
        let lo = 0;
        let hi = EV_STEPS.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (lives(EV_STEPS[mid])) hi = mid;
          else lo = mid + 1;
        }
        evs[stat] = EV_STEPS[lo];
      }
      if (!ok) continue;
      const used = evs.hp + evs.def + evs.spd + evs.spe;
      if (used > MAX_TOTAL_EVS) continue;
      if (!best || used < best.used || (used === best.used && nature === set.nature && best.nature !== set.nature)) best = { nature, evs, used };
    }
  }
  if (!best) return { ok: false, reason: "Impossible: each goal can be met on its own, but not all of them within 510 EVs." };
  return {
    ok: true,
    nature: best.nature,
    evs: best.evs,
    used: best.used,
    remaining: MAX_TOTAL_EVS - best.used,
    checks: describe(calc, set, best.nature, best.evs, goals, field),
  };
}

/** The goal EVs laid over the set's own, keeping as much of the rest as fits in 510. */
export function applySpread(set: TeamSet, nature: string, goalEvs: StatsTable): TeamSet {
  const evs: StatsTable = { ...set.evs };
  for (const s of ["hp", "def", "spd", "spe"] as const) if (goalEvs[s]) evs[s] = goalEvs[s];
  // Trim the stats the goals don't use, lowest priority first, to fit the limit.
  let total = Object.values(evs).reduce((a, b) => a + b, 0);
  for (const s of ["hp", "def", "spd", "spe", "spa", "atk"] as const) {
    if (total <= MAX_TOTAL_EVS) break;
    if (goalEvs[s]) continue;
    const cut = Math.min(evs[s], total - MAX_TOTAL_EVS);
    evs[s] -= cut;
    total -= cut;
  }
  for (const s of ["hp", "def", "spd", "spe", "spa", "atk"] as const) evs[s] = Math.floor(evs[s] / 4) * 4;
  return { ...set, nature, evs };
}
