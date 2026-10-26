import dexData from "@/data/pokedex.json";
import detailsData from "@/data/pokedex-details.json";
import movesData from "@/data/moves.json";
import ouData from "@/data/smogon/gen9ou.json";
import { GENERATION_REGIONS } from "@/lib/pokemon/constants";
import { HISUI_SPECIES_IDS, MEGA_ZA_IDS, PARADOX_IDS, STARTER_IDS, ULTRA_BEAST_IDS } from "./curated";
import type { PdkFamily } from "./types";

/**
 * Pikadoku's categories: a label and a predicate over one species. Built once
 * from the committed data; every rule about forms and regions lives here so
 * it is applied the same way everywhere.
 */

interface Raw {
  id: number;
  name: string;
  gen: number;
  types: string[];
  stats: Record<"hp" | "atk" | "def" | "spa" | "spd" | "spe", number>;
  bst: number;
  stage: number;
  fullyEvolved: boolean;
  chain: number;
  evolvesFrom: number | null;
  legendary: boolean;
  mythical: boolean;
  abilities: { name: string; hidden: boolean }[];
}
interface Details {
  isBaby: boolean;
  evolution: string[];
  forms: { id: number; slug: string; name: string; types: string[]; stats: Raw["stats"]; abilities: { name: string; hidden: boolean }[] }[];
  learnset: { moves: [number, string, number, string?][] } | null;
}

/** What kind of form an entry is: a regional form, a Mega, a Gigantamax, or another notable form (Partner, Primal, Origin, Crowned, Eternamax). */
export type FormKind = "regional" | "mega" | "gmax" | "special";

export interface Facts extends Raw {
  /** The species this entry belongs to (its own id for a species). A form and its species are one Pokémon for no-reuse. */
  baseId: number;
  /** Set for a form entry. */
  form?: FormKind;
  /** A form's slug (for the picker). */
  slug?: string;
  region: string;
  isBaby: boolean;
  fossil: boolean;
  hasMega: boolean;
  hasGmax: boolean;
  /** Debut regions of its regional forms (Alola, Galar, Hisui, Paldea). */
  formRegions: string[];
  /**
   * Every evolution step the Pokémon takes part in, lower-cased: how it evolved
   * (from its pre-evolution) and how it evolves (into each next stage). A
   * "Stone evolution" counts Pikachu (evolves with a Thunder Stone) and Raichu
   * (evolved with one) alike, so neither reading of the category is marked wrong.
   */
  evolvesBy: string[];
  hasEvolution: boolean;
  chainSize: number;
  /**
   * The stages it counts as. A line that starts with a baby gives two answers:
   * counted with the baby (Pichu 1, Pikachu 2, Raichu 3) and without it, as the
   * TCG does (Pikachu Basic, Raichu a second stage). Either is accepted.
   */
  stages: number[];
  /** The deepest stage in its family (3 for a three-stage line). */
  lineDepth: number;
  /** Some member of its family evolves into two or more species (Eevee, Oddish's line, Wurmple's...). */
  branching: boolean;
  moves: Set<string>;
  ou: boolean;
}

export interface PdkCategory {
  id: string;
  family: PdkFamily;
  label: string;
  /** 1 broad, 2 normal, 3 hard (expert only). */
  tier: 1 | 2 | 3;
  /** Two categories of one group never share a grid. */
  group: string;
  test: (f: Facts) => boolean;
  /** In PokeDoku's mix: what Normal dailies and Unlimited's defaults draw from. */
  classic: boolean;
}

const FOSSILS = new Set([138, 139, 140, 141, 142, 345, 346, 347, 348, 408, 409, 410, 411, 564, 565, 566, 567, 696, 697, 698, 699, 880, 881, 882, 883]);
const FORM_REGION: Record<string, string> = { alola: "Alola", galar: "Galar", hisui: "Hisui", paldea: "Paldea" };
const cap = (s: string) => s.replace(/(^|[\s-])([a-z])/g, (_, a, b) => a + b.toUpperCase());

const SPECIAL_FORMS = new Set(["starter", "primal", "origin", "crowned", "eternal"]);
/** Debut generation of a regional form (Hisui's Legends: Arceus is no numbered generation: 0). */
const FORM_GEN: Record<string, number> = { alola: 7, galar: 8, hisui: 0, paldea: 9 };

/** Which forms get their own picker entry: regional forms, Megas, Gigantamax and a few notable forms. Totem and cosmetic forms don't. */
export function formKind(slug: string): FormKind | null {
  const parts = slug.split("-").slice(1);
  if (parts.includes("totem")) return null;
  if (parts.includes("mega")) return "mega";
  if (parts.includes("gmax")) return "gmax";
  if (parts.some((x) => FORM_REGION[x])) return "regional";
  if (parts.some((x) => SPECIAL_FORMS.has(x))) return "special";
  return null;
}

/** The region of a form slug: regional forms debut in their own region; Mega and Gigantamax follow the base (null here). */
export function formRegion(slug: string): string | null {
  const parts = slug.split("-").slice(1);
  if (parts.includes("mega") || parts.includes("gmax")) return null;
  for (const part of parts) if (FORM_REGION[part]) return FORM_REGION[part];
  return null;
}

const dex = dexData as unknown as Raw[];
const details = detailsData as unknown as Record<string, Details>;
const moveNames = movesData as unknown as Record<string, { name: string }>;
/**
 * The Gen 9 OU usage list, by species: "Landorus-Therian" and "Ogerpon-Wellspring"
 * count for their species, "Ting-Lu" is a species name with a hyphen, and a
 * regional suffix ("Slowking-Galar") names only that regional form, not the species.
 */
const dexNames = new Set(dex.map((p) => p.name.toLowerCase()));
const ouSpecies = new Set<string>();
const ouRegional = new Set<string>();
for (const { species } of (ouData as { pokemon: { species: string }[] }).pokemon) {
  const full = species.toLowerCase();
  if (dexNames.has(full)) {
    ouSpecies.add(full);
    continue;
  }
  const [base, ...rest] = full.split("-");
  const region = rest.find((x) => FORM_REGION[x]);
  if (region) ouRegional.add(`${base}|${region}`);
  else ouSpecies.add(base);
}

/**
 * Evolution methods the data lacks or files under "Other" (Scarlet & Violet's
 * newer evolutions), worded from the games (Bulbapedia: "Methods of evolution").
 */
const EVOLUTION_FIXES: Record<number, string[]> = {
  809: ["Pokémon GO: 400 Meltan Candy"], // Melmetal
  923: ["Level up after walking 1,000 steps in Let's Go mode"], // Pawmot
  925: ["Level 25"], // Maushold
  947: ["Level up after walking 1,000 steps in Let's Go mode"], // Brambleghast
  954: ["Level up after walking 1,000 steps in Let's Go mode"], // Rabsca
  964: ["Level 38 in a Union Circle"], // Palafin
  979: ["Level up after using Rage Fist 20 times"], // Annihilape
  983: ["Level up after defeating three Bisharp that hold a Leader's Crest"], // Kingambit
  1000: ["Level up with 999 Gimmighoul Coins"], // Gholdengo
  1011: ["Use Syrupy Apple"], // Dipplin
  1013: ["Use Unremarkable Teacup", "Use Masterpiece Teacup"], // Sinistcha
  1018: ["Use Metal Alloy"], // Archaludon
  1019: ["Level up knowing Dragon Cheer"], // Hydrapple
};
/** How a species evolved from its pre-evolution, lower-cased. */
const evolvedBy = (id: number): string[] => (EVOLUTION_FIXES[id] ?? (details[id]?.evolution ?? []).filter((m) => m !== "Other")).map((m) => m.toLowerCase());

let table: Facts[] | null = null;
export function allFacts(): Facts[] {
  if (table) return table;
  const children = new Map<number, number[]>();
  const sizes = new Map<number, number>();
  const depth = new Map<number, number>();
  const byId = new Map(dex.map((p) => [p.id, p]));
  for (const p of dex) {
    sizes.set(p.chain, (sizes.get(p.chain) ?? 0) + 1);
    depth.set(p.chain, Math.max(depth.get(p.chain) ?? 0, p.stage));
    if (p.evolvesFrom) children.set(p.evolvesFrom, [...(children.get(p.evolvesFrom) ?? []), p.id]);
  }
  const branchingChains = new Set(dex.filter((p) => (children.get(p.id)?.length ?? 0) > 1).map((p) => p.chain));
  const rootOf = (p: Raw): Raw => (p.evolvesFrom && byId.has(p.evolvesFrom) ? rootOf(byId.get(p.evolvesFrom)!) : p);
  const stagesOf = (p: Raw): number[] => (p.stage > 1 && details[rootOf(p).id]?.isBaby ? [p.stage, p.stage - 1] : [p.stage]);
  const species: Facts[] = dex.map((p) => {
    const d = details[p.id];
    const kids = children.get(p.id) ?? [];
    return {
      ...p,
      baseId: p.id,
      region: GENERATION_REGIONS[p.gen] ?? "Unknown",
      isBaby: !!d?.isBaby,
      fossil: FOSSILS.has(p.id),
      hasMega: !!d?.forms.some((f) => f.slug.split("-").includes("mega")),
      hasGmax: !!d?.forms.some((f) => f.slug.split("-").includes("gmax")),
      formRegions: [...new Set((d?.forms ?? []).map((f) => formRegion(f.slug)).filter((r): r is string => !!r))],
      evolvesBy: [...evolvedBy(p.id), ...kids.flatMap(evolvedBy)],
      hasEvolution: kids.length > 0,
      chainSize: sizes.get(p.chain) ?? 1,
      stages: stagesOf(p),
      lineDepth: depth.get(p.chain) ?? p.stage,
      branching: branchingChains.has(p.chain),
      moves: new Set((d?.learnset?.moves ?? []).map((m) => moveNames[m[0]]?.name).filter((n): n is string => !!n)),
      ou: ouSpecies.has(p.name.toLowerCase()),
    };
  });
  // Forms: their own types, stats and abilities; the debut region of a regional form, the species' region for the rest;
  // everything else (evolution line, legendary status, moves) is the species'.
  const forms: Facts[] = [];
  for (const sp of species) {
    for (const f of details[sp.id]?.forms ?? []) {
      const kind = formKind(f.slug);
      if (!kind) continue;
      const key = kind === "regional" ? Object.keys(FORM_REGION).find((k) => f.slug.split("-").slice(1).includes(k)) : undefined;
      forms.push({
        ...sp,
        id: f.id,
        baseId: sp.id,
        form: kind,
        slug: f.slug,
        name: f.name,
        types: f.types,
        stats: f.stats,
        bst: Object.values(f.stats).reduce((a, b) => a + b, 0),
        abilities: f.abilities.map((a) => ({ name: a.name, hidden: a.hidden })),
        // A regional form is OU only when the usage data names that form ("Slowking-Galar").
        ...(key && { gen: FORM_GEN[key], region: FORM_REGION[key], ou: ouRegional.has(`${sp.name.toLowerCase()}|${key}`) }),
      });
    }
  }
  return (table = [...species, ...forms]);
}

let baseMap: Map<number, number> | null = null;
/** The species a Pokémon id belongs to (a form maps to its species). A form and its species count as the same Pokémon. */
export function baseOf(id: number): number {
  if (!baseMap) baseMap = new Map(allFacts().filter((f) => f.baseId !== f.id).map((f) => [f.id, f.baseId]));
  return baseMap.get(id) ?? id;
}

const TYPE_LIST = ["normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison", "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy"];
const STAT_NAMES = { hp: "HP", atk: "Attack", def: "Defense", spa: "Sp. Atk", spd: "Sp. Def", spe: "Speed" } as const;
/** An item is used or held: stones, apples, Galarica, held trade items. "Use Psyshield Bash 20 times" is a move, not an item. */
const itemEvo = (m: string) => (/^use /.test(m) && !/\d+ times/.test(m)) || /holding/.test(m);
/** The ten evolution stones (an Oval Stone is held, not used, so it doesn't count). */
const stoneEvo = (m: string) => /^use \w+ stone\b/.test(m);
const MEGA_ZA = new Set(MEGA_ZA_IDS);
const HISUI_SPECIES = new Set(HISUI_SPECIES_IDS);

const PARADOX = new Set(PARADOX_IDS);
const ULTRA_BEAST = new Set(ULTRA_BEAST_IDS);
/** Every evolution line that starts from a starter, derived from the data's chain ids. */
const STARTER_CHAINS = new Set(dex.filter((p) => STARTER_IDS.includes(p.id)).map((p) => p.chain));

/** The famous moves PokeDoku draws on (at most one per Normal grid). */
export const CLASSIC_MOVES = ["Acrobatics", "Brick Break", "Calm Mind", "Close Combat", "Crunch", "Dazzling Gleam", "Earthquake", "Flamethrower", "Fly", "Hydro Pump", "Ice Beam", "Ice Punch", "Metronome", "Protect", "Psychic", "Razor Leaf", "Shadow Ball", "Sludge Bomb", "Surf", "Tail Slap", "Thunderbolt"];
const CLASSIC_IDS = new Set(["types:dual", "types:single", "evo:none", "evo:item", "evo:notfull", "other:legendary", "other:mythical", "other:fossil", "other:baby", "other:mega", "other:gmax", "other:paradox", "other:ultrabeast", "other:partner", ...CLASSIC_MOVES.map((m) => `move:${m}`)]);
const isClassic = (id: string) => /^type:|^region:\d/.test(id) || CLASSIC_IDS.has(id);

function build(): PdkCategory[] {
  const out: PdkCategory[] = [];
  const add = (id: string, family: PdkFamily, label: string, tier: 1 | 2 | 3, test: (f: Facts) => boolean, group = id) => out.push({ id, family, label, tier, group, test, classic: isClassic(id) });
  for (const t of TYPE_LIST) add(`type:${t}`, "types", cap(t), 1, (f) => f.types.includes(t));
  add("types:dual", "types", "Dual-type", 1, (f) => f.types.length === 2, "typecount");
  add("types:single", "types", "Monotype", 1, (f) => f.types.length === 1, "typecount");
  for (const [gen, region] of Object.entries(GENERATION_REGIONS)) add(`region:${gen}`, "regions", region, 1, (f) => f.gen === Number(gen));
  add("region:hisui", "regions", "Hisui", 3, (f) => f.region === "Hisui" || (!f.form && HISUI_SPECIES.has(f.id)));
  for (const [key, region] of Object.entries(FORM_REGION)) add(`form:${key}`, "regions", `${region} form`, 2, (f) => f.formRegions.includes(region));
  add("evo:basic", "evolution", "Basic", 1, (f) => f.stages.includes(1), "stage");
  add("evo:stage2", "evolution", "Second stage", 1, (f) => f.stages.includes(2), "stage");
  add("evo:stage3", "evolution", "Third stage", 2, (f) => f.stages.includes(3), "stage");
  add("evo:notfull", "evolution", "Not fully evolved", 1, (f) => !f.fullyEvolved, "evolves");
  add("evo:full", "evolution", "Fully evolved", 1, (f) => f.fullyEvolved, "evolves");
  add("evo:none", "evolution", "No evolution line", 2, (f) => f.chainSize === 1, "evolves");
  add("evo:item", "evolution", "Item evolution", 2, (f) => f.evolvesBy.some(itemEvo));
  add("evo:stone", "evolution", "Stone evolution", 2, (f) => f.evolvesBy.some(stoneEvo));
  add("evo:trade", "evolution", "Trade evolution", 2, (f) => f.evolvesBy.some((m) => /trade/.test(m)));
  add("evo:friend", "evolution", "Friendship evolution", 2, (f) => f.evolvesBy.some((m) => /friendship|affection/.test(m)));
  add("evo:level", "evolution", "Level-up evolution", 2, (f) => f.evolvesBy.some((m) => /^level \d/.test(m)));
  add("evo:branch", "evolution", "Branching evolution", 3, (f) => f.branching);
  add("evo:three", "evolution", "Three-stage line", 2, (f) => f.lineDepth >= 3);
  add("other:legendary", "other", "Legendary", 1, (f) => f.legendary, "legend");
  add("other:mythical", "other", "Mythical", 2, (f) => f.mythical, "legend");
  add("other:lm", "other", "Legendary or Mythical", 2, (f) => f.legendary || f.mythical, "legend");
  add("other:fossil", "other", "Fossil", 2, (f) => f.fossil);
  add("other:baby", "other", "Baby", 2, (f) => f.isBaby);
  add("other:mega", "other", "Mega", 2, (f) => f.hasMega || MEGA_ZA.has(f.baseId));
  add("other:gmax", "other", "GMax", 2, (f) => f.hasGmax);
  add("other:paradox", "other", "Paradox", 2, (f) => PARADOX.has(f.baseId));
  add("other:ultrabeast", "other", "Ultra-Beast", 2, (f) => ULTRA_BEAST.has(f.baseId));
  add("other:partner", "other", "First Partner", 2, (f) => STARTER_CHAINS.has(f.chain));
  add("other:ou", "other", "Gen 9 OU", 3, (f) => f.ou);
  add("ability:hidden", "abilities", "Hidden ability", 1, (f) => f.abilities.some((a) => a.hidden));
  for (const [stat, name] of Object.entries(STAT_NAMES)) {
    const hi = stat === "atk" || stat === "spa" ? 120 : 100;
    add(`stat:${stat}:${hi}`, "other", `Base ${name} ${hi}+`, 2, (f) => f.stats[stat as keyof typeof STAT_NAMES] >= hi, `stat:${stat}`);
  }
  add("stat:slow", "other", "Base Speed 40 or less", 2, (f) => f.stats.spe <= 40, "stat:spe");
  add("stat:bst600", "other", "Base stat total 600+", 3, (f) => f.bst >= 600, "bst");
  add("stat:bst500", "other", "Base stat total 500+", 2, (f) => f.bst >= 500, "bst");
  add("stat:bst300", "other", "Base stat total under 300", 2, (f) => f.bst < 300, "bst");
  // Abilities and moves: every one shared by enough species to fill a cell.
  const ab = new Map<string, number>();
  const mv = new Map<string, number>();
  // Counted over species only, so the category list (and its tiers) is the same as before forms were picks.
  for (const f of allFacts().filter((x) => !x.form)) {
    for (const a of new Set(f.abilities.map((x) => x.name))) ab.set(a, (ab.get(a) ?? 0) + 1);
    for (const m of f.moves) mv.set(m, (mv.get(m) ?? 0) + 1);
  }
  for (const [name, n] of ab) if (n >= 10) add(`ability:${name}`, "abilities", cap(name.replace(/-/g, " ")), n >= 40 ? 2 : 3, (f) => f.abilities.some((a) => a.name === name));
  for (const [name, n] of mv) if (n >= 10 && n <= 700) add(`move:${name}`, "moves", name, n >= 120 ? 2 : 3, (f) => f.moves.has(name));
  return out;
}

let cats: PdkCategory[] | null = null;
export function allCategories(): PdkCategory[] {
  return (cats ??= build());
}
const BY_ID = new Map<string, PdkCategory>();
export function categoryById(id: string): PdkCategory | undefined {
  if (!BY_ID.size) for (const c of allCategories()) BY_ID.set(c.id, c);
  return BY_ID.get(id);
}

let max = 0;
const maxId = () => (max ||= allFacts().reduce((a, f) => Math.max(a, f.id), 0));
const members = new Map<string, Uint8Array>();
/** A category's members as a flag per species id. */
export function membersOf(cat: PdkCategory): Uint8Array {
  let m = members.get(cat.id);
  if (!m) {
    m = new Uint8Array(maxId() + 1);
    for (const f of allFacts()) if (cat.test(f)) m[f.id] = 1;
    members.set(cat.id, m);
  }
  return m;
}
