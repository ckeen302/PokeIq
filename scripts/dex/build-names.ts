/**
 * Build src/data/species-names.json (a species' name in every language the games ship) from PokéAPI.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/dex/build-names.ts
 *
 * Raw species responses are cached under $DEX_RAW/names (default <repo>/.cache/dex-raw/names), so reruns are offline.
 * Output: { "<national dex number>": { ja, "ja-roma", ko, fr, de, es, it, "zh-hans", "zh-hant" } }
 */
import fs from "node:fs";
import path from "node:path";
import pokedex from "../../src/data/pokedex.json";

const RAW = path.join(process.env.DEX_RAW ?? path.join(process.cwd(), ".cache", "dex-raw"), "names");
const OUT = path.join(process.cwd(), "src", "data", "species-names.json");
fs.mkdirSync(RAW, { recursive: true });
const LANGS = ["ja", "ja-roma", "ko", "fr", "de", "es", "it", "zh-hans", "zh-hant"] as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function species(id: number): Promise<{ names: { language: { name: string }; name: string }[] }> {
  const file = path.join(RAW, `${id}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8"));
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`https://pokeapi.co/api/v2/pokemon-species/${id}`, { headers: { "user-agent": "pokeiq-dex-build" } });
    if (res.ok) {
      const text = await res.text();
      fs.writeFileSync(file, text);
      await sleep(40);
      return JSON.parse(text);
    }
    if (attempt >= 4) throw new Error(`${res.status} species ${id}`);
    await sleep(1000 * (attempt + 1));
  }
}

async function main() {
  const ids = [...new Set((pokedex as { id: number }[]).map((p) => p.id))].sort((a, b) => a - b);
  const out: Record<string, Record<string, string>> = {};
  let i = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (i < ids.length) {
        const id = ids[i++];
        const s = await species(id);
        const row: Record<string, string> = {};
        for (const l of LANGS) {
          const n = s.names.find((x) => x.language.name === l)?.name;
          if (n) row[l] = n;
        }
        out[id] = row;
      }
    })
  );
  const sorted = Object.fromEntries(Object.entries(out).sort((a, b) => Number(a[0]) - Number(b[0])));
  fs.writeFileSync(OUT, JSON.stringify(sorted) + "\n");
  const missing = ids.filter((id) => LANGS.some((l) => !sorted[id]?.[l]));
  console.log(`wrote ${ids.length} species; ${missing.length} with a missing language`, missing.slice(0, 10));
}
main();
