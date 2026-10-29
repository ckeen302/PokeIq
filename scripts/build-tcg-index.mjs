// Builds src/lib/tcg/fallback-index.json: a compact row per English card from
// the static PokemonTCG/pokemon-tcg-data dataset, used for card search and the
// per-species Cards section when api.pokemontcg.io is down.
// Row: [id, name, number, rarity | 0, types (or [supertype]), dex numbers | 0, smallImage?]
// smallImage is only stored when it differs from images.pokemontcg.io/<set>/<number>.png.
// Also writes src/lib/tcg/set-names.json (set id -> [name, release date]) for
// server-rendered card links and the card sitemap.
// Run: node scripts/build-tcg-index.mjs
import { writeFileSync } from "node:fs";

const RAW = "https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master";
const json = async (p) => {
  for (let i = 0; i < 4; i++) {
    const r = await fetch(`${RAW}/${p}`);
    if (r.ok) return r.json();
    if (r.status === 404) return null;
  }
  throw new Error(`fetch ${p} failed`);
};

const sets = await json("sets/en.json");
const out = [];
let next = 0;
async function worker() {
  while (next < sets.length) {
    const set = sets[next++];
    const cards = (await json(`cards/en/${set.id}.json`)) ?? [];
    for (const c of cards) {
      const def = `https://images.pokemontcg.io/${set.id}/${c.number}.png`;
      const row = [c.id, c.name, c.number ?? "", c.rarity ?? 0, c.types ?? [c.supertype ?? ""], c.nationalPokedexNumbers ?? 0];
      if (c.images?.small && c.images.small !== def) row.push(c.images.small);
      out.push(row);
    }
  }
}
await Promise.all(Array.from({ length: 12 }, worker));
out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
writeFileSync(new URL("../src/lib/tcg/fallback-index.json", import.meta.url), JSON.stringify({ cards: out }));
const names = Object.fromEntries(sets.map((s) => [s.id, [s.name, s.releaseDate]]));
writeFileSync(
  new URL("../src/lib/tcg/set-names.json", import.meta.url),
  JSON.stringify({ note: "Set id -> [name, release date] from PokemonTCG/pokemon-tcg-data sets/en.json. Rebuilt by scripts/build-tcg-index.mjs.", sets: names })
);
console.log(sets.length, "sets", out.length, "cards");
