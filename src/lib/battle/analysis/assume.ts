import { completeSet, type TeamSet } from "@/lib/battle/sets";
import type { Revealed } from "./parse";

/**
 * Filling out what a replay didn't show. A Pokémon's revealed moves, item,
 * ability and Tera type always win; the rest comes from the candidate set
 * (a random-battle set, or one built from usage statistics) that agrees
 * with the most of what was revealed. Where there's no candidate, only the
 * revealed parts are used, with no EVs.
 */

/** Where a filled-out set's unrevealed parts came from. */
export type SetSource = "random" | "usage" | "revealed" | "standin";

export const SOURCE_LABELS: Record<SetSource, string> = {
  random: "Random Battle sets",
  usage: "the most common set (Smogon usage statistics)",
  revealed: "what was revealed only",
  standin: "a stand-in for a Pokémon that never appeared",
};

/** The key a stand-in for side `side`'s `i`th unseen Pokémon goes by. */
export const standinKey = (side: 0 | 1, i: number) => `p${side + 1}: (unseen ${i + 1})`;

export interface AssumedSet {
  key: string;
  set: TeamSet;
  source: SetSource;
  /** How many of its moves were revealed in the battle (the rest are assumed). */
  revealedMoves: number;
}

const toId = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/** How well a candidate agrees with what was revealed: each matching move, item and ability counts; a contradiction costs. */
export function agreement(revealed: Revealed, candidate: TeamSet): number {
  const moves = new Set(candidate.moves.map(toId));
  let score = 0;
  for (const m of revealed.moves) score += moves.has(toId(m)) ? 2 : -1;
  if (revealed.item !== null) score += toId(revealed.item) === toId(candidate.item) ? 1 : 0;
  if (revealed.ability) score += toId(revealed.ability) === toId(candidate.ability) ? 1 : -1;
  if (revealed.teraType && candidate.teraType) score += toId(revealed.teraType) === toId(candidate.teraType) ? 1 : 0;
  return score;
}

/** The revealed facts laid over the best-agreeing candidate (the first on a tie). */
export function fillSet(revealed: Revealed, candidates: readonly TeamSet[], source: Exclude<SetSource, "revealed">): AssumedSet {
  let best: TeamSet | null = null;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const s = agreement(revealed, c);
    if (s > bestScore) {
      best = c;
      bestScore = s;
    }
  }
  const moves = revealed.moves.slice(0, 4);
  if (!best) {
    return {
      key: revealed.key,
      set: completeSet({ species: revealed.species, level: revealed.level, moves, item: revealed.item ?? "", ability: revealed.ability ?? "", teraType: revealed.teraType ?? undefined }),
      source: "revealed",
      revealedMoves: moves.length,
    };
  }
  const taken = new Set(moves.map(toId));
  for (const m of best.moves) {
    if (moves.length >= 4) break;
    if (!taken.has(toId(m))) {
      moves.push(m);
      taken.add(toId(m));
    }
  }
  return {
    key: revealed.key,
    set: {
      ...best,
      name: "",
      species: revealed.species,
      level: revealed.level,
      moves,
      item: revealed.item ?? best.item,
      ability: revealed.ability ?? best.ability,
      ...(revealed.teraType || best.teraType ? { teraType: revealed.teraType ?? best.teraType } : {}),
    },
    source,
    revealedMoves: Math.min(4, revealed.moves.length),
  };
}
