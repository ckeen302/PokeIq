import { knowledgePercentile, scaledOf, type CognitiveScores } from "./scoring";
import { COG_SECTIONS, DOMAIN_INFO, type CogSection, type Domain } from "./types";

/**
 * A finished Cognitive PokéIQ test, as kept in local progress and shown on
 * the trainer card: the composite, the four section scores and, when the
 * knowledge section was taken, its PokéIQ (the existing rating's scale).
 */
export interface CognitiveRecord {
  v: 1;
  /** When it was finished (ms since the epoch). */
  at: number;
  /** Cognitive PokéIQ (mean 100, SD 15) and its percentile. */
  score: number;
  percentile: number;
  sections: Record<CogSection, { raw: number; percentile: number; scaled: number }>;
  /** The knowledge section's PokéIQ for this run. */
  knowledge?: number;
}

export function cognitiveRecord(scores: CognitiveScores, knowledge: number | null, at = Date.now()): CognitiveRecord {
  return {
    v: 1,
    at,
    score: scores.composite.score,
    percentile: scores.composite.percentile,
    sections: { fluid: scores.sections.fluid, memory: scores.sections.memory, speed: scores.sections.speed, spatial: scores.sections.spatial },
    ...(knowledge !== null && { knowledge }),
  };
}

export interface DomainBar {
  domain: Domain;
  label: string;
  scaled: number;
  percentile: number;
}

/** The five bars of the profile, knowledge last (or missing when the section wasn't taken). */
export function profileBars(r: CognitiveRecord): DomainBar[] {
  const bars: DomainBar[] = COG_SECTIONS.map((k) => ({ domain: k, label: DOMAIN_INFO[k].short, scaled: r.sections[k].scaled, percentile: r.sections[k].percentile }));
  if (r.knowledge !== undefined) {
    const percentile = knowledgePercentile(r.knowledge);
    bars.push({ domain: "knowledge", label: DOMAIN_INFO.knowledge.short, scaled: scaledOf(percentile), percentile });
  }
  return bars;
}

export function cognitiveTitle(score: number): string {
  if (score >= 130) return "Exceptional";
  if (score >= 120) return "Superior";
  if (score >= 110) return "High average";
  if (score >= 90) return "Average";
  if (score >= 80) return "Low average";
  return "Below average";
}

const DOMAIN_WORDS: Record<CogSection, { strength: string; weakness: string }> = {
  fluid: { strength: "spotting the rule behind a pattern", weakness: "finding the rule behind a pattern" },
  memory: { strength: "holding a sequence or a sum in mind", weakness: "holding several things in mind at once" },
  speed: { strength: "quick, accurate scanning", weakness: "scanning quickly without slipping" },
  spatial: { strength: "turning and routing things in your mind's eye", weakness: "picturing things turned or stacked" },
};

/** Strengths and weaknesses in plain words: sections clearly above or below the trainer's own composite. */
export function profileWords(r: CognitiveRecord): { strengths: string[]; weaknesses: string[]; even: boolean } {
  const strengths: string[] = [];
  const weaknesses: string[] = [];
  for (const k of COG_SECTIONS) {
    const gap = r.sections[k].scaled - r.score;
    if (gap >= 8) strengths.push(DOMAIN_WORDS[k].strength);
    else if (gap <= -8) weaknesses.push(DOMAIN_WORDS[k].weakness);
  }
  return { strengths, weaknesses, even: strengths.length === 0 && weaknesses.length === 0 };
}
