/**
 * Builds src/data/places.json: every place of every main-series region for the
 * Pokédex Places tab, beyond the World Atlas's places.
 *
 * Sources (nothing is invented):
 *  - the World Atlas (src/data/geo.json): these places keep their own pages;
 *  - PokéAPI regions/locations/areas (cached under $DEX_RAW/locations, see
 *    the fetch step below; a missing cache is fetched politely);
 *  - every location label in src/data/encounters/*.json (PokéAPI + Serebii).
 *
 * Same place across games = one page; floors/areas become sections. Each
 * encounter label is resolved to one place per region (exact normalized
 * name, plus a short documented alias list); labels that are not places
 * (roaming, "Tera Raid Battles", "Everywhere"…) are listed in `pseudo`.
 *
 *   tsx scripts/dex/build-places.ts            # build
 *   tsx scripts/dex/build-places.ts --verify   # coverage report only
 */
import fs from "node:fs";
import path from "node:path";
import geo from "../../src/data/geo.json";
import { normPlace } from "../../src/lib/pokemon/encounter-transform";
import { VERSION_BY_KEY } from "../../src/lib/pokemon/encounter-types";
import type { EncGen } from "../../src/lib/pokemon/encounter-types";

const ROOT = path.resolve(__dirname, "../..");
const RAW = path.join(process.env.DEX_RAW ?? path.join(ROOT, ".cache/dex-raw"), "locations");
const OUT = path.join(ROOT, "src/data/places.json");
const VERIFY = process.argv.includes("--verify");

type Atlas = { name: string; region: string; parent?: string };
const ATLAS = (geo as unknown as { world: { locations: Atlas[] } }).world.locations;

/** PokéAPI region -> our regions (the first is the default). */
const API_REGIONS: Record<string, string[]> = {
  kanto: ["Kanto", "Sevii Islands"],
  johto: ["Johto", "Kanto"],
  hoenn: ["Hoenn"],
  sinnoh: ["Sinnoh"],
  unova: ["Unova"],
  kalos: ["Kalos"],
  alola: ["Alola"],
  galar: ["Galar", "Isle of Armor", "Crown Tundra"],
  hisui: ["Hisui"],
  paldea: ["Paldea", "Kitakami", "Blueberry Academy"],
};
/** Non-mainline PokéAPI regions (Colosseum/XD). */
const EXCLUDED_REGIONS = ["orre"];

/** Sub-regions for places the atlas doesn't have (Bulbapedia's location lists). */
const SUB_REGION: Record<string, string[]> = {
  "Sevii Islands": ["Icefall Cave", "Lost Cave", "Outcast Island", "Water Labyrinth", "Water Path", "Three Isle Path", "Monean Chamber", "Liptoo Chamber", "Weepth Chamber", "Dilford Chamber", "Scufib Chamber", "Rixy Chamber", "Viapos Chamber"],
  "Isle of Armor": ["Brawlers' Cave", "Insular Sea", "Stepping-Stone Sea", "Training Lowlands", "Warm-Up Tunnel", "Workout Sea"],
  "Crown Tundra": ["Ballimere Lake", "Lakeside Cave", "Roaring-Sea Caves", "Snowslide Slope", "Tunnel to the Top", "Iceberg Ruins", "Rock Peak Ruins"],
  Kitakami: ["Chilling Waterhead", "Kitakami Hall", "Kitakami Wilds", "Mossfell Confluence", "Timeless Woods"],
  "Blueberry Academy": ["Central Plaza", "Chargestone Cavern", "Torchlit Labyrinth", "League Club Room"],
};
/** The Tanoby chambers are inside Tanoby Ruins. */
const PARENT: Record<string, string> = Object.fromEntries(["Monean", "Liptoo", "Weepth", "Dilford", "Scufib", "Rixy", "Viapos"].map((c) => [`Sevii Islands|${c} Chamber`, "Tanoby Ruins"]));

/** PokéAPI/encounter names of a place the atlas (or PokéAPI) spells differently: "Region|name" -> canonical name. */
const ALIAS: Record<string, string> = {
  "Kanto|Safari Zone": "Safari Zone / Pal Park",
  "Johto|Lighthouse": "Olivine Lighthouse",
  "Johto|Radio Tower": "Goldenrod Radio Tower",
  // GSC's Electrode trap (B2F) is in Mahogany's Team Rocket HQ.
  "Johto|Rocket Hideout": "Team Rocket HQ",
  "Hoenn|Hoenn Battle Frontier": "Battle Frontier",
  "Hoenn|Aqua Hideout": "Team Aqua Hideout",
  "Hoenn|Magma Hideout": "Magma Hideout (Jagged Pass)",
  "Hoenn|Team Magma Hideout": "Magma Hideout (Jagged Pass)",
  "Sinnoh|Galactic HQ": "Team Galactic HQ",
  "Sinnoh|T.G. Eterna Bldg": "Team Galactic Eterna Building",
  "Sinnoh|Mining Museum": "Oreburgh Mining Museum",
  "Sinnoh|Restaurant": "Seven Stars Restaurant",
  "Sinnoh|Grand Lake": "Hotel Grand Lake",
  "Sinnoh|Cycle Shop": "Rad Rickshaw's Cycle Shop",
  "Sinnoh|Veilstone Store": "Veilstone Department Store",
  "Sinnoh|Game Corner": "Veilstone Game Corner",
  "Sinnoh|Café": "Café Cabin",
  "Sinnoh|Ruins Maniac's Cave": "Ruin Maniac Cave",
  "Sinnoh|Ruins Maniac's Tunnel": "Maniac Tunnel",
  "Unova|Black City": "Black City / White Forest",
  "Unova|White Forest": "Black City / White Forest",
  "Unova|Shopping Mall": "Shopping Mall Nine",
  "Unova|Victory Road": "Victory Road (B2W2)",
  "Alola|Lake of the Sunne": "Lake of the Sunne / Moone",
  "Alola|Lake of the Moone": "Lake of the Sunne / Moone",
  "Alola|Altar of the Sunne": "Altar of the Sunne / Moone",
  "Alola|Altar of the Moone": "Altar of the Sunne / Moone",
  "Alola|Thrifty Megamart": "Thrifty Megamart Abandoned Site",
  "Alola|Berry Fields": "Alola Berry Fields",
  "Paldea|Naranja Academy": "Naranja and Uva Academy",
  "Paldea|Uva Academy": "Naranja and Uva Academy",
  "Paldea|Alfornado Cavern": "Alfornada Cavern",
  // Serebii's typo: Legends: Arceus has no "Grueling Cove", only Grueling Grove (Obsidian Fieldlands).
  "Hisui|Grueling Cove": "Grueling Grove",
  "Hisui|Heartwood": "The Heartwood",
  // Kalos routes' names (PokéAPI lists both the number and the name).
  ...Object.fromEntries(
    ["Vaniville Pathway", "Avance Trail", "Ouvert Way", "Parterre Way", "Versant Road", "Palais Lane", "Rivière Walk", "Muraille Coast", "Spikes Passage", "Menhir Trail", "Miroir Way", "Fourrage Road", "Lumiose Badlands", "Laverre Nature Trail", "Brun Way", "Mélancolie Path", "Mamoswine Road", "Vallée Étroite Way", "Grande Vallée Way", "Winding Woods", "Dernière Way", "Détourner Way"].map((n, i) => [`Kalos|${n}`, `Route ${i + 1}`]),
  ),
};

/** PokéAPI entries that are not places in a main-series game (placeholders, roaming lists, side features). */
const NOT_A_PLACE: [RegExp, string][] = [
  [/^Roaming\b|\(Roaming\)$/i, "roaming Pokémon list"],
  [/^Unknown; /, "placeholder"],
  [/^Random caves across/, "roaming list"],
  [/^Max Dens in/, "Max Raid dens list"],
  [/^Pokéwalker$/, "Pokéwalker accessory"],
  [/^Mystery Zone$|^Faraway place$|^\?\?\?$/, "placeholder / unused map"],
  [/^Underwater$/, "Dive method, not one place"],
  [/^Soaring in the sky$/i, "Soaring method, not one place"],
  [/^Secret Base$/, "player Secret Base feature"],
  [/^Space-time distortion$/i, "phenomenon (method), not one place"],
];

/** Encounter labels that are not one place: rendered under their method on species pages, never as a place. */
const PSEUDO: [RegExp, string][] = [
  [/^Roaming\b|\(Roaming\)$|^(Kanto|Johto|Hoenn|Sinnoh|Unova)$/, "roaming across the region"],
  [/^Wild Area$/, "roaming across the Wild Areas (Galarian legendary birds)"],
  [/^Wild Area$/, "roaming across the Wild Areas (Galarian legendary birds)"],
  [/^Tera Raid Battles$/, "Tera Raid Battles (method)"],
  [/^Everywhere$|^Most fishable water$/, "everywhere in the game"],
  [/^Pokecenter$|^Pokemart$/, "event / gift at any Pokémon Center or Mart"],
  [/^Honey Trees$/, "Honey trees on several routes"],
  [/^Soaring in the sky$/i, "Soaring (method)"],
  [/^(The )?Isle of Armor$|^The Crown Tundra$/, "anywhere in the DLC area"],
];

const clean = (s: string) => s.replace(/’/g, "'");
const key = (n: string) =>
  normPlace(clean(n))
    .replace(/^sea route /, "route ")
    .replace(/^the /, "")
    .replace(/ (kanto|sinnoh|generation [ivx]+)$/, "")
    .trim();

interface Place {
  name: string;
  region: string;
  parent?: string;
  /** From PokéAPI areas / encounter labels (floors, areas, sectors). */
  sections: string[];
  /** Generation numbers PokéAPI lists the location in (when no other game info). */
  gens: number[];
  atlas: boolean;
  api: string[];
}

const places = new Map<string, Place>(); // "Region|key"
const byRegion = new Map<string, Map<string, Place>>();
function add(p: Place): Place {
  const k = `${p.region}|${key(p.name)}`;
  const had = places.get(k);
  if (had) return had;
  places.set(k, p);
  if (!byRegion.has(p.region)) byRegion.set(p.region, new Map());
  byRegion.get(p.region)!.set(key(p.name), p);
  return p;
}
const find = (region: string, name: string): Place | undefined => {
  const a = ALIAS[`${region}|${clean(name)}`] ?? ALIAS[`${region}|${name}`];
  const m = byRegion.get(region);
  // "Kanto Power Plant" / "Johto Safari Zone" = the region's "Power Plant" / "Safari Zone".
  const bare = name.startsWith(`${region} `) ? name.slice(region.length + 1) : null;
  return m?.get(key(a ?? name)) ?? (bare ? (m?.get(key(ALIAS[`${region}|${bare}`] ?? bare)) ?? undefined) : undefined);
};

for (const l of ATLAS) add({ name: l.name, region: l.region, ...(l.parent ? { parent: l.parent } : {}), sections: [], gens: [], atlas: true, api: [] });

// ---- PokéAPI ----
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function getJson<T>(url: string, file: string): Promise<T> {
  const f = path.join(RAW, file);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8")) as T;
  for (let a = 1; ; a++) {
    await sleep(100);
    const r = await fetch(url, { headers: { "user-agent": "PokeIQ-dex-build/1.0" } }).catch(() => null);
    if (r?.ok) {
      const t = await r.text();
      fs.mkdirSync(RAW, { recursive: true });
      fs.writeFileSync(f, t);
      return JSON.parse(t) as T;
    }
    if (a > 4) throw new Error(`${r?.status} ${url}`);
    await sleep(1500 * a);
  }
}
type ApiLoc = { name: string; names: { name: string; language: { name: string } }[]; areas: { name: string }[]; game_indices: { generation: { name: string } }[] };
const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9 };
const pretty = (s: string) => s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(\d+f|b\d+f)\b/gi, (m) => m.toUpperCase());

const excluded: { region: string; name: string; why: string }[] = [];
const apiByRegion: Record<string, { name: string; place: Place }[]> = {};

function regionFor(apiRegion: string, name: string): string {
  const cands = API_REGIONS[apiRegion];
  const atlasHit = cands.find((r) => find(r, name)?.atlas);
  if (atlasHit) return atlasHit;
  const sub = cands.find((r) => SUB_REGION[r]?.includes(clean(name)));
  return sub ?? cands[0];
}

async function loadApi() {
  const regions = await getJson<{ results: { name: string; url: string }[] }>("https://pokeapi.co/api/v2/region?limit=100", "regions.json");
  for (const r of regions.results) {
    const reg = await getJson<{ locations: { name: string; url: string }[] }>(r.url, `region-${r.name}.json`);
    if (EXCLUDED_REGIONS.includes(r.name)) {
      for (const l of reg.locations) excluded.push({ region: r.name, name: l.name, why: "non-mainline region (Colosseum/XD)" });
      continue;
    }
    if (!API_REGIONS[r.name]) throw new Error(`unmapped PokéAPI region ${r.name}`);
    for (const l of reg.locations) {
      const id = l.url.match(/location\/(\d+)/)![1];
      const loc = await getJson<ApiLoc>(l.url, `${id}.json`);
      const en = loc.names.find((n) => n.language.name === "en")?.name;
      if (!en) {
        excluded.push({ region: r.name, name: loc.name, why: "no English name (internal placeholder)" });
        continue;
      }
      const why = NOT_A_PLACE.find(([re]) => re.test(en))?.[1];
      if (why) {
        excluded.push({ region: r.name, name: en, why });
        continue;
      }
      const region = regionFor(r.name, en);
      const p = find(region, en) ?? add({ name: clean(en), region, ...(PARENT[`${region}|${clean(en)}`] ? { parent: PARENT[`${region}|${clean(en)}`] } : {}), sections: [], gens: [], atlas: false, api: [] });
      p.api.push(loc.name);
      for (const g of loc.game_indices) {
        const n = ROMAN[g.generation.name.replace("generation-", "")];
        if (n && !p.gens.includes(n)) p.gens.push(n);
      }
      if (loc.areas.length > 1)
        for (const a of loc.areas) {
          const rest = a.name.replace(loc.name, "").replace(/^-+|-+$/g, "").replace(/-?area$/, "");
          const s = rest ? pretty(rest) : "";
          if (s && !p.sections.includes(s)) p.sections.push(s);
        }
      (apiByRegion[r.name] ??= []).push({ name: en, place: p });
    }
  }
}

// ---- Encounter labels ----
const versionRegions = (v: string): string[] => (v === "legends-arceus" ? ["Hisui"] : (VERSION_BY_KEY[v]?.regions ?? []));
const HISUI_AREAS = ["Obsidian Fieldlands", "Crimson Mirelands", "Cobalt Coastlands", "Coronet Highlands", "Alabaster Icelands"];
const ZA_PARENT = "Lumiose City";

interface Resolved {
  place: Place;
  section?: string;
}

/** An encounter label split into the place name, a section (floor, sector…) and the Hisui area it is in. */
interface Parsed {
  name: string;
  section?: string;
  parent?: string;
}

function parse(loc: string, region: string): Parsed {
  const name = clean(loc);
  // "Space-time Distortion in Coronet Highlands (Coronet Highlands)" -> the area itself.
  const std = /^Space-time Distortion in (.+?)(?: \(.+\))?$/.exec(name);
  if (std) return { name: std[1], section: "Space-time distortion" };
  const paren = /^(.+?) \(([^()]+)\)$/.exec(name);
  if (paren && region === "Hisui" && HISUI_AREAS.includes(paren[2])) {
    // "Worn Bridge (Obsidian Fieldlands)"; "Lake Valor (Story) (Crimson Mirelands)".
    const story = /^(.+) \((Story)\)$/.exec(paren[1]);
    const base = story ? story[1] : paren[1];
    return { name: base, ...(story ? { section: story[2] } : {}), ...(paren[2] !== base ? { parent: paren[2] } : {}) };
  }
  // Z-A: "Rouge District (Rouge Sector 1)", "Rouge Sector 1", "The Sewers - Canal Access".
  if (paren && region === "Kalos" && /District$/.test(paren[1])) return { name: paren[1], section: paren[2] };
  const sector = /^(Bleu|Jaune|Magenta|Rouge|Vert) Sector \d+$/.exec(name);
  if (sector && region === "Kalos") return { name: `${sector[1]} District`, section: name };
  const dash = /^(The Sewers) - (.+)$/.exec(name);
  if (dash) return { name: dash[1], section: dash[2] };
  return { name };
}

/** Resolution of one encounter label in one region: the place and an optional section. */
function resolve(loc: string, region: string): Resolved | null {
  const p = parse(loc, region);
  const res = withPlace(p.name, region, p.section);
  if (res && p.parent && !res.place.parent && !res.place.atlas) res.place.parent = p.parent;
  return res;
}

function withPlace(name: string, region: string, section?: string): Resolved | null {
  const hit = find(region, name);
  if (hit) return { place: hit, ...(section ? { section } : {}) };
  // "Lost Tower5F", "Mt. CoronetRoute 211 Entrance", "Route 205North": a known place glued to its area
  // (never "Wild Zone 1" + "0").
  for (const p of byRegion.get(region)?.values() ?? []) {
    const rest = name.slice(p.name.length);
    if (name.length > p.name.length && name.startsWith(p.name) && /^[A-Z0-9]/.test(rest) && !(/\d$/.test(p.name) && /^\d/.test(rest)))
      return { place: p, section: section ? `${rest} · ${section}` : rest };
  }
  return null;
}

function encounterLabels(): Map<string, Set<string>> {
  const dir = path.join(ROOT, "src/data/encounters");
  const labels = new Map<string, Set<string>>(); // loc -> versions, rows without an atlas match
  for (const f of fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f))) {
    const { gens } = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as { gens: EncGen[] };
    for (const g of gens)
      for (const r of g.rows) {
        if (r.x || !r.loc || r.a) continue;
        const s = labels.get(r.loc) ?? new Set();
        r.v.forEach((v) => s.add(v));
        labels.set(r.loc, s);
      }
  }
  return labels;
}

/** PokéAPI's own data errors: these places are not in that game's region (PokéAPI lists them for Sun / Black). */
const DATA_ERRORS: Record<string, string[]> = { "New Mauville": ["sun", "moon", "ultra-sun", "ultra-moon"], "Team Flare Secret HQ": ["black", "white"] };

async function main() {
  // Hisui's five areas are named in the encounter data; they are places in their own right.
  for (const a of HISUI_AREAS) add({ name: a, region: "Hisui", sections: [], gens: [], atlas: false, api: [] });
  await loadApi();
  const before = new Map<string, number>();
  for (const l of ATLAS) before.set(l.region, (before.get(l.region) ?? 0) + 1);

  const labels = encounterLabels();
  const encMap: Record<string, { k: string; s?: string }> = {};
  const pseudo: Record<string, string> = {};
  const unresolved: string[] = [];
  const dataErrors: string[] = [];
  // Pass 1: labels that are places in exactly one region of a single-region game become places when nothing knows them.
  for (const [loc, versions] of labels) {
    if (PSEUDO.some(([re]) => re.test(loc))) continue;
    for (const v of versions) {
      const regs = versionRegions(v);
      if (DATA_ERRORS[loc]?.includes(v) || regs.length !== 1 || regs.some((r) => resolve(loc, r))) continue;
      const p = parse(loc, regs[0]);
      if (/^Everywhere$/.test(p.name)) continue;
      add({ name: p.name, region: regs[0], ...(p.parent ? { parent: p.parent } : {}), ...(regs[0] === "Kalos" && v === "legends-za" ? { parent: ZA_PARENT } : {}), sections: [], gens: [], atlas: false, api: [] });
    }
  }
  // Pass 2: map every (label, region) a version needs; a label known in two regions of one game is ambiguous.
  for (const [loc, versions] of labels) {
    const why = PSEUDO.find(([re]) => re.test(loc))?.[1];
    if (why) {
      pseudo[loc] = why;
      continue;
    }
    for (const v of versions) {
      if (DATA_ERRORS[loc]?.includes(v)) {
        dataErrors.push(`${loc} (${v})`);
        continue;
      }
      const hits = versionRegions(v)
        .map((r) => [r, resolve(loc, r)] as const)
        .filter((h): h is readonly [string, Resolved] => !!h[1]);
      if (hits.length !== 1) {
        unresolved.push(`${loc} (${v}${hits.length ? ": ambiguous" : ""})`);
        continue;
      }
      const [region, res] = hits[0];
      if (res.section && !res.place.sections.includes(res.section) && !/distortion/i.test(res.section)) res.place.sections.push(res.section);
      encMap[`${loc}|${region}`] = { k: `${res.place.name} · ${res.place.region}`, ...(res.section ? { s: res.section } : {}) };
    }
  }


  const extra = [...places.values()].filter((p) => !p.atlas);
  const after = new Map(before);
  for (const p of extra) after.set(p.region, (after.get(p.region) ?? 0) + 1);

  // ---- report ----
  console.log("places per region (before -> after):");
  for (const r of [...after.keys()].sort()) console.log(`  ${r}: ${before.get(r) ?? 0} -> ${after.get(r)}`);
  console.log(`total: ${ATLAS.length} -> ${ATLAS.length + extra.length}`);
  console.log(`PokéAPI entries excluded as non-places: ${excluded.length} (${Object.entries(excluded.reduce<Record<string, number>>((a, e) => ((a[e.why] = (a[e.why] ?? 0) + 1), a), {})).map(([w, n]) => `${w}: ${n}`).join("; ")})`);
  console.log(`encounter labels (unmatched to atlas): ${labels.size}; pseudo-locations: ${Object.keys(pseudo).length}; mapped (label, region) pairs: ${Object.keys(encMap).length}; unresolved (label, version): ${unresolved.length}; known PokéAPI data errors: ${dataErrors.length}`);
  for (const u of unresolved) console.log(`  unresolved: ${u}`);
  for (const u of dataErrors) console.log(`  data error (place not in that game): ${u}`);
  // Independent check: every PokéAPI mainline location has a page (by its own or its aliased name) in one of its regions.
  const pages = new Set([...ATLAS, ...extra].map((p) => `${p.region}|${key(p.name)}`));
  let missing = 0;
  const perRegion: string[] = [];
  for (const [r, list] of Object.entries(apiByRegion)) {
    const names = new Set<string>();
    for (const { name } of list) {
      const ok = API_REGIONS[r].some((reg) => pages.has(`${reg}|${key(ALIAS[`${reg}|${clean(name)}`] ?? name)}`) || pages.has(`${reg}|${key(name.replace(/^(Kanto|Johto|Kalos) /, ""))}`));
      if (!ok) {
        missing++;
        console.log(`  missing PokéAPI: ${r} ${name}`);
      }
      names.add(key(name));
    }
    const ours = [...pages].filter((k) => API_REGIONS[r].includes(k.split("|")[0]) && (r !== "johto" || k.startsWith("Johto|"))).length;
    perRegion.push(`${r} ${list.length} entries / ${names.size} distinct -> our pages ${ours}`);
  }
  console.log(`PokéAPI mainline: ${perRegion.join("; ")}`);
  console.log(`PokéAPI mainline locations: ${Object.values(apiByRegion).flat().length}; without a page: ${missing}`);
  if (process.argv.includes("--list")) for (const p of extra) console.log(`${p.region}|${p.name}${p.parent ? "<" + p.parent : ""}${p.sections.length ? " [" + p.sections.join(",") + "]" : ""}`);
  if (VERIFY) return;

  const out = {
    places: extra
      .sort((a, b) => a.region.localeCompare(b.region) || a.name.localeCompare(b.name, "en", { numeric: true }))
      .map((p) => ({ name: p.name, region: p.region, ...(p.parent ? { parent: p.parent } : {}), ...(p.gens.length ? { gens: p.gens.sort() } : {}), ...(p.sections.length ? { sections: p.sections } : {}) })),
    sections: Object.fromEntries([...places.values()].filter((p) => p.atlas && p.sections.length).map((p) => [`${p.name} · ${p.region}`, p.sections])),
    enc: encMap,
    pseudo,
  };
  fs.writeFileSync(OUT, JSON.stringify(out) + "\n");
  console.log(`wrote ${path.relative(ROOT, OUT)} (${extra.length} new places, ${Object.keys(encMap).length} label mappings)`);
}

void main();
