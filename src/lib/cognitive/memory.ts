import { Rng } from "@/lib/rng";
import { MON_IDS, monName } from "./materials";
import type { ArithItem, Level, SpanItem } from "./types";

/**
 * Working memory: sprite spans (a sequence of Pokémon shown one at a time,
 * tapped back in order, then in reverse at the harder levels) and Pokémon
 * mental arithmetic (HP, damage and heals) answered from options.
 */

/** Sequence length by level, forward and reverse. */
export const SPAN_LENGTH: Record<"forward" | "reverse", Record<Level, number>> = {
  forward: { 1: 3, 2: 4, 3: 5, 4: 7, 5: 9 },
  reverse: { 1: 3, 2: 4, 3: 5, 4: 6, 5: 7 },
};
export const SPAN_GRID = 9;
export const SPAN_SHOW_MS = 800;
const SPAN_RECALL_MS = 30_000;
const ARITH_MS = 30_000;
export const ARITH_OPTIONS = 5;

export function spanItem(seed: string, level: Level, reverse: boolean): SpanItem {
  const rng = new Rng(`span:${seed}`);
  const n = SPAN_LENGTH[reverse ? "reverse" : "forward"][level];
  const ids = rng.sample(MON_IDS, SPAN_GRID);
  const sequence = ids.slice(0, n);
  const grid = rng.shuffle(ids);
  const order = reverse ? [...sequence].reverse() : sequence;
  return {
    kind: "span",
    id: `sp:${seed}`,
    level,
    timeMs: SPAN_RECALL_MS,
    rule: reverse ? `${n} back in reverse` : `${n} back in order`,
    sequence,
    grid,
    reverse,
    target: order.map((id) => grid.indexOf(id)),
    showMs: SPAN_SHOW_MS,
    answer: -1,
  };
}

/** Whether a tapped order is the sequence (forward or reversed, per the item). */
export function spanCorrect(item: SpanItem, taps: readonly number[]): boolean {
  return taps.length === item.target.length && taps.every((t, i) => t === item.target[i]);
}

interface Sum {
  prompt: string;
  answer: number;
  near: number[];
}

function sum(rng: Rng, level: Level, name: string): Sum {
  const max = rng.int(8, 30) * 10;
  const dmg = rng.int(2, Math.floor(max / 10) - 1) * 5;
  switch (level) {
    case 1:
      return { prompt: `${name} has ${max} HP and takes ${dmg} damage. How much HP is left?`, answer: max - dmg, near: [max - dmg + 10, max - dmg - 10, max - dmg + 5, max + dmg, max - dmg - 5] };
    case 2: {
      const heal = rng.int(2, 8) * 5;
      return { prompt: `${name} has ${max} HP, takes ${dmg} damage, then heals ${heal}. HP now?`, answer: max - dmg + heal, near: [max - dmg - heal, max - dmg + heal + 10, max - dmg + heal - 10, max - dmg, max - dmg + heal + 5] };
    }
    case 3: {
      const dmg2 = rng.int(2, 6) * 5;
      const heal = rng.int(2, 8) * 5;
      const a = max - dmg - dmg2 + heal;
      return { prompt: `${name} has ${max} HP. It takes ${dmg}, heals ${heal}, then takes ${dmg2}. HP now?`, answer: a, near: [a + 10, a - 10, a + dmg2, a - heal, a + 5] };
    }
    case 4: {
      // Sitrus Berry: a quarter of max HP.
      const base = rng.int(8, 30) * 20;
      const d = rng.int(3, 12) * 10;
      const a = base - d + base / 4;
      return { prompt: `${name} has ${base} max HP, takes ${d} damage, then eats a Sitrus Berry (restores ¼ of max HP). HP now?`, answer: a, near: [base - d + base / 2, base - d + 25, a + 10, a - 10, base - d] };
    }
    case 5: {
      // Two hits of a move and a half-HP recovery.
      const base = rng.int(8, 30) * 20;
      const hit = rng.int(2, 9) * 10;
      const a = base - 2 * hit + base / 2 - rng.int(1, 4) * 10;
      const extra = base - 2 * hit + base / 2 - a;
      return { prompt: `${name} has ${base} max HP. It is hit twice for ${hit}, uses Rest (restores ½ of max HP), then takes ${extra} more. HP now?`, answer: a, near: [a + hit, a - hit, base - hit + base / 2 - extra, a + 10, a - 10] };
    }
  }
}

export function arithItem(seed: string, level: Level): ArithItem {
  const rng = new Rng(`arith:${seed}`);
  const monId = rng.pick(MON_IDS);
  const s = sum(rng, level, monName(monId));
  const seen = new Set<number>([s.answer]);
  const distractors: number[] = [];
  for (const v of [...s.near, s.answer + 15, s.answer - 15, s.answer + 20, s.answer - 20]) {
    if (!Number.isInteger(v) || v < 0 || seen.has(v)) continue;
    seen.add(v);
    distractors.push(v);
    if (distractors.length === ARITH_OPTIONS - 1) break;
  }
  const options = rng.shuffle([s.answer, ...distractors]);
  return { kind: "arith", id: `ar:${seed}`, level, timeMs: ARITH_MS, rule: `level ${level} sum`, monId, prompt: s.prompt, options, answer: options.indexOf(s.answer) };
}
