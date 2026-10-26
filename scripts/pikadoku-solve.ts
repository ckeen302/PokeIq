/**
 * Prints a solution of a Pikadoku daily for the e2e smoke test (the browser
 * never gets the answers): a no-repeat Pokémon for each cell, and one wrong
 * guess for cell 0. A Normal daily with a committed Master grid uses it, as the
 * server does.
 *
 *   npx tsx scripts/pikadoku-solve.ts 2026-10-23 normal
 */
import dailies from "@/data/pikadoku-dailies.json";
import masters from "@/data/pikadoku-master.json";
import { allFacts } from "@/lib/pikadoku/categories";
import { generateGrid, gridFromIds, type PdkGridIds } from "@/lib/pikadoku/generator";
import { solveGrid } from "@/lib/pikadoku/solve";
import type { PdkDifficulty } from "@/lib/pikadoku/types";

const [date, difficulty = "normal"] = process.argv.slice(2);
const file = dailies as unknown as Record<string, Record<string, PdkGridIds>>;
const master = difficulty === "normal" ? (masters as { date: string; rows: string[]; cols: string[] }[]).find((m) => m.date === date) : undefined;
const grid = gridFromIds(master ?? file[date]?.[difficulty] ?? generateGrid(date, { difficulty: difficulty as PdkDifficulty }));
const pokemonName = (id: number) => allFacts().find((f) => f.id === id)!.name;
const solution = solveGrid(grid.answers);
if (!solution) throw new Error("unsolvable");
const used = new Set(solution.values());
const wrongId = [132, 129, 54, 113, 10, 13].find((id) => !grid.answers[0].includes(id) && !used.has(id))!;
console.log(
  JSON.stringify({
    solution: [...solution].sort((a, b) => a[0] - b[0]).map(([cell, id]) => ({ cell, id, name: pokemonName(id) })),
    wrong: { cell: 0, id: wrongId, name: pokemonName(wrongId) },
  })
);
