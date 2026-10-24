/**
 * Solves a PokéConnections grid from its sixteen (or, 5×5, twenty-five) Pokémon ids, using only the
 * public Pokédex data (src/lib/connections/solver.ts).
 *
 *   npx tsx scripts/connections-solve.ts 25 4 7 1 ...
 *
 * Prints every possible solution as JSON: [[[a, b, c, d], ...four groups], ...]
 * (five groups of five on a 5×5 grid).
 * The end-to-end run uses it to race duels without the server ever telling
 * it the answers.
 */
import { solveGrid } from "@/lib/connections/solver";

const ids = process.argv.slice(2).map(Number);
if ((ids.length !== 16 && ids.length !== 25) || ids.some((n) => !Number.isInteger(n) || n <= 0)) {
  console.error("Pass the grid's sixteen (or twenty-five) Pokémon ids.");
  process.exit(1);
}
console.log(JSON.stringify(solveGrid(ids)));
