/**
 * An independent PokéAPI snapshot for Pokédle's clue-accuracy test.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/pokedle-pokeapi-snapshot.ts
 *
 * Reads PokéAPI's own CSV dumps (github.com/PokeAPI/pokeapi, data/v2/csv),
 * not the GraphQL endpoint scripts/ingest-pokedex.ts uses, and writes
 * tests/fixtures/pokeapi-dle.json: for every species, exactly the facts
 * Pokédle's clues are built from (generation, the default form's types,
 * height and weight, colour, what it evolves from, and whether it's a baby).
 * tests/pokedle-accuracy.test.ts checks src/data/pokedex.json and every clue
 * against it, so a bad ingest or a hand edit can't put a wrong clue on the
 * board. Re-run when a new generation ships (after `npm run ingest`).
 */
import fs from "node:fs";
import path from "node:path";

const BASE = "https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv";
const OUT = path.join(process.cwd(), "tests/fixtures/pokeapi-dle.json");

async function csv(name: string): Promise<Record<string, string>[]> {
  const res = await fetch(`${BASE}/${name}.csv`);
  if (!res.ok) throw new Error(`${name}.csv: ${res.status}`);
  const [head, ...lines] = (await res.text()).trim().split(/\r?\n/);
  const keys = head.split(",");
  // These files have no quoted commas in the columns read here.
  return lines.map((line) => Object.fromEntries(line.split(",").map((v, i) => [keys[i], v])));
}

async function main() {
  const [species, pokemon, pokemonTypes, types, colors] = await Promise.all(["pokemon_species", "pokemon", "pokemon_types", "types", "pokemon_colors"].map(csv));
  const typeName = new Map(types.map((t) => [t.id, t.identifier]));
  const colorName = new Map(colors.map((c) => [c.id, c.identifier]));
  const defaultForm = new Map(pokemon.filter((p) => p.is_default === "1").map((p) => [p.species_id, p]));
  const typesOf = new Map<string, [number, string][]>();
  for (const t of pokemonTypes) typesOf.set(t.pokemon_id, [...(typesOf.get(t.pokemon_id) ?? []), [Number(t.slot), typeName.get(t.type_id)!]]);

  const out: Record<string, [gen: number, types: string[], height: number, weight: number, color: string, evolvesFrom: number | null, baby: 0 | 1]> = {};
  for (const s of species.sort((a, b) => Number(a.id) - Number(b.id))) {
    const form = defaultForm.get(s.id);
    if (!form) throw new Error(`species ${s.id} has no default form`);
    const formTypes = (typesOf.get(form.id) ?? []).sort((a, b) => a[0] - b[0]).map(([, t]) => t);
    out[s.id] = [
      Number(s.generation_id),
      formTypes,
      Number(form.height),
      Number(form.weight),
      colorName.get(s.color_id)!,
      s.evolves_from_species_id ? Number(s.evolves_from_species_id) : null,
      s.is_baby === "1" ? 1 : 0,
    ];
  }
  const body = {
    about: "PokéAPI CSV facts behind Pokédle's clues, from scripts/pokedle-pokeapi-snapshot.ts: [gen, types, height dm, weight hg, colour, evolves from, baby].",
    source: `${BASE}/`,
    species: out,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  // One species per line: small diffs when PokéAPI corrects something.
  const lines = Object.entries(out).map(([id, v]) => `    ${JSON.stringify(id)}: ${JSON.stringify(v)}`);
  fs.writeFileSync(OUT, `{\n  "about": ${JSON.stringify(body.about)},\n  "source": ${JSON.stringify(body.source)},\n  "species": {\n${lines.join(",\n")}\n  }\n}\n`);
  console.log(`✓ ${path.relative(process.cwd(), OUT)}: ${lines.length} species`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
