/** The results map's colours and picks (shared by the component and its tests). */

export const BEST_COLOR = "#4cbb17";
export const WORST_COLOR = "#ff5a5a";

/** The best and worst rounds of a game by score (none when every round scored the same, or there's only one). */
export function bestAndWorst(scores: readonly number[]): { best: number | null; worst: number | null } {
  if (scores.length < 2) return { best: null, worst: null };
  let best = 0;
  let worst = 0;
  scores.forEach((s, i) => {
    if (s > scores[best]) best = i;
    if (s < scores[worst]) worst = i;
  });
  return scores[best] === scores[worst] ? { best: null, worst: null } : { best, worst };
}
