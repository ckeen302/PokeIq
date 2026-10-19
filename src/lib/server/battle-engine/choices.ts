import "server-only";
import type { BattleRequest, BattleRequestMove } from "@/lib/battle/play";

/**
 * Every legal, fully explicit choice a request allows: what the computer
 * opponent picks from, and what the turn timer plays for a player who ran
 * out of time. Never "default": the simulator logs a default move without
 * its target, and such an input log won't replay in doubles.
 */

/** Move targets the player must pick in doubles. */
const CHOOSABLE_TARGETS = new Set(["normal", "any", "adjacentAlly", "adjacentAllyOrSelf", "adjacentFoe"]);

export const isFainted = (condition: string) => condition.endsWith(" fnt");

/** One active slot's options, as the simulator's choice text for that slot. */
export interface SlotOption {
  kind: "move" | "switch" | "pass";
  text: string;
  /** move: the move's index (1-based) and target location (0 for none); switch: the team index (1-based). */
  index: number;
  target: number;
  tera: boolean;
  move?: BattleRequestMove;
}

/** The targets a move may be aimed at from `slot` (0-based) in doubles; [0] when no target is chosen. */
export function moveTargets(target: string | undefined, slot: number, doubles: boolean): number[] {
  if (!doubles || !target || !CHOOSABLE_TARGETS.has(target)) return [0];
  const self = -(slot + 1);
  const ally = -(2 - slot);
  switch (target) {
    case "adjacentAlly":
      return [ally];
    case "adjacentAllyOrSelf":
      return [self, ally];
    default:
      // normal, any, adjacentFoe: either foe (aiming "any" at the ally is legal but never wanted).
      return [1, 2];
  }
}

const moveText = (index: number, target: number, tera: boolean) => `move ${index}${target ? ` ${target}` : ""}${tera ? " terastallize" : ""}`;

/** The move and switch options for active slot `slot` of a move request. */
export function moveSlotOptions(request: BattleRequest, slot: number, doubles: boolean): SlotOption[] {
  const active = request.active?.[slot];
  const mon = request.side.pokemon[slot];
  if (!active || !mon || isFainted(mon.condition) || mon.commanding) return [{ kind: "pass", text: "pass", index: 0, target: 0, tera: false }];
  const options: SlotOption[] = [];
  const usable = active.moves.map((move, i) => ({ move, index: i + 1 })).filter(({ move }) => !move.disabled);
  // Everything disabled can't happen (the simulator offers Struggle instead), but never leave a slot empty.
  const moves = usable.length ? usable : active.moves.slice(0, 1).map((move) => ({ move, index: 1 }));
  for (const { move, index } of moves) {
    for (const target of moveTargets(move.target, slot, doubles)) {
      options.push({ kind: "move", text: moveText(index, target, false), index, target, tera: false, move });
      if (active.canTerastallize) options.push({ kind: "move", text: moveText(index, target, true), index, target, tera: true, move });
    }
  }
  if (!active.trapped) {
    for (const index of benchIndices(request)) options.push({ kind: "switch", text: `switch ${index}`, index, target: 0, tera: false });
  }
  return options;
}

/** Healthy Pokémon on the bench (1-based team indices). */
export function benchIndices(request: BattleRequest): number[] {
  const out: number[] = [];
  request.side.pokemon.forEach((p, i) => {
    if (!p.active && !isFainted(p.condition)) out.push(i + 1);
  });
  return out;
}

/** For Revival Blessing: fainted Pokémon that can be brought back (1-based). */
function revivable(request: BattleRequest): number[] {
  const out: number[] = [];
  request.side.pokemon.forEach((p, i) => {
    if (!p.active && isFainted(p.condition)) out.push(i + 1);
  });
  return out;
}

/** Which slots of a forced-switch request need a Pokémon, and from which pool. */
export function forcedSwitchSlots(request: BattleRequest): { slot: number; pool: number[]; reviving: boolean }[] {
  return (request.forceSwitch ?? []).map((forced, slot) => {
    const reviving = !!request.side.pokemon[slot]?.reviving;
    return { slot, pool: forced ? (reviving ? revivable(request) : benchIndices(request)) : [], reviving };
  });
}

/** The team order for team preview: `lead` first, then the rest in order. */
export function teamChoice(request: BattleRequest, lead = 1): string {
  const size = request.side.pokemon.length;
  const order = [lead, ...Array.from({ length: size }, (_, i) => i + 1).filter((i) => i !== lead)];
  return `team ${order.join("")}`;
}

/**
 * A random legal choice, using `rand` (0 ≤ x < 1). Picks a Pokémon at most
 * once per turn and Terastallizes at most one of them.
 */
export function randomChoice(request: BattleRequest, doubles: boolean, rand: () => number): string {
  const pick = <T,>(list: T[]): T => list[Math.floor(rand() * list.length)];
  if (request.teamPreview) return teamChoice(request, 1 + Math.floor(rand() * request.side.pokemon.length));
  if (request.forceSwitch) {
    const taken = new Set<number>();
    return forcedSwitchSlots(request)
      .map(({ pool }) => {
        const free = pool.filter((i) => !taken.has(i));
        if (!free.length) return "pass";
        const index = pick(free);
        taken.add(index);
        return `switch ${index}`;
      })
      .join(", ");
  }
  const slots = request.active?.length ?? 0;
  const taken = new Set<number>();
  let tera = false;
  const parts: string[] = [];
  for (let slot = 0; slot < slots; slot++) {
    const options = moveSlotOptions(request, slot, doubles).filter((o) => (o.kind !== "switch" || !taken.has(o.index)) && !(o.tera && tera));
    // Prefer attacking: switching at random makes a poor opponent and a worse stand-in for a timed-out player.
    const moves = options.filter((o) => o.kind !== "switch");
    const option = moves.length && rand() < 0.85 ? pick(moves) : pick(options);
    if (option.kind === "switch") taken.add(option.index);
    if (option.tera) tera = true;
    parts.push(option.text);
  }
  return parts.join(", ");
}

/** A safe, plain choice: the first usable move (no target trickery, no Tera) or the first healthy switch. */
export function firstChoice(request: BattleRequest, doubles: boolean): string {
  return randomChoice(request, doubles, () => 0);
}
