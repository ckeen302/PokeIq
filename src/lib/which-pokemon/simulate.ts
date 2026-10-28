import { Rng } from "@/lib/rng";
import { AXES, type Answer, type Profile, type Question } from "./types";
import { runQuiz } from "./run";
import { nextStep } from "./run";
import type { MatchResult } from "./match";
import type { Response } from "./questions";
import { POOL } from "./pool";

/**
 * Realistic simulated players, for the balance and stability checks (tests)
 * and the calibration script. Each player has seven latent traits drawn
 * from a correlated normal distribution (Big Five intercorrelations plus
 * sensible links for the two Pokémon axes), a personal acquiescence bias
 * and extremity, and answers each item through its key with response noise.
 */

/** Trait intercorrelations in AXES order: E A C O S K I. */
const CORR: number[][] = [
  [1.0, 0.15, 0.1, 0.25, 0.2, 0.2, -0.3],
  [0.15, 1.0, 0.25, 0.1, 0.2, -0.3, -0.35],
  [0.1, 0.25, 1.0, 0.05, 0.3, 0.2, -0.05],
  [0.25, 0.1, 0.05, 1.0, 0.05, 0.0, 0.2],
  [0.2, 0.2, 0.3, 0.05, 1.0, 0.0, 0.05],
  [0.2, -0.3, 0.2, 0.0, 0.0, 1.0, 0.15],
  [-0.3, -0.35, -0.05, 0.2, 0.05, 0.15, 1.0],
];

/** Cholesky factor of CORR (lower triangular); throws if the matrix isn't positive definite. */
function cholesky(m: number[][]): number[][] {
  const n = m.length;
  const L = m.map(() => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = m[i][j];
      for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k];
      if (i === j) {
        if (sum <= 0) throw new Error("trait correlation matrix is not positive definite");
        L[i][j] = Math.sqrt(sum);
      } else {
        L[i][j] = sum / L[j][j];
      }
    }
  }
  return L;
}
const CHOL = cholesky(CORR);

function normal(rng: Rng): number {
  const u = 1 - rng.next();
  const v = rng.next();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export interface SimPlayer {
  /** Latent traits, standard normal, correlated. */
  traits: number[];
  /** Tendency to agree with any statement. */
  acquiescence: number;
  /** How readily they use the ends of the scale. */
  extremity: number;
}

export function drawPlayer(rng: Rng): SimPlayer {
  const z = AXES.map(() => normal(rng));
  const traits = CHOL.map((row) => row.reduce((s, l, k) => s + l * z[k], 0));
  return { traits, acquiescence: normal(rng) * 0.3, extremity: 0.7 + rng.next() * 0.7 };
}

/** One answer: the keyed trait through the person's style, plus item noise, onto 1–5. */
export function answerAs(player: SimPlayer, q: Question, rng: Rng): Answer {
  const axis = AXES.indexOf(q.axis);
  const latent = q.key * player.traits[axis] * 1.1 * player.extremity + player.acquiescence + normal(rng) * 0.7;
  return Math.max(1, Math.min(5, Math.round(3 + latent))) as Answer;
}

export interface SimRun {
  questions: Question[];
  responses: Response[];
  result: MatchResult;
}

/** A full run by a fresh simulated player. */
export function simulateRun(rng: Rng, player = drawPlayer(rng)): SimRun {
  return runQuiz(rng.int(0, 2 ** 31), (q) => answerAs(player, q, rng));
}

/** The same questions answered again with small slips: each answer moves one step with probability `p`. */
export function perturbRun(run: SimRun, rng: Rng, p = 0.3): MatchResult {
  const questions = run.questions.slice(0, run.responses.length);
  const responses: Response[] = run.responses.map((r) => {
    if (!rng.chance(p)) return r;
    const answer = Math.max(1, Math.min(5, r.answer + (rng.chance(0.5) ? 1 : -1))) as Answer;
    return { id: r.id, answer };
  });
  // Tie-breakers may differ on the retake: replay the step function from the base run's questions.
  const base = questions.slice(0, Math.min(questions.length, responses.length));
  const replay: Response[] = [];
  for (;;) {
    const step = nextStep(base, replay);
    if (step.done) return step.result;
    const prior = responses.find((r) => r.id === step.question.id);
    replay.push(prior ?? { id: step.question.id, answer: 3 });
  }
}

export interface BalanceReport {
  runs: number;
  /** Wins per pooled Pokémon id. */
  wins: Map<number, number>;
  maxShare: number;
  minShare: number;
  /** Share of retakes whose top match stayed within the original top three. */
  stability: number;
  scores: Profile[];
}

/** `runs` simulated players, each retaken once with slips. Seeded. */
export function simulateBalance(runs: number, seed = "which-pokemon", retakeP = 0.3): BalanceReport {
  const rng = new Rng(seed);
  const wins = new Map<number, number>(POOL.map((p) => [p.id, 0]));
  let stable = 0;
  const scores: Profile[] = [];
  for (let i = 0; i < runs; i++) {
    const run = simulateRun(rng);
    wins.set(run.result.top.pokemon.id, (wins.get(run.result.top.pokemon.id) ?? 0) + 1);
    scores.push(run.result.scores);
    const again = perturbRun(run, rng, retakeP);
    const family = new Set([run.result.top.pokemon.id, ...run.result.runnersUp.map((m) => m.pokemon.id)]);
    if (family.has(again.top.pokemon.id)) stable++;
  }
  const shares = [...wins.values()].map((w) => w / runs);
  return { runs, wins, maxShare: Math.max(...shares), minShare: Math.min(...shares), stability: stable / runs, scores };
}
