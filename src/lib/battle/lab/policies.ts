import type { Battle, Pokemon, Side } from "@pkmn/sim";
import { forcedSwitchSlots, moveSlotOptions, randomChoice, type SlotOption } from "@/lib/battle/choices";
import { alive, calcGen, field, hit, toCalc } from "@/lib/battle/cpu-policy";
import { chooseCpuLegacy } from "@/lib/battle/cpu-policy-legacy";
import type { BattleRequest } from "@/lib/battle/play";
import type { LabStrategy } from "./types";

/**
 * The Battle Lab's strategies, each a function from a live simulator battle
 * to one side's next choice. Every choice is built from the simulator's own
 * request, so it's explicit and legal:
 *
 * - smart: the one-turn heuristic the computer opponent used as Hard before the lookahead
 *   (src/lib/battle/cpu-policy-legacy.ts): the lookahead is too slow for thousands of rollouts.
 * - greedy: the move with the highest expected damage on the foe it can see
 *   (average roll, capped at the foe's HP, times accuracy), with full
 *   knowledge of the foe's set. No voluntary switches, no Tera.
 * - random: any legal choice (mostly attacks; see randomChoice).
 * - scripted: each Pokémon's listed moves, in order. No voluntary switches.
 *
 * Every strategy Mega Evolves the first time it can: no one would hold a
 * Mega Stone and not.
 */

export type Chooser = (battle: Battle, side: Side) => string;

export interface StrategyOptions {
  strategy: LabStrategy;
  /** This side's dice (seeded per battle). */
  rand: () => number;
  /** Scripted: each team slot's moves in order (ids or names), by the team's original order. */
  scripts: string[][];
  /** Scripted: start the list over after the last move (otherwise the last move repeats). */
  loop: boolean;
  /** The Smart strategy fell back to a random move (its damage calc failed). */
  onFallback?: (err: unknown) => void;
}

const toId = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** A Pokémon's slot in the team as the setup listed it (the simulator reorders side.pokemon as they switch; side.team keeps the order). */
export function originalSlot(side: Side, p: Pokemon): number {
  const i = side.team.indexOf(p.set);
  return i >= 0 ? i : 0;
}

export function makeChooser(opts: StrategyOptions): Chooser {
  // Scripted: how many turns each Pokémon has been asked for a move.
  const steps = new Map<Pokemon, number>();
  return (battle, side) => {
    const request = side.activeRequest as unknown as BattleRequest | null;
    if (!request || request.wait) throw new Error("Nothing to choose.");
    const doubles = battle.gameType === "doubles";
    let choice: string;
    switch (opts.strategy) {
      case "smart":
        choice = chooseCpuLegacy(battle, side, "hard", opts.rand, opts.onFallback ?? (() => undefined));
        break;
      case "greedy":
        choice = chooseGreedy(battle, side, request, doubles);
        break;
      case "random":
        choice = randomChoice(request, doubles, opts.rand);
        break;
      case "scripted":
        choice = chooseScripted(side, request, doubles, (p) => opts.scripts[originalSlot(side, p)] ?? [], opts.loop, steps);
        break;
    }
    return withMega(choice, request);
  };
}

/** Adds " mega" to the first move of the turn whose Pokémon can Mega Evolve (one per side per battle). */
export function withMega(choice: string, request: BattleRequest): string {
  if (request.forceSwitch || request.teamPreview || !request.active) return choice;
  let done = false;
  return choice
    .split(", ")
    .map((part, slot) => {
      const active = request.active?.[slot] as { canMegaEvo?: boolean } | undefined;
      if (done || !active?.canMegaEvo || !part.startsWith("move ") || / (mega|terastallize|zmove|dynamax)$/.test(part)) return part;
      done = true;
      return `${part} mega`;
    })
    .join(", ");
}

/** Targets the strategies without a plan aim at in doubles: the first foe still standing. */
function preferredTarget(side: Side, options: SlotOption[]): SlotOption[] {
  const byMove = new Map<number, SlotOption[]>();
  for (const o of options) byMove.set(o.index, [...(byMove.get(o.index) ?? []), o]);
  const out: SlotOption[] = [];
  for (const list of byMove.values()) {
    const live = list.find((o) => o.target > 0 && alive(side.foe.active[o.target - 1]));
    out.push(live ?? list[0]);
  }
  return out;
}

/** Forced switches in team order (the first healthy Pokémon of the original team). */
function switchInOrder(side: Side, request: BattleRequest): string {
  const taken = new Set<number>();
  return forcedSwitchSlots(request)
    .map(({ pool }) => {
      const free = pool.filter((i) => !taken.has(i)).sort((a, b) => originalSlot(side, side.pokemon[a - 1]) - originalSlot(side, side.pokemon[b - 1]));
      if (!free.length) return "pass";
      taken.add(free[0]);
      return `switch ${free[0]}`;
    })
    .join(", ");
}

// ---------------------------------------------------------------------------
// Greedy
// ---------------------------------------------------------------------------

/** Expected share of the foe's current HP each foe loses to `move` (spread moves hit both foes for 75%). */
function expectedDamage(battle: Battle, side: Side, attacker: Pokemon, option: SlotOption, doubles: boolean): number {
  if (!option.move) return 0;
  const gen = calcGen(battle);
  const f = field(battle, doubles, side);
  const mine = toCalc(battle, attacker, false);
  const foes = side.foe.active.filter(alive);
  const spread = option.move.target === "allAdjacentFoes" || option.move.target === "allAdjacent";
  const target = option.target > 0 ? side.foe.active[option.target - 1] : null;
  const victims = doubles ? (spread ? foes : alive(target) ? [target] : []) : foes.slice(0, 1);
  let total = 0;
  for (const foe of victims) total += hit(gen, mine, toCalc(battle, foe, false), option.move.move, f).frac * (doubles && spread ? 0.75 : 1);
  return total;
}

function chooseGreedy(battle: Battle, side: Side, request: BattleRequest, doubles: boolean): string {
  if (request.teamPreview) return `team ${side.pokemon.map((_, i) => i + 1).join("")}`;
  if (request.forceSwitch) {
    // Send in whoever can hit hardest right now.
    const taken = new Set<number>();
    return forcedSwitchSlots(request)
      .map(({ pool }) => {
        const free = pool.filter((i) => !taken.has(i));
        if (!free.length) return "pass";
        let pick = free[0];
        let best = -1;
        for (const i of free) {
          const score = bestDamage(battle, side, side.pokemon[i - 1], doubles);
          if (score > best) [pick, best] = [i, score];
        }
        taken.add(pick);
        return `switch ${pick}`;
      })
      .join(", ");
  }
  const parts: string[] = [];
  for (let slot = 0; slot < (request.active?.length ?? 0); slot++) {
    const options = moveSlotOptions(request, slot, doubles);
    const me = side.active[slot];
    const moves = options.filter((o) => o.kind === "move" && !o.tera);
    if (!moves.length || !alive(me)) {
      parts.push((options.find((o) => o.kind !== "switch") ?? options[0]).text);
      continue;
    }
    let pick = moves[0];
    let best = -1;
    for (const o of moves) {
      const score = safeDamage(battle, side, me, o, doubles);
      if (score > best) [pick, best] = [o, score];
    }
    // Nothing does damage (status moves only, or immune): aim the first move at a foe still standing.
    if (best <= 0) pick = preferredTarget(side, moves)[0];
    parts.push(pick.text);
  }
  return parts.join(", ");
}

function safeDamage(battle: Battle, side: Side, attacker: Pokemon, option: SlotOption, doubles: boolean): number {
  try {
    return expectedDamage(battle, side, attacker, option, doubles);
  } catch {
    return 0;
  }
}

/** The best expected hit a Pokémon on the bench would have on the foes now in battle. */
function bestDamage(battle: Battle, side: Side, p: Pokemon, doubles: boolean): number {
  try {
    const gen = calcGen(battle);
    const f = field(battle, doubles, side);
    const mine = toCalc(battle, p, false);
    let best = 0;
    for (const foe of side.foe.active.filter(alive)) {
      const theirs = toCalc(battle, foe, false);
      for (const m of p.moveSlots) best = Math.max(best, hit(gen, mine, theirs, m.move, f).frac);
    }
    return best;
  } catch {
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Scripted
// ---------------------------------------------------------------------------

function chooseScripted(
  side: Side,
  request: BattleRequest,
  doubles: boolean,
  scriptOf: (p: Pokemon) => string[],
  loop: boolean,
  steps: Map<Pokemon, number>
): string {
  if (request.teamPreview) return `team ${side.pokemon.map((_, i) => i + 1).join("")}`;
  if (request.forceSwitch) return switchInOrder(side, request);
  const parts: string[] = [];
  for (let slot = 0; slot < (request.active?.length ?? 0); slot++) {
    const options = moveSlotOptions(request, slot, doubles);
    const moves = preferredTarget(side, options.filter((o) => o.kind === "move" && !o.tera));
    const me = side.active[slot];
    if (!moves.length || !me) {
      parts.push((options.find((o) => o.kind !== "switch") ?? options[0]).text);
      continue;
    }
    const script = scriptOf(me).map(toId).filter(Boolean);
    const step = steps.get(me) ?? 0;
    steps.set(me, step + 1);
    const wanted = script.length ? script[loop ? step % script.length : Math.min(step, script.length - 1)] : "";
    // The move it should use; if it can't (disabled, out of PP, locked into another), the next one in its list that it can; else its first.
    const order = wanted ? [wanted, ...script.slice(script.indexOf(wanted) + 1), ...script] : script;
    const pick = order.map((id) => moves.find((o) => o.move?.id === id)).find((o) => o) ?? moves[0];
    parts.push(pick.text);
  }
  return parts.join(", ");
}
