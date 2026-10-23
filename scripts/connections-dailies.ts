/**
 * PokéConnections' daily puzzles, a year ahead.
 *
 *   npm run connections:dailies                   # writes src/data/connections-dailies.json
 *   npx tsx scripts/connections-dailies.ts --print 20 # prints the first 20, to read through
 *
 * Seeded and deterministic: the same code and data always write the same
 * file. Each day's puzzle avoids the categories of the week before and the
 * Pokémon of the three days before, and every one passes validatePuzzle
 * (each of the 16 Pokémon fits exactly one group) or the script fails.
 *
 * Days up to tomorrow (UTC) are FROZEN: they are read back from the file and
 * written out unchanged, so a played daily never changes even when the
 * categories do. Only later days are regenerated. To extend the run, raise
 * DAYS.
 */
import fs from "node:fs";
import path from "node:path";
import { CONN_LAUNCH_DATE, connNumber } from "@/lib/connections/types";
import { generatePuzzle, herringsOf, validatePuzzle, type Puzzle } from "@/lib/connections/generator";
import { categoryOf } from "@/lib/connections/categories";
import { factsOf } from "@/lib/connections/facts";

const DAYS = 365;
const OUT = path.join(process.cwd(), "src/data/connections-dailies.json");

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The days that must never change: every date up to tomorrow (UTC, so a
 * player a day ahead of UTC is covered), read back from the file as it is.
 * Raise it with --freeze-through=YYYY-MM-DD, never lower it.
 */
function frozenPuzzles(): Puzzle[] {
  if (!fs.existsSync(OUT)) return [];
  const arg = process.argv.find((a) => a.startsWith("--freeze-through="))?.slice("--freeze-through=".length);
  const through = arg ?? addDays(new Date().toISOString().slice(0, 10), 1);
  const file = JSON.parse(fs.readFileSync(OUT, "utf8")) as { start: string; puzzles: { g: (string | number)[][]; t: number[] }[] };
  const keep = Math.max(0, Math.round((Date.parse(`${through}T00:00:00Z`) - Date.parse(`${file.start}T00:00:00Z`)) / 86_400_000) + 1);
  return file.puzzles.slice(0, keep).map((e) => ({
    groups: e.g.map(([category, ...members]) => ({ category: String(category), members: members.map(Number) })),
    tiles: e.t,
  }));
}

function build(days: number, frozen: Puzzle[] = []): Puzzle[] {
  const puzzles: Puzzle[] = frozen.slice(0, days);
  for (let i = puzzles.length; i < days; i++) {
    const avoidCategories = new Set(puzzles.slice(-7).flatMap((p) => p.groups.map((g) => g.category)));
    const avoidPokemon = new Set(puzzles.slice(-3).flatMap((p) => p.tiles));
    const puzzle = generatePuzzle(`daily:${addDays(CONN_LAUNCH_DATE, i)}`, { avoidCategories, avoidPokemon, candidates: 16 });
    const errors = validatePuzzle(puzzle);
    if (errors.length) throw new Error(`Day ${i + 1}: ${errors.join("; ")}`);
    puzzles.push(puzzle);
  }
  return puzzles;
}

function describe(p: Puzzle, date: string): string {
  const colours = ["YELLOW", "GREEN ", "BLUE  ", "PURPLE"];
  const lines = [`#${connNumber(date)} ${date}`];
  p.groups.forEach((g, i) => {
    const c = categoryOf(g.category);
    lines.push(`  ${colours[i]} ${c.label}: ${g.members.map((id) => `${factsOf(id).name} (${c.why(factsOf(id))})`).join(", ")}`);
    for (const h of herringsOf(p, i)) lines.push(`         herring: ${factsOf(h.id).name}: ${h.reason}`);
  });
  return lines.join("\n");
}

const printAt = process.argv.indexOf("--print");
if (printAt >= 0) {
  const n = Number(process.argv[printAt + 1] ?? 20);
  build(n).forEach((p, i) => console.log(describe(p, addDays(CONN_LAUNCH_DATE, i))));
} else {
  const puzzles = build(DAYS, frozenPuzzles());
  const file = {
    about: "PokéConnections' daily puzzles from scripts/connections-dailies.ts: day 1 is `start`. Groups are easiest first (yellow, green, blue, purple); `t` is the grid's starting order. Server-only: these are the answers.",
    start: CONN_LAUNCH_DATE,
    puzzles: puzzles.map((p) => ({ g: p.groups.map((g) => [g.category, ...g.members]), t: p.tiles })),
  };
  fs.writeFileSync(OUT, `${JSON.stringify(file)}\n`);
  const used = new Map<string, number>();
  for (const p of puzzles) for (const g of p.groups) used.set(g.category, (used.get(g.category) ?? 0) + 1);
  console.log(`Wrote ${puzzles.length} puzzles to ${path.relative(process.cwd(), OUT)} (${used.size} categories used).`);
}
