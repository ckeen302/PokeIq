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

export type CognitiveBand = "exceptional" | "superior" | "highAverage" | "average" | "lowAverage" | "below";
const BAND_TITLE: Record<CognitiveBand, string> = {
  exceptional: "Exceptional",
  superior: "Superior",
  highAverage: "High average",
  average: "Average",
  lowAverage: "Low average",
  below: "Below average",
};

/** The score's band (the key of its title in the page's language). */
export function cognitiveBand(score: number): CognitiveBand {
  if (score >= 130) return "exceptional";
  if (score >= 120) return "superior";
  if (score >= 110) return "highAverage";
  if (score >= 90) return "average";
  if (score >= 80) return "lowAverage";
  return "below";
}

export function cognitiveTitle(score: number): string {
  return BAND_TITLE[cognitiveBand(score)];
}

const DOMAIN_WORDS: Record<CogSection, { strength: string; weakness: string }> = {
  fluid: { strength: "spotting the rule behind a pattern", weakness: "finding the rule behind a pattern" },
  memory: { strength: "holding a sequence or a sum in mind", weakness: "holding several things in mind at once" },
  speed: { strength: "quick, accurate scanning", weakness: "scanning quickly without slipping" },
  spatial: { strength: "turning and routing things in your mind's eye", weakness: "picturing things turned or stacked" },
};

/** Strengths and weaknesses in plain words: sections clearly above or below the trainer's own composite. */
export function profileWords(r: CognitiveRecord): { strengths: string[]; weaknesses: string[]; even: boolean; strong: CogSection[]; weak: CogSection[] } {
  const strong: CogSection[] = [];
  const weak: CogSection[] = [];
  for (const k of COG_SECTIONS) {
    const gap = r.sections[k].scaled - r.score;
    if (gap >= 8) strong.push(k);
    else if (gap <= -8) weak.push(k);
  }
  return {
    strengths: strong.map((k) => DOMAIN_WORDS[k].strength),
    weaknesses: weak.map((k) => DOMAIN_WORDS[k].weakness),
    even: strong.length === 0 && weak.length === 0,
    strong,
    weak,
  };
}
