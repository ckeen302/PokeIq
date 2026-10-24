/**
 * Generates 5×5 PokéConnections puzzles (default 50 per difficulty), checks
 * each one is fair (validatePuzzle: no tile fits two groups) and has exactly
 * one solution (solveGrid finds one split, not two), and reports the time
 * per puzzle (p50 / p95 / max) and how often the search had to retry.
 *
 *   npx tsx scripts/connections-5x5.ts [perDifficulty=50]
 *
 * Exits 1 if any puzzle fails.
 */
import { DIFFICULTY_BANDS_5, generatePuzzle, validatePuzzle, type GenStats } from "@/lib/connections/generator";
import { solveGrid } from "@/lib/connections/solver";
import { guessKey } from "@/lib/connections/types";

const per = Number(process.argv[2] ?? 50);
const pct = (xs: number[], p: number) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)];
let failures = 0;
const all: number[] = [];
const total: GenStats = { sets: 0, fills: 0, invalid: 0, ambiguous: 0 };

for (const difficulty of Object.keys(DIFFICULTY_BANDS_5) as (keyof typeof DIFFICULTY_BANDS_5)[]) {
  const times: number[] = [];
  const stats: GenStats = { sets: 0, fills: 0, invalid: 0, ambiguous: 0 };
  let bad = 0;
  for (let i = 0; i < per; i++) {
    const t0 = performance.now();
    const puzzle = generatePuzzle(`script5:${difficulty}:${i}`, { size: 5, difficulty, stats });
    times.push(performance.now() - t0);
    const errors = validatePuzzle(puzzle);
    const solutions = solveGrid(puzzle.tiles);
    const mine = puzzle.groups.map((g) => guessKey(g.members)).sort().join("|");
    const unique = solutions.length === 1 && solutions[0].map((g) => guessKey(g)).sort().join("|") === mine;
    if (errors.length || !unique || puzzle.tiles.length !== 25) {
      bad++;
      console.error(`FAIL ${difficulty} #${i}: ${errors.join("; ") || `${solutions.length} solutions`}`);
    }
  }
  failures += bad;
  all.push(...times);
  for (const k of Object.keys(total) as (keyof GenStats)[]) total[k] += stats[k];
  console.log(
    `${difficulty.padEnd(6)} n=${per} fail=${bad} p50=${pct(times, 50).toFixed(0)}ms p95=${pct(times, 95).toFixed(0)}ms max=${Math.max(...times).toFixed(0)}ms | sets/puzzle=${(stats.sets / per).toFixed(1)} fills/puzzle=${(stats.fills / per).toFixed(1)} invalid=${((100 * stats.invalid) / Math.max(1, stats.fills)).toFixed(1)}% ambiguous=${((100 * stats.ambiguous) / Math.max(1, stats.fills)).toFixed(1)}%`
  );
}
console.log(
  `ALL    n=${all.length} fail=${failures} p50=${pct(all, 50).toFixed(0)}ms p95=${pct(all, 95).toFixed(0)}ms max=${Math.max(...all).toFixed(0)}ms | fills rejected: invalid ${((100 * total.invalid) / Math.max(1, total.fills)).toFixed(1)}%, ambiguous ${((100 * total.ambiguous) / Math.max(1, total.fills)).toFixed(1)}% of ${total.fills}`
);
process.exit(failures ? 1 : 0);
