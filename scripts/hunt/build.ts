/**
 * Build the Pokémon Hunt answer table.
 *
 *   npx tsx scripts/hunt/build.ts
 *
 * Reads src/data/encounters/*.json, src/data/geo.json, src/data/about-forms.json,
 * src/data/pokedex.json and scripts/hunt/evidence/forms.json. Writes
 * src/data/hunt/answers.json (the table) and src/data/hunt/review.json (everything left
 * out as uncertain, with the reason, and the real places the map is missing).
 */
import fs from "node:fs";
import path from "node:path";
import { buildAnswers, type EncRow, type Inputs } from "./build-lib";

const ROOT = process.cwd();
const read = <T>(p: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")) as T;

export function loadInputs(): Inputs {
  const pokedex = read<{ id: number; slug: string; name: string }[]>("src/data/pokedex.json");
  const encounters = new Map<number, { g: number; rows: EncRow[] }[]>();
  for (const p of pokedex) {
    const f = path.join(ROOT, "src/data/encounters", `${p.id}.json`);
    if (fs.existsSync(f)) encounters.set(p.id, (JSON.parse(fs.readFileSync(f, "utf8")) as { gens: { g: number; rows: EncRow[] }[] }).gens);
  }
  return {
    geo: read("src/data/geo.json"),
    pokedex,
    aboutForms: read("src/data/about-forms.json"),
    encounters,
    evidence: read("scripts/hunt/evidence/forms.json"),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const out = buildAnswers(loadInputs());
  const date = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(ROOT, "src/data/hunt/answers.json"), JSON.stringify({ version: 1, generatedAt: date, entries: out.entries }, null, 1) + "\n");
  fs.writeFileSync(path.join(ROOT, "src/data/hunt/review.json"), JSON.stringify({ generatedAt: date, stats: out.stats, missingPlaces: out.missingPlaces, review: out.review }, null, 1) + "\n");
  console.log(out.stats);
}
