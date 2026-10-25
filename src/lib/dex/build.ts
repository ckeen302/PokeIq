/**
 * Pure builders for the Moves / Abilities indexes of the Pokédex tabs.
 * Inputs are the committed snapshots (moves.json, pokedex-details.json,
 * pokedex.json); no I/O so they can be unit-tested.
 */

export interface RawMove {
  name: string;
  type: string;
  cls: string;
  power: number | null;
  accuracy: number | null;
  pp: number | null;
  priority: number;
  gen: number;
  effect: string;
}

export interface RawLearn {
  game: string;
  moves: [number, string, number, string?][];
}

export interface RawDexDetails {
  abilities: { name: string; hidden: boolean; effect: string }[];
  learnset: RawLearn | null;
}

export interface SpeciesRef {
  id: number;
  slug: string;
  name: string;
  types: string[];
}

export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’.:]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** How a Pokémon learns a move: L36 (level), L0 evo, M (TM/TR, with number), E, T. */
export interface LearnerRef {
  id: number;
  how: string[];
}

export interface MoveRecord {
  id: number;
  slug: string;
  name: string;
  type: string;
  cls: string;
  power: number | null;
  accuracy: number | null;
  pp: number | null;
  priority: number;
  gen: number;
  effect: string;
  learners: LearnerRef[];
}

const METHOD_ORDER = ["L", "M", "T", "E"];

function howLabel(method: string, level: number, tm?: string): string {
  if (method === "L") return level === 0 ? "Evolution" : `Lv. ${level}`;
  if (method === "M") return tm ?? "TM";
  if (method === "T") return "Tutor";
  return "Egg";
}

/** Stable URL slug per move id (a numeric suffix breaks the rare name collision). */
export function moveSlugs(moves: Record<string, { name: string }>): Map<number, string> {
  const used = new Set<string>();
  const out = new Map<number, string>();
  for (const [id, m] of Object.entries(moves)) {
    let slug = slugify(m.name);
    if (used.has(slug)) slug = `${slug}-${id}`;
    used.add(slug);
    out.set(Number(id), slug);
  }
  return out;
}

export function buildMoves(moves: Record<string, RawMove>, details: Record<string, RawDexDetails>): MoveRecord[] {
  const learners = new Map<number, LearnerRef[]>();
  for (const [pid, d] of Object.entries(details)) {
    if (!d.learnset) continue;
    const per = new Map<number, { m: string; label: string }[]>();
    for (const [mid, method, level, tm] of d.learnset.moves) {
      const list = per.get(mid) ?? [];
      list.push({ m: method, label: howLabel(method, level, tm) });
      per.set(mid, list);
    }
    for (const [mid, how] of per) {
      const list = learners.get(mid) ?? [];
      how.sort((a, b) => METHOD_ORDER.indexOf(a.m) - METHOD_ORDER.indexOf(b.m));
      list.push({ id: Number(pid), how: how.map((h) => h.label) });
      learners.set(mid, list);
    }
  }
  const slugs = moveSlugs(moves);
  return Object.entries(moves)
    .map(([id, m]) => {
      return {
        id: Number(id),
        slug: slugs.get(Number(id)) as string,
        name: m.name,
        type: m.type,
        cls: m.cls,
        power: m.power,
        accuracy: m.accuracy,
        pp: m.pp,
        priority: m.priority,
        gen: m.gen,
        effect: m.effect,
        learners: (learners.get(Number(id)) ?? []).sort((a, b) => a.id - b.id),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export interface AbilityRecord {
  slug: string;
  name: string;
  effect: string;
  /** Species with the ability: id plus whether it is their hidden ability. */
  holders: { id: number; hidden: boolean }[];
}

export function buildAbilities(details: Record<string, RawDexDetails>): AbilityRecord[] {
  const out = new Map<string, AbilityRecord>();
  for (const [pid, d] of Object.entries(details)) {
    for (const a of d.abilities) {
      const slug = slugify(a.name);
      const rec = out.get(slug) ?? { slug, name: a.name, effect: a.effect, holders: [] };
      if (!rec.effect && a.effect) rec.effect = a.effect;
      if (!rec.holders.some((h) => h.id === Number(pid) && h.hidden === a.hidden)) rec.holders.push({ id: Number(pid), hidden: a.hidden });
      out.set(slug, rec);
    }
  }
  return [...out.values()]
    .map((r) => ({ ...r, holders: r.holders.sort((a, b) => a.id - b.id) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Pretty game/version names for held-item rarity lists. */
export function versionLabel(v: string): string {
  const special: Record<string, string> = {
    "firered": "FireRed", "leafgreen": "LeafGreen", "heartgold": "HeartGold", "soulsilver": "SoulSilver",
    "black-2": "Black 2", "white-2": "White 2", "x": "X", "y": "Y",
    "omega-ruby": "Omega Ruby", "alpha-sapphire": "Alpha Sapphire",
    "ultra-sun": "Ultra Sun", "ultra-moon": "Ultra Moon",
    "lets-go-pikachu": "Let's Go Pikachu", "lets-go-eevee": "Let's Go Eevee",
    "brilliant-diamond": "Brilliant Diamond", "shining-pearl": "Shining Pearl",
  };
  return special[v] ?? v.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

export function versionGroupLabel(vg: string): string {
  const special: Record<string, string> = {
    "red-blue": "Red / Blue", "gold-silver": "Gold / Silver", "ruby-sapphire": "Ruby / Sapphire",
    "firered-leafgreen": "FireRed / LeafGreen", "diamond-pearl": "Diamond / Pearl", "heartgold-soulsilver": "HeartGold / SoulSilver",
    "black-white": "Black / White", "black-2-white-2": "Black 2 / White 2", "x-y": "X / Y",
    "omega-ruby-alpha-sapphire": "Omega Ruby / Alpha Sapphire", "sun-moon": "Sun / Moon",
    "ultra-sun-ultra-moon": "Ultra Sun / Ultra Moon", "lets-go-pikachu-lets-go-eevee": "Let's Go Pikachu / Eevee",
    "sword-shield": "Sword / Shield", "the-isle-of-armor": "Isle of Armor", "the-crown-tundra": "Crown Tundra",
    "brilliant-diamond-and-shining-pearl": "Brilliant Diamond / Shining Pearl", "legends-arceus": "Legends: Arceus",
    "scarlet-violet": "Scarlet / Violet", "the-teal-mask": "Teal Mask", "the-indigo-disk": "Indigo Disk",
    "legends-za": "Legends: Z-A", "mega-dimension": "Mega Dimension",
  };
  return special[vg] ?? vg.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");
}

export const itemSpriteUrl = (slug: string) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/items/${slug}.png`;
