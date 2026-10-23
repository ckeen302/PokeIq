import dexData from "@/data/pokedex.json";
import detailsData from "@/data/pokedex-details.json";
import movesData from "@/data/moves.json";
import ouData from "@/data/smogon/gen9ou.json";
import { GENERATION_REGIONS } from "@/lib/pokemon/constants";
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
  /** How the Pokémon's next stage(s) evolve from it: lower-cased methods. */
  evolvesBy: string[];
  hasEvolution: boolean;
  chainSize: number;
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
}

const FOSSILS = new Set([138, 139, 140, 141, 142, 345, 346, 347, 348, 408, 409, 410, 411, 564, 565, 566, 567, 696, 697, 698, 699, 880, 881, 882, 883]);
const FORM_REGION: Record<string, string> = { alola: "Alola", galar: "Galar", hisui: "Hisui", paldea: "Paldea" };
const FORM_LABEL: Record<string, string> = { alola: "an Alolan", galar: "a Galarian", hisui: "a Hisuian", paldea: "a Paldean" };
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
const ouNames = new Set((ouData as { pokemon: { species: string }[] }).pokemon.map((p) => p.species.split("-")[0].toLowerCase()));

let table: Facts[] | null = null;
export function allFacts(): Facts[] {
  if (table) return table;
  const children = new Map<number, number[]>();
  const sizes = new Map<number, number>();
  for (const p of dex) {
    sizes.set(p.chain, (sizes.get(p.chain) ?? 0) + 1);
    if (p.evolvesFrom) children.set(p.evolvesFrom, [...(children.get(p.evolvesFrom) ?? []), p.id]);
  }
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
      evolvesBy: kids.flatMap((k) => (details[k]?.evolution ?? []).map((m) => m.toLowerCase())),
      hasEvolution: kids.length > 0,
      chainSize: sizes.get(p.chain) ?? 1,
      moves: new Set((d?.learnset?.moves ?? []).map((m) => moveNames[m[0]]?.name).filter((n): n is string => !!n)),
      ou: ouNames.has(p.name.toLowerCase()),
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
        ...(key && { gen: FORM_GEN[key], region: FORM_REGION[key] }),
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
const itemEvo = (m: string) => /^use |holding/.test(m) && !/trade/.test(m);


function build(): PdkCategory[] {
  const out: PdkCategory[] = [];
  const add = (id: string, family: PdkFamily, label: string, tier: 1 | 2 | 3, test: (f: Facts) => boolean, group = id) => out.push({ id, family, label, tier, group, test });
  for (const t of TYPE_LIST) add(`type:${t}`, "types", `${cap(t)} type`, 1, (f) => f.types.includes(t));
  add("types:dual", "types", "Dual-typed", 1, (f) => f.types.length === 2, "typecount");
  add("types:single", "types", "Monotype (one type only)", 1, (f) => f.types.length === 1, "typecount");
  for (const [gen, region] of Object.entries(GENERATION_REGIONS)) add(`region:${gen}`, "regions", `Introduced in ${region}`, 1, (f) => f.gen === Number(gen));
  add("region:hisui", "regions", "Introduced in Hisui (Hisuian forms)", 3, (f) => f.region === "Hisui");
  for (const [key, region] of Object.entries(FORM_REGION)) add(`form:${key}`, "regions", `Has ${FORM_LABEL[key]} form`, 2, (f) => f.formRegions.includes(region));
  add("evo:basic", "evolution", "Basic (first stage)", 1, (f) => f.stage === 1, "stage");
  add("evo:stage2", "evolution", "Second stage", 1, (f) => f.stage === 2, "stage");
  add("evo:stage3", "evolution", "Third stage", 2, (f) => f.stage === 3, "stage");
  add("evo:notfull", "evolution", "Can still evolve", 1, (f) => !f.fullyEvolved, "evolves");
  add("evo:full", "evolution", "Fully evolved", 1, (f) => f.fullyEvolved, "evolves");
  add("evo:none", "evolution", "No evolution line (doesn't evolve)", 2, (f) => f.chainSize === 1, "evolves");
  add("evo:item", "evolution", "Evolves by using an item", 2, (f) => f.evolvesBy.some(itemEvo));
  add("evo:stone", "evolution", "Evolves with a stone", 2, (f) => f.evolvesBy.some((m) => /stone/.test(m)));
  add("evo:trade", "evolution", "Evolves by trade", 2, (f) => f.evolvesBy.some((m) => /trade/.test(m)));
  add("evo:friend", "evolution", "Evolves with friendship", 2, (f) => f.evolvesBy.some((m) => /friendship/.test(m)));
  add("evo:level", "evolution", "Evolves by level", 2, (f) => f.evolvesBy.some((m) => /^level \d/.test(m)));
  add("evo:branch", "evolution", "Has a branching evolution", 3, (f) => f.evolvesBy.length > 1);
  add("evo:three", "evolution", "In a three-stage line", 2, (f) => f.chainSize >= 3);
  add("other:legendary", "other", "Legendary", 1, (f) => f.legendary, "legend");
  add("other:mythical", "other", "Mythical", 2, (f) => f.mythical, "legend");
  add("other:lm", "other", "Legendary or Mythical", 2, (f) => f.legendary || f.mythical, "legend");
  add("other:fossil", "other", "Fossil Pokémon", 2, (f) => f.fossil);
  add("other:baby", "other", "Baby Pokémon", 2, (f) => f.isBaby);
  add("other:mega", "other", "Has a Mega Evolution", 2, (f) => f.hasMega);
  add("other:gmax", "other", "Has a Gigantamax form", 2, (f) => f.hasGmax);
  add("other:ou", "other", "OU-relevant (Gen 9 OU)", 3, (f) => f.ou);
  add("ability:hidden", "abilities", "Has a hidden ability", 1, (f) => f.abilities.some((a) => a.hidden));
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
  for (const [name, n] of ab) if (n >= 10) add(`ability:${name}`, "abilities", `Has the ability ${cap(name.replace(/-/g, " "))}`, n >= 40 ? 2 : 3, (f) => f.abilities.some((a) => a.name === name));
  for (const [name, n] of mv) if (n >= 10 && n <= 700) add(`move:${name}`, "moves", `Learns ${name} (SV)`, n >= 120 ? 2 : 3, (f) => f.moves.has(name));
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
