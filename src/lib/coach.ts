import { GENERATION_REGIONS, STAT_LABELS, type StatKey } from "./pokemon/constants";
import { MODULE_INFO, moduleHref } from "./modes";
import type { ModuleId } from "@/engines/types";

/**
 * Weak-spot coach. Every graded answer is tallied against skill tags
 * (generation, type, game mode, stat). Accuracy is estimated with a
 * Beta(α, β) prior centred on the player's overall accuracy, so three lucky
 * answers don't make a "strength" — small samples shrink toward the mean
 * (empirical-Bayes smoothing). Each insight links to the study tool that
 * targets it.
 */

export interface Insight {
  tag: string;
  label: string;
  /** Smoothed accuracy estimate, 0–1. */
  accuracy: number;
  answered: number;
  href: string;
  cta: string;
}

const PRIOR_STRENGTH = 6; // pseudo-answers
const MIN_ANSWERS = 5;

function describeTag(tag: string): { label: string; href: string; cta: string } | null {
  const [kind, value] = tag.split(":");
  if (kind === "gen") {
    return { label: `Gen ${value} (${GENERATION_REGIONS[Number(value)]})`, href: `/pokedex/study?gen=${value}`, cta: `Study Gen ${value} flashcards` };
  }
  if (kind === "type") {
    const name = value.charAt(0).toUpperCase() + value.slice(1);
    return { label: `${name}-type Pokémon`, href: `/pokedex?type=${value}`, cta: `Browse ${name} types` };
  }
  if (kind === "mod" && value in MODULE_INFO) {
    const info = MODULE_INFO[value as ModuleId];
    return { label: info.title, href: moduleHref(value as ModuleId), cta: `Practice ${info.title}` };
  }
  if (kind === "stat") {
    const label = value === "bst" ? "Base stat totals" : value === "height" ? "Heights" : value === "weight" ? "Weights" : `${STAT_LABELS[value as StatKey]} stats`;
    return { label, href: `/pokedex?sort=${value}`, cta: "See the rankings" };
  }
  return null;
}

export function coachInsights(skills: Record<string, [number, number]>): { weak: Insight[]; strong: Insight[]; overall: number } {
  // Overall accuracy from mode tags (every answer has exactly one).
  let c = 0;
  let n = 0;
  for (const [tag, [ci, ni]] of Object.entries(skills)) {
    if (tag.startsWith("mod:")) {
      c += ci;
      n += ni;
    }
  }
  const overall = n ? c / n : 0.6;
  const alpha = overall * PRIOR_STRENGTH;
  const beta = (1 - overall) * PRIOR_STRENGTH;

  const insights: Insight[] = [];
  for (const [tag, [ci, ni]] of Object.entries(skills)) {
    if (ni < MIN_ANSWERS) continue;
    const meta = describeTag(tag);
    if (!meta) continue;
    insights.push({ tag, ...meta, accuracy: (ci + alpha) / (ni + alpha + beta), answered: ni });
  }
  insights.sort((a, b) => a.accuracy - b.accuracy);
  return {
    weak: insights.filter((i) => i.accuracy < overall - 0.03).slice(0, 3),
    strong: [...insights].reverse().filter((i) => i.accuracy > overall + 0.03).slice(0, 3),
    overall,
  };
}
