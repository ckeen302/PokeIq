import { STAT_LABELS, formatHeight, formatWeight, type Pokemon, type StatKey } from "@/lib/pokemon/pokedex";
import type { QuestionBuilder } from "../types";
import { clampRating, difficultyPool } from "../shared";

/**
 * Higher or Lower — two Pokémon, one stat. Difficulty is the relative gap
 * between the values: easy pairs are ≥30% apart, hard pairs are within 12%.
 * Ties are never served.
 */

type Metric = StatKey | "bst" | "height" | "weight";

const METRICS: Metric[] = ["hp", "atk", "def", "spa", "spd", "spe", "bst", "height", "weight"];

function value(p: Pokemon, m: Metric): number {
  if (m === "bst") return p.bst;
  if (m === "height") return p.height;
  if (m === "weight") return p.weight;
  return p.stats[m];
}

function format(p: Pokemon, m: Metric): string {
  if (m === "height") return formatHeight(p.height);
  if (m === "weight") return formatWeight(p.weight);
  if (m === "bst") return `${p.bst} BST`;
  return `${p.stats[m]} ${STAT_LABELS[m]}`;
}

function promptFor(m: Metric, higher: boolean): string {
  if (m === "height") return higher ? "Which Pokémon is taller?" : "Which Pokémon is shorter?";
  if (m === "weight") return higher ? "Which Pokémon is heavier?" : "Which Pokémon is lighter?";
  const label = m === "bst" ? "base stat total" : `base ${STAT_LABELS[m]}`;
  return `Which Pokémon has the ${higher ? "higher" : "lower"} ${label}?`;
}

const GAP = { easy: [0.3, 1], medium: [0.12, 0.45], hard: [0.01, 0.12] } as const;

export const higherLower: QuestionBuilder = (rng, opts) => {
  const pool = difficultyPool(opts);
  const metric = rng.pick(METRICS);
  const higher = rng.chance(0.75);
  const [minGap, maxGap] = GAP[opts.difficulty];

  for (let attempt = 0; attempt < 60; attempt++) {
    const a = rng.pick(pool);
    const b = rng.pick(pool);
    if (a.id === b.id || opts.used.has(a.id) || opts.used.has(b.id) || a.chain === b.chain) continue;
    const va = value(a, metric);
    const vb = value(b, metric);
    if (va === vb) continue;
    const gap = Math.abs(va - vb) / Math.max(va, vb);
    if (gap < minGap || gap > maxGap) continue;

    opts.used.add(a.id);
    opts.used.add(b.id);
    const winner = (va > vb) === higher ? a : b;
    return {
      itemKey: `higher-lower:${metric}:${Math.min(a.id, b.id)}-${Math.max(a.id, b.id)}:${higher ? "hi" : "lo"}`,
      module: "higher-lower",
      prompt: promptFor(metric, higher),
      cards: [
        { pokemonId: a.id, label: a.name },
        { pokemonId: b.id, label: b.name },
      ],
      options: [a.name, b.name],
      answer: winner.name,
      explanation: `${a.name}: ${format(a, metric)} · ${b.name}: ${format(b, metric)}.`,
      // 2 options means a 50% guess floor; tight gaps are where knowledge shows.
      rating: clampRating(1450 - Math.min(gap, 0.6) * 1100),
    };
  }
  return null;
};
