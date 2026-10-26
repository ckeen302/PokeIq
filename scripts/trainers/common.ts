/**
 * Shared helpers for the trainer importers: resolve decompilation constants
 * (SPECIES_MR_MIME, PSYCHIC_M, ITEM_KINGS_ROCK…) to our Pokédex records and
 * rebuild the level-up default moveset the games give party Pokémon that
 * have no moves listed.
 */
import pokedex from "../../src/data/pokedex.json";
import movesData from "../../src/data/moves.json";
import itemsData from "../../src/data/items.json";
import { slugify } from "../../src/lib/dex/build";

export const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/♀/g, "f")
    .replace(/♂/g, "m")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const SPECIES = new Map<string, number>();
for (const p of pokedex as { id: number; name: string }[]) SPECIES.set(norm(p.name), p.id);
const SPECIES_ALIAS: Record<string, string> = { nidoranf: "nidoranf", nidoranm: "nidoranm", farfetchd: "farfetchd", mrmime: "mrmime", hooh: "hooh", mimejr: "mimejr", porygonz: "porygonz" };

/** SPECIES_NIDORAN_F / NIDORAN_F / "Nidoran♀" -> 29. Throws on anything unknown. */
export function speciesId(constant: string): number {
  const key = norm(constant.replace(/^SPECIES_/, ""));
  const id = SPECIES.get(SPECIES_ALIAS[key] ?? key);
  if (!id) throw new Error(`Unknown species ${constant}`);
  return id;
}

// Move slugs exactly as src/lib/dex/build.ts makes them (numeric suffix on the rare collision).
const MOVE_SLUG = new Map<string, string>();
{
  const used = new Set<string>();
  for (const [id, m] of Object.entries(movesData as Record<string, { name: string }>).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    let slug = slugify(m.name);
    if (used.has(slug)) slug = `${slug}-${id}`;
    used.add(slug);
    if (!MOVE_SLUG.has(norm(m.name))) MOVE_SLUG.set(norm(m.name), slug);
  }
}
/** Decomp spellings that differ from the move's modern English name. */
const MOVE_ALIAS: Record<string, string> = {
  psychicm: "psychic",
  hijumpkick: "highjumpkick",
  faintattack: "feintattack",
  vicegrip: "visegrip",
  smellingsalt: "smellingsalts",
  smellingsalt2: "smellingsalts",
  selfdestruct: "selfdestruct",
  ancientpower: "ancientpower",
  conversion2: "conversion2",
};
/** MOVE_THUNDERBOLT / PSYCHIC_M -> "thunderbolt" / "psychic". Throws on anything unknown. */
export function moveSlug(constant: string): string {
  const key = norm(constant.replace(/^MOVE_/, ""));
  const slug = MOVE_SLUG.get(MOVE_ALIAS[key] ?? key);
  if (!slug) throw new Error(`Unknown move ${constant}`);
  return slug;
}

const ITEM_SLUG = new Map<string, string>();
for (const i of itemsData as { slug: string; name: string }[]) ITEM_SLUG.set(norm(i.name), i.slug);
/** Gen II–IV spellings of items our item list names differently. */
const ITEM_ALIAS: Record<string, string> = {
  miracleberry: "miracleberry",
  brightpowder: "brightpowder",
  twistedspoon: "twistedspoon",
  blackglasses: "blackglasses",
  nevermeltice: "nevermeltice",
  silverpowder: "silverpowder",
  deepseascale: "deepseascale",
  deepseatooth: "deepseatooth",
  thickclub: "thickclub",
  kingsrock: "kingsrock",
  upgrade: "upgrade",
  parlyzheal: "paralyzeheal",
  xdefend: "xdefense",
  xspecial: "xspatk",
  xspatk: "xspatk",
  xspdef: "xspdef",
  hpup: "hpup",
};
/** ITEM_KINGS_ROCK -> "kings-rock" when our item list has it, else the in-game name ("Gold Berry"). */
export function itemRef(constant: string, displayName?: string): string {
  const raw = constant.replace(/^ITEM_/, "");
  const key = norm(raw);
  const slug = ITEM_SLUG.get(ITEM_ALIAS[key] ?? key);
  if (slug) return slug;
  return displayName ?? titleConstant(raw);
}

/** BUG_CATCHER -> "Bug Catcher"; keeps short all-caps words like "TM". */
export function titleConstant(c: string): string {
  return c
    .toLowerCase()
    .split(/_+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** "BUG CATCHER", "PKMN TRAINER", "JR.TRAINER♂" -> "Bug Catcher", "Pkmn Trainer", "Jr. Trainer♂". */
export function titleName(s: string): string {
  const special: Record<string, string> = { "POKéMANIAC": "PokéManiac", "POKéFAN": "PokéFan", "PKMN": "Pokémon", "TEAM": "Team", "CEO": "CEO", "PI": "PI", "SS": "S.S.", "RS": "RS" };
  return s
    .replace(/\{[^}]*\}/g, "")
    .replace(/\s*&\s*/g, " & ")
    .replace(/@$/, "")
    .replace(/\./g, ". ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => special[w] ?? special[w.toUpperCase()] ?? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase().replace(/é/g, "é"))
    .join(" ")
    .replace(/\. (?=[♂♀]|$)/g, ".")
    .replace(/Pokémaniac/g, "PokéManiac")
    .replace(/Pokéfan/g, "PokéFan")
    .replace(/ (Of|The|And) /g, (m) => m.toLowerCase())
    .replace(/Mc([a-z])/g, (_, c: string) => `Mc${c.toUpperCase()}`)
    .trim();
}

export type Learnset = { level: number; move: string }[];

/**
 * The default moveset every main-series game from Gen I to IV gives a party
 * Pokémon with no moves listed: start from the base moves (Gen I's "level 1
 * learnset"), then walk the level-up learnset in order up to the Pokémon's
 * level, skipping moves it already knows and, once all four slots are full,
 * dropping the oldest move to make room (WriteMonMoves / FillMoves /
 * GiveBoxMonInitialMoveset / Pokemon_SetDefaultMoves).
 */
export function defaultMoves(level: number, learnset: Learnset, base: string[] = [], stopAtFirstHigher = true): string[] {
  const moves = base.filter(Boolean).slice(0, 4);
  for (const e of learnset) {
    if (e.level > level) {
      if (stopAtFirstHigher) break;
      continue;
    }
    if (moves.includes(e.move)) continue;
    if (moves.length === 4) moves.shift();
    moves.push(e.move);
  }
  return moves;
}

/** Strip `;` assembly comments. */
export const stripAsm = (line: string) => line.replace(/;.*$/, "").trim();

/** Split an assembly operand list ("10, PIDGEY, 0"). */
export const operands = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter((x) => x.length);

export function parseNum(s: string): number {
  s = s.trim();
  if (s.startsWith("$")) return parseInt(s.slice(1), 16);
  if (/^0x/i.test(s)) return parseInt(s, 16);
  if (/^%/.test(s)) return parseInt(s.slice(1), 2);
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Not a number: ${s}`);
  return n;
}

export const areaSlug = (name: string) => slugify(name.replace(/&/g, "and"));
