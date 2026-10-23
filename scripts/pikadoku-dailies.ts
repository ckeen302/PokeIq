/**
 * Pikadoku's daily grids, a year ahead (Easy, Normal and Expert each day).
 *
 *   npm run pikadoku:dailies     # writes src/data/pikadoku-dailies.json
 *
 * Seeded and deterministic. Days up to tomorrow (UTC) are FROZEN: read back
 * from the file and written unchanged. Every grid passes the solvability
 * check (enough answers per cell and a no-repeat 9-Pokémon matching) or the
 * script fails. The same seed also generates days past the file at runtime.
 */
import fs from "node:fs";
import path from "node:path";
import { CONN_LAUNCH_DATE } from "@/lib/connections/types";
import { generateGrid, gridFromIds, type PdkGridIds } from "@/lib/pikadoku/generator";
import { isSolvable } from "@/lib/pikadoku/solve";
import { PDK_DIFFICULTIES, PDK_MIN_ANSWERS, type PdkDifficulty } from "@/lib/pikadoku/types";

const DAYS = 365;
const OUT = path.join(process.cwd(), "src/data/pikadoku-dailies.json");
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

type File = Record<string, Record<PdkDifficulty, PdkGridIds>>;
const old: File = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
const frozenUntil = addDays(new Date().toISOString().slice(0, 10), 1);
const out: File = {};
for (let i = 0; i < DAYS; i++) {
  const date = addDays(CONN_LAUNCH_DATE, i);
  if (old[date] && date <= frozenUntil) {
    out[date] = old[date];
    continue;
  }
  out[date] = {} as Record<PdkDifficulty, PdkGridIds>;
  for (const d of PDK_DIFFICULTIES) {
    const ids = generateGrid(date, { difficulty: d });
    if (!isSolvable(gridFromIds(ids).answers, PDK_MIN_ANSWERS[d])) throw new Error(`unsolvable ${date} ${d}`);
    out[date][d] = ids;
  }
}
fs.writeFileSync(OUT, JSON.stringify(out) + "\n");
console.log(`wrote ${Object.keys(out).length} days to ${OUT}`);
