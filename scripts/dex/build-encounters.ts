/**
 * Build the "Where to find it" data for the Pokédex entry pages.
 *
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/dex/build-encounters.ts 396 25 129   # specific species
 *   NODE_USE_ENV_PROXY=1 npx tsx scripts/dex/build-encounters.ts --all        # all 1,025
 *
 * Sources
 *   Gens 1-7  PokéAPI  pokemon/{id}/encounters (+ location-area / location for English
 *             names; encounter-condition values give time of day, swarm, radar...)
 *   Gen 7 LGPE, Gen 8 (Sword/Shield, Isle of Armor, Crown Tundra, BDSP, Legends: Arceus)
 *             and Gen 9 (Scarlet/Violet + DLC, Legends: Z-A)  Serebii.net per-species pages
 *
 * Raw downloads are cached (default: $DEX_RAW or <repo>/.cache/dex-raw) so reruns are offline.
 * Output: src/data/encounters/{id}.json  ({ gens: EncGen[] }).
 */
import fs from "node:fs";
import path from "node:path";
import geo from "../../src/data/geo.json";
import pokedex from "../../src/data/pokedex.json";
import { buildAtlasIndex, groupByGen, rowsFromPokeApi, type AreaName, type PokeApiEncounter, type RawRow } from "../../src/lib/pokemon/encounter-transform";
import { parseBdspDetail, parseLgpeDetail, parseOverview, parseSwshDetail } from "./serebii";

const RAW = process.env.DEX_RAW ?? path.join(process.cwd(), ".cache/dex-raw");
const OUT = path.join(process.cwd(), "src/data/encounters");
const UA = "Mozilla/5.0 (compatible; PokeIQ-dex-build/1.0)";
const dex = pokedex as { id: number; name: string; gen: number; evolvesFrom: number | null }[];
const atlas = buildAtlasIndex((geo as { world: { locations: { name: string; region: string }[] } }).world.locations);

let last = 0;
async function politeFetch(url: string, host: "pokeapi" | "serebii"): Promise<Response> {
  const gap = host === "serebii" ? 400 : 60;
  for (let attempt = 1; ; attempt++) {
    const wait = last + gap - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    last = Date.now();
    try {
      const res = await fetch(url, { headers: { "user-agent": UA }, redirect: "follow" });
      if (res.ok || res.status === 404 || attempt >= 4) return res;
    } catch (e) {
      if (attempt >= 4) throw e;
    }
    await new Promise((r) => setTimeout(r, 1500 * attempt));
  }
}

/** Cached GET; returns null for a 404. */
async function cached(rel: string, url: string, host: "pokeapi" | "serebii"): Promise<{ body: string; url: string } | null> {
  const file = path.join(RAW, rel);
  const meta = `${file}.url`;
  if (fs.existsSync(file)) return { body: fs.readFileSync(file, "utf8"), url: fs.existsSync(meta) ? fs.readFileSync(meta, "utf8") : url };
  const res = await politeFetch(url, host);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  if (res.status === 404) {
    fs.writeFileSync(file, "");
    return null;
  }
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const body = await res.text();
  fs.writeFileSync(file, body);
  fs.writeFileSync(meta, res.url);
  return { body, url: res.url };
}
const getJson = async <T>(rel: string, url: string): Promise<T | null> => {
  const r = await cached(rel, url, "pokeapi");
  return r && r.body ? (JSON.parse(r.body) as T) : null;
};

const pretty = (s: string) => s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(\d+f|b\d+f)\b/gi, (m) => m.toUpperCase());
const en = (names: { name: string; language: { name: string } }[] | undefined) => names?.find((n) => n.language.name === "en")?.name;

async function resolveArea(url: string, slug: string): Promise<AreaName> {
  const id = url.match(/location-area\/(\d+)/)![1];
  const area = await getJson<{ name: string; names: { name: string; language: { name: string } }[]; location: { name: string; url: string } }>(`pokeapi/location-area/${id}.json`, url);
  if (!area) return { loc: pretty(slug) };
  const lid = area.location.url.match(/location\/(\d+)/)![1];
  const location = await getJson<{ names: { name: string; language: { name: string } }[] }>(`pokeapi/location/${lid}.json`, area.location.url);
  const loc = en(location?.names) ?? pretty(area.location.name.replace(/^(kanto|johto|hoenn|sinnoh|unova|kalos|alola|galar|paldea)-/, ""));
  let sub = en(area.names);
  if (sub) {
    // "Road 204 (north, towards Floaroma Town)" -> "North, towards Floaroma Town"; "Route 201" -> none
    const paren = sub.match(/\(([^)]+(?:\([^)]*\))?[^)]*)\)\s*$/);
    if (paren) sub = paren[1].replace(/^./, (c) => c.toUpperCase());
    else if (sub.toLowerCase().startsWith(loc.toLowerCase())) sub = sub.slice(loc.length).trim();
    else if (/^(road|route) \d+$/i.test(sub)) sub = "";
  }
  if (!sub || sub === loc) {
    const rest = slug.replace(area.location.name, "").replace(/^-|-area$/g, "").replace(/^-+|-+$/g, "");
    sub = rest && rest !== "area" ? pretty(rest) : undefined;
  }
  return sub && sub !== loc ? { loc, area: sub } : { loc };
}

async function buildOne(id: number): Promise<void> {
  const mon = dex.find((p) => p.id === id);
  if (!mon) throw new Error(`unknown id ${id}`);
  const raw: RawRow[] = [];

  // --- PokéAPI, gens 1-7
  const enc = (await getJson<PokeApiEncounter[]>(`pokeapi/encounters/${id}.json`, `https://pokeapi.co/api/v2/pokemon/${id}/encounters`)) ?? [];
  const areas = new Map<string, AreaName>();
  for (const e of enc) if (!areas.has(e.location_area.name)) areas.set(e.location_area.name, await resolveArea(e.location_area.url, e.location_area.name));
  raw.push(...rowsFromPokeApi(enc, (slug) => areas.get(slug) ?? { loc: pretty(slug) }));

  // --- Serebii: Let's Go detail (Kanto 151 + Meltan/Melmetal)
  const nnn = String(id).padStart(3, "0");
  if (id <= 151 || id === 808 || id === 809) {
    const lg = await cached(`serebii/sm-location-${nnn}.html`, `https://www.serebii.net/pokedex-sm/location/${nnn}.shtml`, "serebii");
    if (lg) raw.push(...parseLgpeDetail(lg.body, "letsgop", "lets-go-pikachu"), ...parseLgpeDetail(lg.body, "letsgoe", "lets-go-eevee"));
  }

  // --- Serebii: Sword/Shield (+ BDSP, Legends: Arceus) page, then its detail page
  if (id <= 905) {
    const sw = await cached(`serebii/swsh-${nnn}.html`, `https://www.serebii.net/pokedex-swsh/${nnn}.shtml`, "serebii");
    if (sw) {
      raw.push(...parseOverview(sw.body, { skipDetailedBase: true }));
      const loc = await cached(`serebii/swsh-loc-${nnn}.html`, sw.url.replace(/\/?(index\.shtml)?$/, "/") + "locations.shtml", "serebii");
      if (loc) {
        raw.push(
          ...parseSwshDetail(loc.body, "sword", "sword"),
          ...parseSwshDetail(loc.body, "shiekd", "shield"),
          ...parseBdspDetail(loc.body, "bd", "brilliant-diamond"),
          ...parseBdspDetail(loc.body, "sp", "shining-pearl")
        );
      }
    }
  }

  // --- Serebii: Scarlet/Violet (+ DLC, Z-A)
  const sv = await cached(`serebii/sv-${nnn}.html`, `https://www.serebii.net/pokedex-sv/${nnn}.shtml`, "serebii");
  if (sv) raw.push(...parseOverview(sv.body));

  const parent = mon.evolvesFrom ? dex.find((p) => p.id === mon.evolvesFrom)?.name : undefined;
  const species = await getJson<{ is_baby: boolean }>(`pokeapi/species/${id}.json`, `https://pokeapi.co/api/v2/pokemon-species/${id}/`);
  const gens = groupByGen(raw, { id, speciesGen: mon.gen, evolvesFrom: parent, isBaby: species?.is_baby }, atlas);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify({ gens }));
  console.log(`#${id} ${mon.name}: ${gens.map((g) => `G${g.g}=${g.rows.length}`).join(" ")}`);
}

async function main() {
  const args = process.argv.slice(2);
  const ids = args.includes("--all") ? dex.map((p) => p.id) : args.map(Number).filter(Boolean);
  if (!ids.length) throw new Error("usage: build-encounters.ts <id...> | --all");
  for (const id of ids) {
    try {
      await buildOne(id);
    } catch (e) {
      console.error(`#${id} failed:`, (e as Error).message);
      process.exitCode = 1;
    }
  }
}
void main();
