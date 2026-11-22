import { draw } from "./rng";

/**
 * Blind Ranking: Pokémon are revealed one at a time and each must go into a free slot (1 is best) for good, without
 * knowing what comes next. The draw is seeded: the same pool, length and seed give the same Pokémon in the same order,
 * so a challenge link hands a friend exactly the run its sender had.
 */

export const BLIND_LENGTHS = [5, 10] as const;
export type BlindLength = (typeof BLIND_LENGTHS)[number];

/** The Pokémon to reveal, in order. `pool` must be in a canonical order (the roster's) for the draw to replay. */
export function blindDraw(pool: readonly string[], length: number, seed: string): string[] {
  return draw(pool, length, `blind:${seed}`);
}

/**
 * slots[i] is the index (into the draw) of the Pokémon placed in slot i, or -1 while it's free. The next Pokémon to
 * place is the draw's next one: the count of filled slots.
 */
export type Slots = number[];

export const emptySlots = (length: number): Slots => Array.from({ length }, () => -1);
export const placedCount = (slots: Slots) => slots.filter((s) => s >= 0).length;
export const isDone = (slots: Slots) => slots.length > 0 && slots.every((s) => s >= 0);

/** Places the next Pokémon in `slot`; unchanged if the slot is taken or the run is over. */
export function place(slots: Slots, slot: number): Slots {
  if (slot < 0 || slot >= slots.length || slots[slot] >= 0 || isDone(slots)) return slots;
  const next = slots.slice();
  next[slot] = placedCount(slots);
  return next;
}

/** Whether slots are a valid (partial) run: distinct draw indices 0…placed−1. */
export function validSlots(slots: unknown, length: number): slots is Slots {
  if (!Array.isArray(slots) || slots.length !== length) return false;
  const filled = slots.filter((s) => s >= 0);
  if (!slots.every((s) => Number.isInteger(s) && s >= -1 && s < length)) return false;
  const set = new Set(filled);
  return set.size === filled.length && filled.every((s) => s < filled.length);
}

/** The keys in slot order (null for a free slot). */
export function slotKeys(slots: Slots, drawn: readonly string[]): (string | null)[] {
  return slots.map((i) => (i >= 0 ? drawn[i] ?? null : null));
}

/** How alike two finished runs are: the share of Pokémon each put in the same slot. */
export function agreement(a: Slots, b: Slots): number {
  if (!a.length || a.length !== b.length) return 0;
  return a.filter((x, i) => x >= 0 && x === b[i]).length / a.length;
}
