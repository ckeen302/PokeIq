/**
 * Choosing which attempts of a field event a broadcast shows, and how
 * long: a real competition has more attempts than a viewer wants to watch,
 * so the show keeps the ones that matter (the winning attempt, every new
 * lead, the medallists' best, a contender's foul) at full length with a
 * replay for the best, and lets the rest go by short or as numbers on the
 * board, within a time budget. Pure.
 */

export interface Attempt {
  /** Chronological index. */
  i: number;
  key: string;
  round: number;
  /** The mark (null: a foul or a failure). */
  mark: number | null;
  /** Higher is more worth showing. */
  score: number;
}

export type Cut = "full" | "short" | "skip";

export interface Pick {
  a: Attempt;
  cut: Cut;
  replay: boolean;
  /** It took the lead. */
  lead: boolean;
}

/**
 * Scores attempts in order: the winning attempt, a new lead, the
 * medallists' marks and fouls, then the rest.
 */
export function scoreAttempts(list: Omit<Attempt, "score">[], podium: string[], better: (a: number, b: number) => boolean): { attempts: Attempt[]; leads: Set<number>; winning: number } {
  let best: number | null = null;
  const leads = new Set<number>();
  const winnerKey = podium[0];
  let winning = -1, winMark: number | null = null;
  for (const a of list) {
    if (a.key === winnerKey && a.mark != null && (winMark == null || better(a.mark, winMark))) { winMark = a.mark; winning = a.i; }
  }
  const attempts = list.map((a) => {
    let score = 1;
    if (a.mark != null && (best == null || better(a.mark, best))) { best = a.mark; leads.add(a.i); score += 6; }
    if (podium.includes(a.key)) score += a.mark != null ? 3 - podium.indexOf(a.key) : 1.5;
    if (a.i === winning) score += 10;
    if (a.round === 1) score += 0.5;
    return { ...a, score };
  });
  return { attempts, leads, winning };
}

export type Cost = { full: number; short: number; replay: number } | ((a: Attempt, cut: "full" | "short" | "replay") => number);

/**
 * Picks cuts within a budget (s): what a full attempt, a short one and a
 * replay cost, as fixed seconds or worked out per attempt (a giant's
 * flight takes longer than a person's).
 */
export function pickAttempts(scored: { attempts: Attempt[]; leads: Set<number>; winning: number }, budget: number, costs: Cost): Pick[] {
  const { attempts, leads, winning } = scored;
  const cost = typeof costs === "function" ? costs : (_a: Attempt, k: "full" | "short" | "replay") => costs[k];
  const picks: Pick[] = attempts.map((a) => ({ a, cut: "skip", replay: false, lead: leads.has(a.i) }));
  let left = budget;
  // The winning attempt, full, with its replay; then the rest by score: full while the budget lasts, then short.
  const byScore = [...picks].sort((p, q) => q.a.score - p.a.score || p.a.i - q.a.i);
  for (const p of byScore) {
    if (p.a.i === winning) { p.cut = "full"; p.replay = true; left -= cost(p.a, "full") + cost(p.a, "replay"); }
  }
  for (const p of byScore) {
    if (p.cut !== "skip") continue;
    if (p.a.score >= 6 && left >= cost(p.a, "full")) { p.cut = "full"; left -= cost(p.a, "full"); }
  }
  for (const p of byScore) {
    if (p.cut !== "skip") continue;
    if (left >= cost(p.a, "short")) { p.cut = "short"; left -= cost(p.a, "short"); }
  }
  return picks;
}
