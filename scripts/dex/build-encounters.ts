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
import { LOC_PAGES, partOfPlace, placeKey, rowsFromLocPage } from "./serebii-loc";

/**
 * species id -> version -> PokéAPI place labels hidden by the Serebii cross-check (wild rows
 * in a game whose Serebii location page lists no matching place). Rewritten by `--all` into
 * scripts/dex/encounter-hidden.json so the list stays reviewable.
 */
const HIDDEN: Record<string, Record<string, string[]>> = {};
/** Methods that are the same table under another name (Serebii vs PokéAPI labels). */
function methodFamily(m = ""): string {
  if (/^(Grass|Cave|Tall grass|Dark grass|Rough terrain|Snow|(Yellow|Purple|Red) flowers)$/.test(m)) return "walk";
  if (/^SOS/.test(m)) return "sos";
  if (/Rod|Fishing|Feebas|Bubbling/.test(m)) return "fish";
  if (/^(Surf|Rippling water|Dive)$/.test(m)) return "water";
  if (/^(Rustling grass|Dust cloud|Shaking tree|Bridge shadow)$/.test(m)) return "spot";
  if (/^(Static|Gift|Gift \(Egg\)|Interact)$/.test(m)) return "static";
  return m;
}
const STATS = { serebiiAdded: 0, serebiiPlacesAdded: 0, hiddenPlaces: 0, confirmedBySibling: 0 };
/** The paired release of each Gen 1-7 version (third versions have their own tables, so none). */
const SIBLING: Record<string, string> = {
  red: "blue", blue: "red", gold: "silver", silver: "gold",
  ruby: "sapphire", sapphire: "ruby", firered: "leafgreen", leafgreen: "firered",
  diamond: "pearl", pearl: "diamond", heartgold: "soulsilver", soulsilver: "heartgold",
  black: "white", white: "black", "black-2": "white-2", "white-2": "black-2", x: "y", y: "x",
  "omega-ruby": "alpha-sapphire", "alpha-sapphire": "omega-ruby", sun: "moon", moon: "sun", "ultra-sun": "ultra-moon", "ultra-moon": "ultra-sun",
};
/** Methods that aren't ordinary wild tables; Serebii's location pages often skip them, so they are never hidden. */
const NOT_WILD = /^(Gift|Gift \(Egg\)|Trade|Static|Roaming|Roaming \(water\)|Headbutt|Headbutt \(low\)|Headbutt \(high\)|Honey tree|Feebas tile|Snag|Snag rematch|PokéSpot|Colosseum bonus disc.*|Pokemon channel.*|Pokemon ranger)$/i;
/** Places that aren't wild areas (event distributions, Friend Safari), never hidden either. */
const NOT_WILD_PLACE = /^(Friend Safari|Pokecenter|Pokemart)$/;
const RAW = process.env.DEX_RAW ?? path.join(process.cwd(), ".cache/dex-raw");
const OUT = path.join(process.cwd(), "src/data/encounters");
const UA = "Mozilla/5.0 (compatible; PokeIQ-dex-build/1.0)";
const dex = pokedex as { id: number; name: string; gen: number; evolvesFrom: number | null }[];
const atlas = buildAtlasIndex((geo as { world: { locations: { name: string; region: string }[] } }).world.locations);

/** One shared request slot per host so parallel species builds stay polite. */
const nextSlot = { pokeapi: 0, serebii: 0 };
async function politeFetch(url: string, host: "pokeapi" | "serebii"): Promise<Response> {
  const gap = host === "serebii" ? 250 : 25;
  for (let attempt = 1; ; attempt++) {
    const at = Math.max(Date.now(), nextSlot[host]);
    nextSlot[host] = at + gap;
    if (at > Date.now()) await new Promise((r) => setTimeout(r, at - Date.now()));
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
  // PokéAPI files Cliff Cave (HGSS) under Route 47 as "Inside cave" / "Cave gate".
  if (loc === "Route 47" && sub && /cave/i.test(sub)) return { loc: "Cliff Cave" };
  return sub && sub !== loc ? { loc, area: sub } : { loc };
}

/** Species ids each game can contain at all (null = unknown, so assume yes). */
async function gameDex(): Promise<(id: number, ver: string) => boolean> {
  const ids = async (names: string[]) => {
    const set = new Set<number>();
    for (const n of names) {
      const d = await getJson<{ pokemon_entries: { pokemon_species: { url: string } }[] }>(`pokeapi/pokedex/${n}.json`, `https://pokeapi.co/api/v2/pokedex/${n}/`);
      for (const e of d?.pokemon_entries ?? []) set.add(Number(e.pokemon_species.url.match(/species\/(\d+)/)![1]));
    }
    return set.size ? set : null;
  };
  const sets: Record<string, Set<number> | null> = {
    sword: await ids(["galar", "isle-of-armor", "crown-tundra"]),
    "brilliant-diamond": null,
    "legends-arceus": await ids(["hisui"]),
    scarlet: await ids(["paldea", "kitakami", "blueberry"]),
    "legends-za": await ids(["lumiose-city", "hyperspace"]),
  };
  sets.shield = sets.sword;
  sets["shining-pearl"] = null;
  sets.violet = sets.scarlet;
  return (id, ver) => {
    if (ver === "brilliant-diamond" || ver === "shining-pearl") return id <= 493;
    if (ver.startsWith("lets-go")) return id <= 151 || id === 808 || id === 809;
    // Meltan / Melmetal debuted in Let's Go and never existed in Sun/Moon or Ultra Sun/Ultra Moon.
    if (["sun", "moon", "ultra-sun", "ultra-moon"].includes(ver)) return id <= 807;
    const set = sets[ver];
    return set ? set.has(id) : true;
  };
}

async function buildOne(id: number, inDex: (id: number, ver: string) => boolean): Promise<void> {
  const mon = dex.find((p) => p.id === id);
  if (!mon) throw new Error(`unknown id ${id}`);
  const raw: RawRow[] = [];

  // --- PokéAPI, gens 1-7
  const enc = (await getJson<PokeApiEncounter[]>(`pokeapi/encounters/${id}.json`, `https://pokeapi.co/api/v2/pokemon/${id}/encounters`)) ?? [];
  const areas = new Map<string, AreaName>();
  for (const e of enc) if (!areas.has(e.location_area.name)) areas.set(e.location_area.name, await resolveArea(e.location_area.url, e.location_area.name));
  const api = rowsFromPokeApi(enc, (slug) => areas.get(slug) ?? { loc: pretty(slug) }).filter((r) => !(r.loc && /^Unknown;/.test(r.loc)));
  const keysOf = (r: RawRow) => [placeKey(r.loc ?? ""), ...(r.sub ? [placeKey(`${r.loc} ${r.sub}`)] : [])];

  // --- Serebii per-generation location pages: confirm PokéAPI's wild rows and add the places it lacks.
  const nnn = String(id).padStart(3, "0");
  const serByVer = new Map<string, RawRow[]>();
  for (const pg of Object.values(LOC_PAGES)) {
    if (id > pg.maxId) continue;
    const page = await cached(`serebii/${pg.file}-${nnn}.html`, `https://www.serebii.net/${pg.dir}/location/${nnn}.shtml`, "serebii");
    if (!page?.body) continue;
    // Older Serebii sections are served as Latin-1.
    const body = page.body.includes("�") ? fs.readFileSync(path.join(RAW, `serebii/${pg.file}-${nnn}.html`), "latin1") : page.body;
    for (const v of Object.values(pg.anchors)) serByVer.set(v, []);
    for (const r of rowsFromLocPage(body, pg.anchors)) serByVer.get(r.ver)!.push(r);
  }
  const hide: Record<string, string[]> = {};
  for (const r of api) {
    const ser = serByVer.get(r.ver);
    if (!ser || !r.loc || NOT_WILD.test(r.m ?? "") || NOT_WILD_PLACE.test(r.loc)) continue;
    const mine = keysOf(r);
    const listed = (rows: RawRow[] | undefined) => !!rows?.some((s) => keysOf(s).some((k) => mine.some((m) => partOfPlace(m, k))));
    if (listed(ser)) continue;
    // Second source: PokéAPI has the place in the paired version too and Serebii lists it there,
    // so Serebii's page for this version just skipped it (e.g. Zubat in Oreburgh Gate, Pearl).
    const sib = SIBLING[r.ver];
    if (sib && listed(serByVer.get(sib)) && api.some((a) => a.ver === sib && a.loc === r.loc)) {
      STATS.confirmedBySibling++;
      continue;
    }
    if (!hide[r.ver]?.includes(r.loc)) (hide[r.ver] ??= []).push(r.loc);
  }
  if (Object.keys(hide).length) {
    HIDDEN[String(id)] = hide;
    STATS.hiddenPlaces += Object.values(hide).flat().length;
  }
  // PokéAPI wild rows that Serebii's location page contradicts are hidden (listed in encounter-hidden.json).
  raw.push(...api.filter((r) => !(r.loc && hide[r.ver]?.includes(r.loc))));
  // Serebii rows for a place PokéAPI lacks, or for a way of finding it there PokéAPI lacks
  // (PokéAPI's Omega Ruby / Alpha Sapphire data, for one, only has hordes).
  for (const [ver, ser] of serByVer) {
    const mine = api.filter((r) => r.ver === ver && r.loc).map((r) => ({ keys: keysOf(r), fam: methodFamily(r.m) }));
    const added = ser.filter((s) => !keysOf(s).some((k) => mine.some((m) => m.fam === methodFamily(s.m) && m.keys.some((mk) => partOfPlace(mk, k)))));
    raw.push(...added);
    if (process.env.DEX_DUMP && added.length) {
      // Audit hook: every row taken from a Serebii location page.
      fs.mkdirSync(process.env.DEX_DUMP, { recursive: true });
      fs.appendFileSync(path.join(process.env.DEX_DUMP, "serebii-added.jsonl"), added.map((a) => JSON.stringify({ id, ...a }) + "\n").join(""));
    }
    STATS.serebiiAdded += added.length;
    STATS.serebiiPlacesAdded += new Set(added.filter((s) => !keysOf(s).some((k) => mine.some((m) => m.keys.some((mk) => partOfPlace(mk, k))))).map((s) => s.loc)).size;
  }
  if (process.env.DEX_DUMP) {
    // Audit hook: the PokéAPI rows before merging (scripts/dex audit compares them with Serebii).
    fs.mkdirSync(process.env.DEX_DUMP, { recursive: true });
    fs.writeFileSync(path.join(process.env.DEX_DUMP, `${id}.json`), JSON.stringify(api));
  }

  // --- Serebii: Let's Go detail (Kanto 151 + Meltan/Melmetal)
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

  // "Transfer from HOME…" notes only help when the game has no catchable spot; next to real rows they confuse.
  const withPlaces = new Set(raw.filter((r) => r.loc).map((r) => r.ver));
  const shown = raw.filter((r) => !(r.x && withPlaces.has(r.ver) && /^Transfer (from|through) Pokémon HOME/i.test(r.x)));
  raw.length = 0;
  raw.push(...shown);

  const parent = mon.evolvesFrom ? dex.find((p) => p.id === mon.evolvesFrom)?.name : undefined;
  const species = await getJson<{ is_baby: boolean }>(`pokeapi/species/${id}.json`, `https://pokeapi.co/api/v2/pokemon-species/${id}/`);
  const gens = groupByGen(raw, { id, speciesGen: mon.gen, evolvesFrom: parent, isBaby: species?.is_baby, inGame: (v) => inDex(id, v) }, atlas);
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, `${id}.json`), JSON.stringify({ gens }));
  console.log(`#${id} ${mon.name}: ${gens.map((g) => `G${g.g}=${g.rows.length}`).join(" ")}`);
}

async function main() {
  const args = process.argv.slice(2);
  const ids = args.includes("--all") ? dex.map((p) => p.id) : args.map(Number).filter(Boolean);
  if (!ids.length) throw new Error("usage: build-encounters.ts <id...> | --all");
  const inDex = await gameDex();
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        await buildOne(id, inDex);
      } catch (e) {
        console.error(`#${id} failed:`, (e as Error).message);
        process.exitCode = 1;
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  console.log(`Serebii location pages: +${STATS.serebiiAdded} rows (${STATS.serebiiPlacesAdded} places); ${STATS.hiddenPlaces} PokéAPI places hidden; ${STATS.confirmedBySibling} rows kept on the paired version's listing`);
  if (args.includes("--all")) {
    const hide = Object.fromEntries(Object.entries(HIDDEN).sort(([a], [b]) => Number(a) - Number(b)));
    fs.writeFileSync(path.join(process.cwd(), "scripts/dex/encounter-hidden.json"), JSON.stringify({ hide }, null, 1) + "\n");
  }
}
void main();
