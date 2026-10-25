/**
 * Pure transforms from raw PokéAPI item JSON to the compact record in
 * src/data/items.json (see scripts/dex/build-items.ts). No I/O here so the
 * builders stay unit-testable.
 */

export interface RawItem {
  name: string;
  category?: { name: string } | null;
  names?: { name: string; language: { name: string } }[];
  effect_entries?: { short_effect: string; effect: string; language: { name: string } }[];
  flavor_text_entries?: { text: string; language: { name: string } }[];
  game_indices?: { generation: { name: string } }[];
  held_by_pokemon?: { pokemon: { name: string }; version_details: { rarity: number; version: { name: string } }[] }[];
  machines?: { machine: { url: string }; version_group: { name: string } }[];
}

export interface RawMachine {
  id: number;
  version_group: { name: string };
  move: { name: string };
}

/** [rarity %, versions] groups for one Pokémon. */
export type HeldRarity = [number, string[]];

export interface ItemRecord {
  /** PokéAPI name, also the URL slug and sprite file name. */
  slug: string;
  name: string;
  category: string;
  effect: string;
  /** Generations (1-9) whose games contain the item. */
  gens: number[];
  /** Wild holders: [pokemon slug, rarity groups]. */
  held: [string, HeldRarity[]][];
  /** TM/TR/HM contents: [generation, version group, move slug]. */
  machines: [number, string, string][];
}

const ROMAN: Record<string, number> = { i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9 };

export function genFromName(name: string): number | null {
  const m = /^generation-([ivx]+)$/.exec(name);
  return m ? (ROMAN[m[1]] ?? null) : null;
}

/** Version group -> generation (mainline games only). */
export const VERSION_GROUP_GEN: Record<string, number> = {
  "red-blue": 1, yellow: 1,
  "gold-silver": 2, crystal: 2,
  "ruby-sapphire": 3, emerald: 3, "firered-leafgreen": 3,
  "diamond-pearl": 4, platinum: 4, "heartgold-soulsilver": 4,
  "black-white": 5, "black-2-white-2": 5,
  "x-y": 6, "omega-ruby-alpha-sapphire": 6,
  "sun-moon": 7, "ultra-sun-ultra-moon": 7, "lets-go-pikachu-lets-go-eevee": 7,
  "sword-shield": 8, "the-isle-of-armor": 8, "the-crown-tundra": 8, "brilliant-diamond-and-shining-pearl": 8, "legends-arceus": 8,
  "scarlet-violet": 9, "the-teal-mask": 9, "the-indigo-disk": 9, "legends-za": 9, "mega-dimension": 9,
};

export function titleCase(slug: string): string {
  return slug.split("-").map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(" ");
}

const en = <T extends { language: { name: string } }>(list: T[] | undefined) => list?.find((e) => e.language.name === "en");

export function cleanText(s: string): string {
  return s.replace(/\s+/g, " ").replace(/\[([^\]]*)\]\{[^}]*\}/g, "$1").trim();
}

/** An item is "mainline" when it exists in the item index of at least one mainline generation. */
export function isMainline(raw: RawItem): boolean {
  return (raw.game_indices ?? []).some((g) => genFromName(g.generation.name) !== null);
}

export function groupRarity(details: { rarity: number; version: { name: string } }[]): HeldRarity[] {
  const by = new Map<number, string[]>();
  for (const d of details) {
    const list = by.get(d.rarity) ?? [];
    if (!list.includes(d.version.name)) list.push(d.version.name);
    by.set(d.rarity, list);
  }
  return [...by.entries()].sort((a, b) => b[0] - a[0]).map(([r, v]) => [r, v]);
}

export function buildItem(raw: RawItem, machines: RawMachine[], knownPokemon: ReadonlySet<string>): ItemRecord {
  const gens = [...new Set((raw.game_indices ?? []).map((g) => genFromName(g.generation.name)).filter((g): g is number => g !== null))].sort((a, b) => a - b);
  const effectEntry = en(raw.effect_entries);
  const flavor = [...(raw.flavor_text_entries ?? [])].reverse().find((f) => f.language.name === "en");
  const effect = cleanText(effectEntry?.short_effect || effectEntry?.effect || flavor?.text || "");
  const held = (raw.held_by_pokemon ?? [])
    .filter((h) => knownPokemon.has(h.pokemon.name))
    .map((h): [string, HeldRarity[]] => [h.pokemon.name, groupRarity(h.version_details)])
    .sort((a, b) => a[0].localeCompare(b[0]));
  const mach = machines
    .map((m): [number, string, string] | null => {
      const gen = VERSION_GROUP_GEN[m.version_group.name];
      return gen ? [gen, m.version_group.name, m.move.name] : null;
    })
    .filter((m): m is [number, string, string] => m !== null)
    .sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  return {
    slug: raw.name,
    name: en(raw.names)?.name ?? titleCase(raw.name),
    category: titleCase(raw.category?.name ?? "misc"),
    effect,
    gens,
    held,
    machines: mach,
  };
}

/** Drops data-only entries: the "Unused" and "Dynamax Crystals" categories and anything with no English description. */
export function keepItem(rec: ItemRecord): boolean {
  return rec.category !== "Unused" && rec.category !== "Dynamax Crystals" && rec.effect.length > 0;
}
