/**
 * Serebii per-generation location pages (`pokedex-{gs,rs,dp,bw,xy,sm}/location/NNN.shtml`):
 * the Gen 1-7 cross-check for PokéAPI. They fill places PokéAPI lacks (most of Omega Ruby /
 * Alpha Sapphire, Platinum, Ultra Sun / Ultra Moon incl. Ultra Space) and confirm PokéAPI rows.
 */
import type { RawRow } from "../../src/lib/pokemon/encounter-transform";
import { levels, place, text } from "./serebii";

/** Page key -> cached file prefix, Serebii folder and version anchors on that page. */
export const LOC_PAGES: Record<string, { file: string; dir: string; maxId: number; anchors: Record<string, string> }> = {
  rby: { file: "loc-pokedex", dir: "pokedex", maxId: 151, anchors: { r: "red", g: "blue", y: "yellow" } },
  gs: { file: "loc-pokedex-gs", dir: "pokedex-gs", maxId: 251, anchors: { g: "gold", s: "silver", c: "crystal" } },
  rs: { file: "loc-pokedex-rs", dir: "pokedex-rs", maxId: 386, anchors: { ruby: "ruby", sapphire: "sapphire", emerald: "emerald", firered: "firered", leafgreen: "leafgreen" } },
  dp: { file: "loc-pokedex-dp", dir: "pokedex-dp", maxId: 493, anchors: { diamond: "diamond", pearl: "pearl", platinum: "platinum", hg: "heartgold", ss: "soulsilver" } },
  bw: { file: "loc-pokedex-bw", dir: "pokedex-bw", maxId: 649, anchors: { black: "black", white: "white", black2: "black-2", white2: "white-2" } },
  xy: { file: "loc-pokedex-xy", dir: "pokedex-xy", maxId: 721, anchors: { x: "x", y: "y", or: "omega-ruby", as: "alpha-sapphire" } },
  sm: { file: "loc-pokedex-sm", dir: "pokedex-sm", maxId: 809, anchors: { sun: "sun", moon: "moon", ultrasun: "ultra-sun", ultramoon: "ultra-moon" } },
};

/** One table row of a location page, cells keyed by column header. */
export interface LocCell {
  ver: string;
  loc: string;
  cells: Record<string, string>;
}

/** Table rows of a location page, per version anchor. */
export function parseLocTables(html: string, anchors: Record<string, string>): LocCell[] {
  html = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, "");
  const parts = html.split(/<a name="([^"]+)">/);
  const out: LocCell[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const ver = anchors[parts[i]];
    if (!ver) continue;
    let sec = parts[i + 1];
    const hdr = [...sec.matchAll(/<td class="lochead"[^>]*>([\s\S]*?)<\/td>/g)].map((m) => text(m[1]));
    if (!hdr.length) continue;
    sec = sec.slice(sec.indexOf("lochead"));
    // Serebii leaves cells unclosed and nests a table in the Gen 4 method cell, so a row
    // starts at each cell linking a place (not a "Specific Patches" map link).
    const rows: string[][] = [];
    for (const sg of sec.split(/<td[^>]*class="fooinfo"[^>]*>/).slice(1)) {
      if (/href="\/pokearth\/(?!maps\/)/.test(sg.split("</td>")[0]) || !rows.length) rows.push([sg]);
      else rows[rows.length - 1].push(sg);
    }
    for (const r of rows) {
      if (r.length < hdr.length) continue;
      const link = r[0].match(/<a href="\/pokearth\/(?!maps\/)[^"]*"[^>]*>([\s\S]*?)<\/a>/);
      if (!link) continue;
      const cells: Record<string, string> = {};
      r.slice(0, hdr.length).forEach((c, k) => (cells[hdr[k]] = text(k === hdr.length - 1 ? c.split("</td>")[0] : c)));
      out.push({ ver, loc: text(link[1]), cells });
    }
  }
  return out;
}

const CAVE_LIKE = /cave|tunnel|mt\.? |mount |ruins|grotto|mine\b|chamber|cavern|basement|\b\d+f\b|\bb\d+f\b|tower|well\b|depths|lair|hall\b|sewers?|relic|seafloor|path\b|\bpit\b|room\b/i;

/** Serebii method cell -> our label, a note and the time slots it covers; null = skip the row. */
export function locMethod(raw: string, loc: string): { m: string; n?: string; slots?: number[] } | null {
  const cave = CAVE_LIKE.test(loc);
  const walk = cave ? "Cave" : "Grass";
  const s = raw.trim();
  if (/Inserted$|Sound$/.test(s)) return null; // Gen 4 dual-slot and radio tables (niche, as for PokéAPI)
  if (/^In the Sky|Rare Spawns$/.test(s)) return null; // Let's Go (built from its own page)
  const safari = "Needs Safari Zone objects placed";
  const table: Record<string, { m: string; n?: string; slots?: number[] }> = {
    "Walking / Grass": { m: walk },
    Walk: { m: walk },
    Walks: { m: walk },
    Grass: { m: walk },
    "": { m: walk },
    Morning: { m: walk, slots: [0] },
    Day: { m: walk, slots: [1] },
    Night: { m: walk, slots: [2] },
    "Morning Details": { m: "Grass", n: safari, slots: [0] },
    "Day Details": { m: "Grass", n: safari, slots: [1] },
    "Night Details": { m: "Grass", n: safari, slots: [2] },
    "Walk - Blocks Details": { m: "Grass", n: safari },
    "Walk - Shaking Spots": { m: cave ? "Dust cloud" : "Rustling grass" },
    "Fish - Shaking Spots": { m: "Fishing spot" },
    "Surf - Shaking Spots": { m: "Rippling water" },
    "Double Grass": { m: "Dark grass" },
    Fish: { m: "Fishing" },
    "Fish Special": { m: "Fishing", n: "Bubbling spot" },
    "Fish- Special": { m: "Fishing spot" },
    "Surf Special": { m: "Surf", n: "Rippling water" },
    "Headbutt N.": { m: "Headbutt" },
    "Headbutt Sp.": { m: "Headbutt", n: "Rare trees" },
    Interact: { m: "Static" },
    Special: { m: "Special encounter" },
    Swarm: { m: walk, n: "Swarm" },
    PokeRadar: { m: "Grass", n: "Poké Radar" },
    "PokéRadar": { m: "Grass", n: "Poké Radar" },
    "Honey Trees": { m: "Honey tree" },
    "Hidden Hollow": { m: "Hidden Grotto" },
    "Ns Pokémon": { m: "Static", n: "N's Pokémon" },
    Roaming: { m: "Roaming" },
    "Roaming in Grass": { m: "Roaming" },
    Underwater: { m: "Dive" },
    "Tall Grass": { m: "Tall grass" },
    Water: { m: "Surf" },
    Dust: { m: "Dust cloud" },
    "Shaking Grass": { m: "Rustling grass" },
    "Shaking Trees": { m: "Shaking tree" },
    Berry: { m: "Berry pile" },
    "Weather SOS Battle": { m: "SOS call" },
    "From totem after completion of game": { m: "Static", n: "Totem Pokémon, after the Hall of Fame" },
  };
  return table[s] ?? { m: s.replace(/^./, (c) => c.toUpperCase()) };
}

const pct = (s: string | undefined) => {
  const m = s?.match(/(\d+)\s*%/);
  return m ? Number(m[1]) : undefined;
};
const NO_RATE = /^(Static|Gift|Roaming)$/;

/** A location page -> RawRows, time-of-day rates folded into Morning / Day / Night like PokéAPI rows. */
export function rowsFromLocPage(html: string, anchors: Record<string, string>): RawRow[] {
  const seen = new Set<string>();
  const groups = new Map<string, { row: RawRow; slots: [number, number, number]; rated: boolean; word?: string }>();
  for (const c of parseLocTables(html, anchors)) {
    const g = c.cells;
    const dup = JSON.stringify([c.ver, c.loc, { ...g, "Grass Patch": "" }]);
    if (seen.has(dup)) continue; // the same row repeated once per grass patch
    seen.add(dup);
    const meth = locMethod(g.Method ?? "", c.loc);
    if (!meth) continue;
    let slots = meth.slots ?? [0, 1, 2];
    const time = (g.Time ?? "").trim();
    const alola = g["Initial or SOS"] !== undefined;
    if (time === "Morning") slots = [0];
    else if (time === "Day") slots = alola ? [0, 1] : [1]; // Alola only has day and night
    else if (time === "Night") slots = [2];
    const notes = [meth.n];
    const season = (g.Season ?? "").replace("Summmer", "Summer").trim();
    if (season && season !== "All") notes.push(`${season} only`);
    const m = g["Initial or SOS"] === "SOS Battle Only" ? "SOS call" : meth.m;
    const rare = (g.Rarity ?? "").trim();
    const weather = rare.match(/^(Rain|Snow|Sandstorm|Hail)\b/)?.[1];
    if (weather) notes.push(`Weather: ${weather}`);
    const lo = (g["Min Level"] ?? g["Min. Level"] ?? "").trim();
    const hi = (g["Max Level"] ?? "").trim();
    const lvRaw = (g.Level ?? (lo && hi ? `${lo} - ${hi}` : lo || hi)).replace(/^Lv\.\s*/, "");
    const lv = levels(lvRaw);
    const n = notes.filter(Boolean).join(", ") || undefined;
    const row: RawRow = { ver: c.ver, ...place(c.loc), m };
    if (!row.sub) delete row.sub;
    if (lv) row.lv = lv;
    if (n) row.n = n;
    const key = JSON.stringify([row.ver, c.loc, row.m, row.lv, row.n]);
    const cur = groups.get(key) ?? { row, slots: [0, 0, 0] as [number, number, number], rated: false };
    const r = pct(rare);
    if (r !== undefined) {
      for (const s of slots) cur.slots[s] += r;
      cur.rated = true;
    } else if (/^(Common|Uncommon|Rare|Very Rare)$/.test(rare)) cur.word = rare;
    groups.set(key, cur);
  }
  return [...groups.values()].map(({ row, slots, rated, word }) => {
    if (rated && !NO_RATE.test(row.m!) && Math.max(...slots) <= 100) {
      const [a, b, c] = slots;
      if (a === b && b === c) row.r = `${a}%`;
      else row.t = slots.map((v) => (v ? `${v}%` : "—")) as [string, string, string];
    } else if (word && !NO_RATE.test(row.m!)) row.r = word;
    return row;
  });
}

/* ------------------------------------------------------- place matching -- */

const ALIAS: Record<string, string> = {
  "nature sanctuary": "nature preserve",
  "johto safari zone": "safari zone",
  "silver cave": "mt silver",
  "kanto power plant": "power plant",
  "bell tower": "tin tower",
  "ss anne": "vermilion city harbor",
  "unova victory road": "victory road",
  "kanto victory road": "victory road",
  // PokéAPI names the Underground Ruins chambers after their terrain.
  "glacier room": "underground ruins iceberg",
  "iron room": "underground ruins iron",
  "rocky mountain room": "underground ruins rock peak",
  "alola berry fields": "berry fields",
  // Serebii: "Tanoby Ruins - Rixy Chamber"; PokéAPI: "Rixy Chamber".
  "tanoby ruins": "",
};
const SUFFIX = /( (b?\d+f|area \d+|room \d+|basement|entrance|interior|exterior|inside|outside|top|summit|depths|lower|upper|north|south|east|west|chamber))+$/;

/** Loose place key shared by PokéAPI labels and Serebii link text. */
export function placeKey(s: string): string {
  let k = s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[.'’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^(kanto|johto|hoenn|sinnoh|unova|kalos|alola) (route \d+)$/, "$2")
    .replace(/\bmount\b/g, "mt")
    .replace(/^the /, "")
    .replace(/^sea (route \d+)/, "$1");
  if (!/^route \d+$/.test(k)) k = k.replace(SUFFIX, "");
  for (const [a, b] of Object.entries(ALIAS)) if (k === a || k.startsWith(a + " ")) k = (b + k.slice(a.length)).trim() || k;
  return k;
}

/** Same place, allowing one name to extend the other ("mistralton cave" ~ "mistralton cave guidance"). */
export function samePlace(a: string, b: string): boolean {
  return a === b || a.startsWith(b + " ") || b.startsWith(a + " ");
}

/**
 * Weaker evidence that two names are one place: one is a whole-word part of the other
 * ("guidance" in "mistralton cave guidance", "trial" in "relic castle trial").
 */
export function partOfPlace(a: string, b: string): boolean {
  if (samePlace(a, b)) return true;
  const inside = (x: string, y: string) => x.length >= 5 && ` ${y} `.includes(` ${x} `);
  return inside(a, b) || inside(b, a);
}
