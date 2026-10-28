/**
 * "Which Pokémon Are You?": the trait model.
 *
 * Seven continuous axes, each 0–100 with 50 as the population midpoint: the
 * Big Five (extraversion, agreeableness, conscientiousness, openness and
 * emotional stability, the reverse of neuroticism) plus two axes that matter
 * in the Pokémon world: competitiveness and independence (high) versus
 * loyalty to a trainer or a team (low). Every player and every Pokémon is a
 * point in this space; the match is the nearest Pokémon.
 */

export const AXES = ["extraversion", "agreeableness", "conscientiousness", "openness", "stability", "competitiveness", "independence"] as const;
export type Axis = (typeof AXES)[number];
export type AxisIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Seven scores in AXES order, each 0–100. */
export type Profile = readonly [number, number, number, number, number, number, number];

export interface AxisInfo {
  id: Axis;
  label: string;
  /** What a low score looks like, in-world. */
  low: string;
  /** What a high score looks like. */
  high: string;
}

export const AXIS_INFO: Record<Axis, AxisInfo> = {
  extraversion: { id: "extraversion", label: "Extraversion", low: "Keeps to themselves", high: "Life of the Pokémon Center" },
  agreeableness: { id: "agreeableness", label: "Agreeableness", low: "Blunt and tough", high: "Soft-hearted" },
  conscientiousness: { id: "conscientiousness", label: "Conscientiousness", low: "Wings it", high: "Plans every route" },
  openness: { id: "openness", label: "Openness", low: "Sticks with the familiar", high: "Chases the unknown" },
  stability: { id: "stability", label: "Emotional stability", low: "Feels every crit", high: "Unshakeable" },
  competitiveness: { id: "competitiveness", label: "Competitiveness", low: "Here for the journey", high: "Here to win" },
  independence: { id: "independence", label: "Independence", low: "Loyal to the team", high: "Lone wanderer" },
};

/** A question: an in-world statement loading one axis, keyed + (agreeing raises the score) or −. */
export interface Question {
  id: string;
  axis: Axis;
  key: 1 | -1;
  text: string;
}

/** The five-point answer scale, 1 "Not me at all" to 5 "Totally me". */
export type Answer = 1 | 2 | 3 | 4 | 5;
export const ANSWER_LABELS: Record<Answer, string> = { 1: "Not me at all", 2: "Not really", 3: "Somewhere in between", 4: "Mostly me", 5: "Totally me" };

/** A pooled Pokémon with a hand-set profile and its evidence. */
export interface PooledPokemon {
  id: number;
  slug: string;
  /** The archetype: "The Grinning Prankster". */
  title: string;
  p: Profile;
  /** The one-line rationale: which Pokédex entries, games and episodes the profile rests on. */
  why: string;
  /** The second-person write-up on the result page. */
  blurb: string;
  /** Calibration offset in distance points, tuned so no pooled Pokémon wins too often or too rarely. */
  bias?: number;
}
