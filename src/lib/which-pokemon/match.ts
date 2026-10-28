import { AXES, AXIS_INFO, type Axis, type PooledPokemon, type Profile } from "./types";
import { DEEP_CUTS, POOL, speciesInfo, type SpeciesInfo } from "./pool";

/**
 * Matching, Open-Source Psychometrics style: the player is a point in the
 * seven-axis space and the match is the pooled Pokémon nearest to it, with
 * each axis weighted by how extreme the player is on it (a score of 0 or 100
 * counts double, 50 counts once). A small per-Pokémon calibration bias, tuned
 * by simulation (scripts/which-pokemon-tune.ts), keeps every pooled Pokémon
 * reachable and none too common. Everything runs client-side.
 */

export interface Match {
  pokemon: PooledPokemon;
  /** 0–100: 100 − the weighted distance (bias included), so runners-up read as "87% match". */
  similarity: number;
}

export interface DeepCut {
  species: SpeciesInfo;
  similarity: number;
}

export interface MatchResult {
  scores: Profile;
  top: Match;
  runnersUp: [Match, Match];
  /** The nearest species outside the pool. */
  deepCut: DeepCut;
  /** The complementary profile: same heart, opposite habits. */
  partner: Match;
  /** Opposite on competitiveness and agreeableness, alike elsewhere. */
  rival: Match;
}

/** Axis weights for a player: 1 at the midpoint, 2 at either extreme. */
export function axisWeights(scores: Profile): number[] {
  return scores.map((s) => 1 + Math.abs(s - 50) / 50);
}

/** Weighted RMS distance in points (0–100). */
export function distance(a: Profile, b: Profile, weights: readonly number[]): number {
  let sum = 0;
  let wsum = 0;
  for (let i = 0; i < 7; i++) {
    sum += weights[i] * (a[i] - b[i]) ** 2;
    wsum += weights[i];
  }
  return Math.sqrt(sum / wsum);
}

const clampPct = (n: number) => Math.max(0, Math.min(100, Math.round(n)));
const UNIT = [1, 1, 1, 1, 1, 1, 1];

/** Pool members ranked for a profile, nearest first (bias included). */
export function rankPool(scores: Profile, weights = axisWeights(scores), candidates: readonly PooledPokemon[] = POOL): Match[] {
  return candidates
    .map((pokemon) => ({ pokemon, d: distance(scores, pokemon.p, weights) + (pokemon.bias ?? 0) }))
    .sort((x, y) => x.d - y.d || x.pokemon.id - y.pokemon.id)
    .map(({ pokemon, d }) => ({ pokemon, similarity: clampPct(100 - d) }));
}

function nearestTo(target: Profile, exclude: Set<number>): Match {
  return rankPool(target, UNIT, POOL.filter((p) => !exclude.has(p.id)))[0];
}

/** A partner's ideal profile: alike on heart (agreeableness, openness, stability, conscientiousness), opposite on habits (extraversion, competitiveness, independence). */
export function partnerTarget(scores: Profile): Profile {
  const [e, a, c, o, s, k, i] = scores;
  return [100 - e, a, c, o, s, 100 - k, 100 - i];
}

/** A rival's ideal profile: opposite on competitiveness and agreeableness, alike everywhere else. */
export function rivalTarget(scores: Profile): Profile {
  const [e, a, c, o, s, k, i] = scores;
  return [e, 100 - a, c, o, s, 100 - k, i];
}

/** The nearest species outside the pool (no bias: the light profiles are all on one scale). */
export function deepCutFor(scores: Profile, weights = axisWeights(scores)): DeepCut {
  let best: SpeciesInfo | null = null;
  let bestD = Infinity;
  for (const species of DEEP_CUTS) {
    const d = distance(scores, species.p, weights);
    if (d < bestD) {
      bestD = d;
      best = species;
    }
  }
  return { species: best!, similarity: clampPct(100 - bestD) };
}

/**
 * The full result for a player's scores. `pin` keeps a given pooled Pokémon
 * as the top match (a shared link names its Pokémon in the URL; if the pool
 * is retuned later the page still agrees with its own address).
 */
export function matchProfile(scores: Profile, pin?: PooledPokemon): MatchResult {
  const weights = axisWeights(scores);
  let ranked = rankPool(scores, weights);
  if (pin && ranked[0].pokemon.id !== pin.id) {
    const pinned = ranked.find((m) => m.pokemon.id === pin.id) ?? { pokemon: pin, similarity: clampPct(100 - distance(scores, pin.p, weights)) };
    ranked = [pinned, ...ranked.filter((m) => m.pokemon.id !== pin.id)];
  }
  const [top, second, third] = ranked;
  const taken = new Set([top.pokemon.id, second.pokemon.id, third.pokemon.id]);
  const partner = nearestTo(partnerTarget(scores), taken);
  taken.add(partner.pokemon.id);
  const rival = nearestTo(rivalTarget(scores), taken);
  return { scores, top, runnersUp: [second, third], deepCut: deepCutFor(scores, weights), partner, rival };
}

// ---------------------------------------------------------------------------
// Two players
// ---------------------------------------------------------------------------

/** Weights for compatibility: alike on heart counts fully, differing on habits is fine. */
const COMPAT_WEIGHTS = [0.5, 1, 1, 1, 1, 0.5, 0.5];

export interface Compatibility {
  /** 0–100. */
  percent: number;
  /** The axis the two agree on most, and the one they differ on most. */
  closest: Axis;
  farthest: Axis;
  label: string;
}

export function compatibility(a: Profile, b: Profile): Compatibility {
  let sum = 0;
  let wsum = 0;
  let closest = 0;
  let farthest = 0;
  for (let i = 0; i < 7; i++) {
    const gap = Math.abs(a[i] - b[i]);
    sum += COMPAT_WEIGHTS[i] * gap;
    wsum += COMPAT_WEIGHTS[i];
    if (gap < Math.abs(a[closest] - b[closest])) closest = i;
    if (gap > Math.abs(a[farthest] - b[farthest])) farthest = i;
  }
  const percent = clampPct(100 - sum / wsum);
  const label = percent >= 85 ? "Two halves of one team" : percent >= 70 ? "A natural double battle pair" : percent >= 55 ? "Different routes, same league" : percent >= 40 ? "Rivals with potential" : "Opposite ends of the Pokédex";
  return { percent, closest: AXES[closest], farthest: AXES[farthest], label };
}

/** The two axes where the player most resembles a Pokémon's profile (both away from the midpoint, on the same side). */
export function sharedTraits(scores: Profile, profile: Profile, count = 2): Axis[] {
  return AXES.map((axis, i) => {
    const same = Math.sign(scores[i] - 50) === Math.sign(profile[i] - 50);
    const depth = same ? Math.min(Math.abs(scores[i] - 50), Math.abs(profile[i] - 50)) : -1;
    return { axis, depth: depth - Math.abs(scores[i] - profile[i]) / 4 };
  })
    .sort((x, y) => y.depth - x.depth)
    .slice(0, count)
    .map((t) => t.axis);
}

/** "high openness" / "low competitiveness": the pole of an axis a score sits on. */
export function traitPhrase(axis: Axis, score: number): string {
  const info = AXIS_INFO[axis];
  return score >= 50 ? info.high.toLowerCase() : info.low.toLowerCase();
}

// ---------------------------------------------------------------------------
// The result in a link
// ---------------------------------------------------------------------------

const VERSION = "1";
const B36 = (n: number) => n.toString(36).padStart(2, "0");

/** Seven scores as 15 URL-safe characters: a version digit, then two base-36 digits per axis. */
export function encodeScores(scores: Profile): string {
  return VERSION + scores.map((s) => B36(Math.max(0, Math.min(100, Math.round(s))))).join("");
}

/** The scores back, or null for anything that isn't a well-formed payload. */
export function decodeScores(raw: unknown): Profile | null {
  if (typeof raw !== "string" || !/^1[0-9a-z]{14}$/.test(raw)) return null;
  const out: number[] = [];
  for (let i = 1; i < 15; i += 2) {
    const n = parseInt(raw.slice(i, i + 2), 36);
    if (!Number.isInteger(n) || n > 100) return null;
    out.push(n);
  }
  return out as unknown as Profile;
}

export const QUIZ_PATH = "/quiz/which-pokemon";

/** The result page for a match, with the player's scores in the fragment (static page, personal result). */
export const resultPath = (slug: string, scores: Profile) => `${QUIZ_PATH}/${slug}#r=${encodeScores(scores)}`;

/** The compare page: one result invites a friend, two show side by side. */
export function comparePath(a: Profile, b?: Profile): string {
  return `${QUIZ_PATH}/compare#a=${encodeScores(a)}${b ? `&b=${encodeScores(b)}` : ""}`;
}

/** The story-sized share card for a result. */
export const cardPath = (scores: Profile) => `${QUIZ_PATH}/card/${encodeScores(scores)}`;

/** The scores named in a page's fragment: "#r=…" or "#a=…&b=…". */
export function parseFragment(hash: string): Record<string, Profile> {
  const out: Record<string, Profile> = {};
  for (const part of hash.replace(/^#/, "").split("&")) {
    const [key, value] = part.split("=");
    const scores = decodeScores(value);
    if (/^[a-z]$/.test(key ?? "") && scores) out[key] = scores;
  }
  return out;
}

/** The species name of a pooled Pokémon. */
export const nameOf = (p: PooledPokemon): string => speciesInfo(p.id)?.name ?? p.slug;
export const typesOf = (p: PooledPokemon): string[] => speciesInfo(p.id)?.types ?? [];
