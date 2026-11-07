import type { BattleRequest, BattleRequestPokemon } from "@/lib/battle/play";

/**
 * Building a choice one slot at a time (doubles has one per active
 * Pokémon). The pure part of the Controls: which slots pass on their own,
 * and which Pokémon a slot may send in. Slot s's Pokémon is side.pokemon[s].
 */

export const fainted = (p: BattleRequestPokemon) => p.condition.endsWith(" fnt");

/** Team positions (1-based) already picked to switch in by earlier slots. */
export function switchedIn(parts: string[]): number[] {
  return parts.map((c) => /^switch (\d+)$/.exec(c)?.[1]).filter(Boolean).map(Number);
}

/**
 * The team positions (1-based) slot `slot` may send in, given the earlier
 * slots' choices: benched (not active), not already picked, and healthy. For
 * Revival Blessing: any fainted one, an ally that fainted this turn and still
 * holds its spot on the field included (the simulator revives it in place).
 */
export function switchOptions(request: BattleRequest, slot: number, parts: string[]): number[] {
  const reviving = !!request.side.pokemon[slot]?.reviving;
  const taken = switchedIn(parts);
  const out: number[] = [];
  request.side.pokemon.forEach((p, i) => {
    if (!taken.includes(i + 1) && (reviving ? fainted(p) : !p.active && !fainted(p))) out.push(i + 1);
  });
  return out;
}

/** How many slots this request wants a choice for. */
export const slotCount = (request: BattleRequest) => request.forceSwitch?.length ?? request.active?.length ?? 0;

/**
 * Whether slot `slot` passes without asking. When switching in after a
 * faint: a slot that isn't asked to, or that has nobody left to send in
 * (two fainted and one on the bench: one comes in, the other spot stays
 * empty, e.g. "switch 3, pass"). Otherwise: a fainted or commanding Pokémon.
 */
export function slotPasses(request: BattleRequest, slot: number, parts: string[]): boolean {
  if (request.forceSwitch) return !request.forceSwitch[slot] || switchOptions(request, slot, parts).length === 0;
  const p = request.side.pokemon[slot];
  return !request.active?.[slot] || !p || fainted(p) || !!p.commanding;
}

/** The choices so far plus any passes due next. */
export function fillPasses(request: BattleRequest, parts: string[]): string[] {
  const slots = slotCount(request);
  let next = parts;
  while (next.length < slots && slotPasses(request, next.length, next)) next = [...next, "pass"];
  return next;
}

/** The forced switch's slots still asking, after the one being chosen now, that will go empty for want of Pokémon. */
export function emptiedSlots(request: BattleRequest, parts: string[]): number[] {
  if (!request.forceSwitch) return [];
  const wanting = request.forceSwitch.map((on, s) => (on && s >= parts.length ? s : -1)).filter((s) => s >= 0);
  const left = switchOptions(request, parts.length, parts).length;
  return wanting.slice(Math.max(0, left));
}

/**
 * The spots a move can be aimed at on the triples and four-player grid, in
 * the grid's order: the ones in reach with a Pokémon in them. With nobody
 * left in reach (an edge Pokémon whose foes in reach have all fainted, no
 * one left to replace them), every spot in reach, as Showdown takes the
 * move at an empty spot (the simulator then aims it at a Pokémon in reach,
 * or it fails): the grid still has something to press besides Back.
 */
export function aimableSpots<T extends { loc: number; legal: boolean }>(spots: readonly T[], empty: (loc: number) => boolean): T[] {
  const inReach = spots.filter((t) => t.legal);
  const occupied = inReach.filter((t) => !empty(t.loc));
  return occupied.length ? occupied : inReach;
}

/** The M key: no special move, then each one the request offers in turn, then none again. */
export function cycleExtra<T>(current: T | null, extras: readonly T[]): T | null {
  const next = (current === null ? -1 : extras.indexOf(current)) + 1;
  return next < extras.length ? extras[next] : null;
}

/**
 * Team preview's "team" choice: the Pokémon tapped, in order, then (unless
 * the format brings fewer than the whole team) the rest in team order.
 */
export function teamOrder(picked: readonly number[], size: number, bringAll: boolean): string {
  const rest = bringAll ? Array.from({ length: size }, (_, i) => i + 1).filter((i) => !picked.includes(i)) : [];
  return `team ${[...picked, ...rest].join("")}`;
}
