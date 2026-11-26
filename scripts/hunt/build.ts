/**
 * Build the Pokémon Hunt answer table.
 *
 *   npx tsx scripts/hunt/build.ts
 *
 * Reads src/data/encounters/*.json, src/data/geo.json, src/data/about-forms.json,
 * src/data/pokedex.json, src/data/pokedex-details.json (types), scripts/hunt/evidence/forms.json and scripts/hunt/evidence/dens.json. Writes
 * src/data/hunt/answers.json (the table) and src/data/hunt/review.json (everything left
 * out as uncertain, with the reason, and the real places the map is missing).
 */
import fs from "node:fs";
import path from "node:path";
import { buildAnswers, type EncRow, type Inputs } from "./build-lib";

const ROOT = process.cwd();
const read = <T>(p: string): T => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")) as T;

export function loadInputs(): Inputs {
  const pokedex = read<{ id: number; slug: string; name: string; gen: number; types: string[]; legendary: boolean; mythical: boolean }[]>("src/data/pokedex.json").map(({ id, slug, name, gen, types, legendary, mythical }) => ({ id, slug, name, gen, types, legendary, mythical }));
  // Each form's types, by its art id (Alolan Meowth is dark).
  const details = read<Record<string, { forms?: { id: number; types?: string[] }[] }>>("src/data/pokedex-details.json");
  const formTypes: Record<string, Record<string, string[]>> = {};
  for (const [dex, d] of Object.entries(details)) for (const f of d.forms ?? []) if (f.types?.length) (formTypes[dex] ??= {})[String(f.id)] = f.types;
  const encounters = new Map<number, { g: number; rows: EncRow[] }[]>();
  for (const p of pokedex) {
    const f = path.join(ROOT, "src/data/encounters", `${p.id}.json`);
    if (fs.existsSync(f)) encounters.set(p.id, (JSON.parse(fs.readFileSync(f, "utf8")) as { gens: { g: number; rows: EncRow[] }[] }).gens);
  }
  return {
    geo: read("src/data/geo.json"),
    pokedex,
    formTypes,
    aboutForms: read("src/data/about-forms.json"),
    encounters,
    evidence: read("scripts/hunt/evidence/forms.json"),
    agreed: fs.existsSync(path.join(ROOT, "scripts/hunt/evidence/agreed.json")) ? read<{ agreed: Inputs["agreed"] }>("scripts/hunt/evidence/agreed.json").agreed : {},
    dens: fs.existsSync(path.join(ROOT, "scripts/hunt/evidence/dens.json")) ? read<{ dens: Inputs["dens"] }>("scripts/hunt/evidence/dens.json").dens : {},
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const out = buildAnswers(loadInputs());
  const date = new Date().toISOString().slice(0, 10);
  // One entry per line: small diffs, still one JSON document.
  const lines = (key: string, list: unknown[]) => `"${key}":[\n${list.map((x) => JSON.stringify(x)).join(",\n")}\n]`;
  fs.writeFileSync(path.join(ROOT, "src/data/hunt/answers.json"), `{"version":1,"generatedAt":"${date}",\n${lines("entries", out.entries)}}\n`);
  fs.writeFileSync(path.join(ROOT, "src/data/hunt/review.json"), `{"generatedAt":"${date}","stats":${JSON.stringify(out.stats)},\n${lines("missingPlaces", out.missingPlaces)},\n${lines("dropped", out.dropped)},\n"excludedAt":${JSON.stringify(out.excludedAt)},\n${lines("review", out.review)}}\n`);
  console.log(out.stats);
}
