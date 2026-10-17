/**
 * PokéIQ rating model.
 *
 * Players and questions live on one Elo-style scale. P(correct) follows a
 * logistic curve in (player − item) with a guessing floor — on a 4-option
 * question you're right 25% of the time even knowing nothing (the "3PL"
 * model from item response theory, with the guessing parameter fixed at
 * 1/options).
 *
 * A run's PokéIQ is the maximum-likelihood player rating given the items
 * answered, with a weak prior toward the population mean so 10/10 doesn't
 * diverge to infinity. It's mapped to an IQ-style scale (mean 100, SD 15).
 */

export const MEAN_RATING = 1200;
const RATING_SD = 200;
/** Gaussian prior on player rating — keeps short perfect runs finite. */
const PRIOR_SD = 350;
const LOGISTIC_SCALE = Math.LN10 / 400;

export interface AnsweredItem {
  correct: boolean;
  rating: number;
  options: number;
}

export function pCorrect(player: number, item: number, options: number): number {
  const guess = options > 1 ? 1 / options : 0;
  const knows = 1 / (1 + Math.pow(10, (item - player) / 400));
  return guess + (1 - guess) * knows;
}

/** MAP estimate of player rating via bisection on the score equation. */
export function performanceRating(items: readonly AnsweredItem[]): number {
  if (items.length === 0) return MEAN_RATING;
  // d/dR log-likelihood is monotone decreasing in R, so bisection is safe.
  const gradient = (r: number) => {
    let g = (MEAN_RATING - r) / (PRIOR_SD * PRIOR_SD);
    for (const it of items) {
      const guess = it.options > 1 ? 1 / it.options : 0;
      const knows = 1 / (1 + Math.pow(10, (it.rating - r) / 400));
      const p = guess + (1 - guess) * knows;
      const dp = (1 - guess) * knows * (1 - knows) * LOGISTIC_SCALE; // ∂p/∂r
      g += it.correct ? dp / p : -dp / (1 - p);
    }
    return g;
  };
  let lo = 0;
  let hi = 3000;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (gradient(mid) > 0) lo = mid;
    else hi = mid;
  }
  return Math.round((lo + hi) / 2);
}

export function ratingToIQ(rating: number): number {
  const iq = 100 + ((rating - MEAN_RATING) / RATING_SD) * 15;
  return Math.round(Math.min(180, Math.max(55, iq)));
}

/** Blend a run's performance into a player's long-running rating. */
export function updatePlayerRating(current: number | null, performance: number, itemCount: number): number {
  if (current === null) return performance;
  const weight = Math.min(0.5, itemCount / 40);
  return Math.round(current + (performance - current) * weight);
}

export function iqTitle(iq: number): string {
  if (iq >= 145) return "Pokémon Professor";
  if (iq >= 130) return "Champion";
  if (iq >= 118) return "Elite Four";
  if (iq >= 108) return "Gym Leader";
  if (iq >= 95) return "Ace Trainer";
  if (iq >= 85) return "Trainer";
  return "Youngster";
}

// ---------------------------------------------------------------------------
// Computerized adaptive testing (CAT) helpers
// ---------------------------------------------------------------------------

/**
 * Fisher information an item carries about a player at rating θ:
 *   I(θ) = (∂P/∂θ)² / (P(1−P))
 * Highest when the item's difficulty sits near θ, so picking the
 * max-information item each step is what lets an adaptive test converge in
 * ~20 questions instead of ~60 fixed ones.
 */
export function itemInformation(theta: number, item: number, options: number): number {
  const guess = options > 1 ? 1 / options : 0;
  const knows = 1 / (1 + Math.pow(10, (item - theta) / 400));
  const p = guess + (1 - guess) * knows;
  const dp = (1 - guess) * knows * (1 - knows) * LOGISTIC_SCALE;
  return (dp * dp) / (p * (1 - p));
}

/** Posterior standard error of a rating estimate (test information + prior). */
export function ratingStandardError(theta: number, items: readonly AnsweredItem[]): number {
  const info = items.reduce((sum, it) => sum + itemInformation(theta, it.rating, it.options), 1 / (PRIOR_SD * PRIOR_SD));
  return Math.round(1 / Math.sqrt(info));
}

/** 90% credible interval for a rating, expressed on the PokéIQ scale. */
export function iqInterval(theta: number, se: number): [number, number] {
  return [ratingToIQ(theta - 1.645 * se), ratingToIQ(theta + 1.645 * se)];
}
