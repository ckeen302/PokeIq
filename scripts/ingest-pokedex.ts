/**
 * Build-time data ingest: PokéAPI GraphQL -> src/data/pokedex.json
 *
 *   npm run ingest
 *
 * One GraphQL round trip pulls every species with its default form's types,
 * stats, size, Pokédex text and localized names. The snapshot is committed,
 * so the running app never depends on PokéAPI being up (or on its rate
 * limits): question generation is a pure, in-memory function of the data.
 *
 * Re-run when a new generation ships.
 */
import fs from "node:fs";
import path from "node:path";

const ENDPOINT = "https://beta.pokeapi.co/graphql/v1beta";
const OUT = path.join(process.cwd(), "src/data/pokedex.json");

// PokéAPI language ids -> our locale codes.
const LANGUAGES: Record<number, string> = { 9: "en", 7: "es", 5: "fr", 6: "de", 8: "it", 11: "ja", 3: "ko" };

const QUERY = /* GraphQL */ `
  query Pokedex {
    species: pokemon_v2_pokemonspecies(order_by: { id: asc }) {
      id
      name
      generation_id
      is_legendary
      is_mythical
      evolves_from_species_id
      evolution_chain_id
      color: pokemon_v2_pokemoncolor { name }
      habitat: pokemon_v2_pokemonhabitat { name }
      shape: pokemon_v2_pokemonshape { name }
      names: pokemon_v2_pokemonspeciesnames(
        where: { language_id: { _in: [${Object.keys(LANGUAGES).join(",")}] } }
      ) { name genus language_id }
      flavor: pokemon_v2_pokemonspeciesflavortexts(
        where: { language_id: { _eq: 9 } }
        order_by: { version_id: desc }
      ) { flavor_text }
      forms: pokemon_v2_pokemons(where: { is_default: { _eq: true } }) {
        height
        weight
        types: pokemon_v2_pokemontypes(order_by: { slot: asc }) { type: pokemon_v2_type { name } }
        stats: pokemon_v2_pokemonstats { base_stat stat: pokemon_v2_stat { name } }
        abilities: pokemon_v2_pokemonabilities { is_hidden ability: pokemon_v2_ability { name } }
      }
    }
  }
`;

interface RawSpecies {
  id: number;
  name: string;
  generation_id: number;
  is_legendary: boolean;
  is_mythical: boolean;
  evolves_from_species_id: number | null;
  evolution_chain_id: number;
  color: { name: string } | null;
  habitat: { name: string } | null;
  shape: { name: string } | null;
  names: { name: string; genus: string; language_id: number }[];
  flavor: { flavor_text: string }[];
  forms: {
    height: number;
    weight: number;
    types: { type: { name: string } }[];
    stats: { base_stat: number; stat: { name: string } }[];
    abilities: { is_hidden: boolean; ability: { name: string } }[];
  }[];
}

const STAT_KEYS: Record<string, string> = {
  hp: "hp",
  attack: "atk",
  defense: "def",
  "special-attack": "spa",
  "special-defense": "spd",
  speed: "spe",
};

function cleanFlavor(text: string): string {
  return text
    .replace(/-[\n\f\r]+/g, "-") // words hyphenated across a line break
    .replace(/[\n\f\r]+/g, " ")
    .replace(/­\s*/g, "") // soft hyphens from line-wrapped Gen 3-5 text
    .replace(/\s+/g, " ")
    .trim();
}

async function main() {
  console.log("Fetching species from PokéAPI GraphQL…");
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: QUERY }),
  });
  if (!res.ok) throw new Error(`PokéAPI GraphQL ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { data?: { species: RawSpecies[] }; errors?: unknown };
  if (!body.data) throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);

  const raw = body.data.species;
  const byId = new Map(raw.map((s) => [s.id, s]));

  // Evolution stage = depth in the evolves_from chain (1 = basic).
  const stageOf = (s: RawSpecies): number => {
    let stage = 1;
    let cur = s;
    while (cur.evolves_from_species_id && byId.has(cur.evolves_from_species_id)) {
      stage++;
      cur = byId.get(cur.evolves_from_species_id)!;
    }
    return stage;
  };
  // Species that something evolves from can still evolve.
  const evolvesFurther = new Set(raw.map((s) => s.evolves_from_species_id).filter(Boolean));

  const pokedex = raw
    .filter((s) => s.forms.length > 0)
    .map((s) => {
      const form = s.forms[0];
      const names: Record<string, string> = {};
      let genus = "";
      for (const n of s.names) {
        const code = LANGUAGES[n.language_id];
        if (code) names[code] = n.name;
        if (n.language_id === 9) genus = n.genus;
      }
      const stats = Object.fromEntries(
        form.stats.map((st) => [STAT_KEYS[st.stat.name], st.base_stat])
      ) as Record<string, number>;
      const flavor = [...new Set(s.flavor.map((f) => cleanFlavor(f.flavor_text)))].slice(0, 4);

      return {
        id: s.id,
        slug: s.name,
        name: names.en ?? s.name,
        names,
        genus,
        gen: s.generation_id,
        types: form.types.map((t) => t.type.name),
        stats,
        bst: Object.values(stats).reduce((a, b) => a + b, 0),
        height: form.height, // decimetres
        weight: form.weight, // hectograms
        color: s.color?.name ?? "unknown",
        habitat: s.habitat?.name ?? null,
        shape: s.shape?.name ?? null,
        stage: stageOf(s),
        fullyEvolved: !evolvesFurther.has(s.id),
        chain: s.evolution_chain_id,
        evolvesFrom: s.evolves_from_species_id,
        legendary: s.is_legendary,
        mythical: s.is_mythical,
        abilities: form.abilities.map((a) => ({ name: a.ability.name, hidden: a.is_hidden })),
        flavor,
      };
    });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(pokedex));
  const kb = Math.round(fs.statSync(OUT).size / 1024);
  console.log(`✓ wrote ${pokedex.length} species to ${path.relative(process.cwd(), OUT)} (${kb} KB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
