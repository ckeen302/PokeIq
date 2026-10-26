import "server-only";
import formsData from "@/data/about-forms.json";
import detailsData from "@/data/pokedex-details.json";
import { POKEDEX, getPokemon, type Pokemon } from "@/lib/pokemon/pokedex";
import { NEA_CATEGORIES, NEA_DEXES, neaCategory } from "./categories";
import type { NeaFormKind, NeaTarget } from "./types";

/**
 * Which Pokémon each Name 'em All category holds, in grid order, worked out
 * from the committed Pokédex snapshot (src/data). Server-side only: the page
 * gets just its own category's slots.
 */

/** The headline Legendaries (box legends and their kin); every other Legendary in the data is a sub-legendary. */
export const RESTRICTED_LEGENDARY_IDS: readonly number[] = [
  150, // Mewtwo
  249, 250, // Lugia, Ho-Oh
  382, 383, 384, // Kyogre, Groudon, Rayquaza
  483, 484, 487, // Dialga, Palkia, Giratina
  643, 644, 646, // Reshiram, Zekrom, Kyurem
  716, 717, 718, // Xerneas, Yveltal, Zygarde
  789, 790, 791, 792, 800, // Cosmog, Cosmoem, Solgaleo, Lunala, Necrozma
  888, 889, 890, 898, // Zacian, Zamazenta, Eternatus, Calyrex
  1007, 1008, 1024, // Koraidon, Miraidon, Terapagos
];

export const ULTRA_BEAST_IDS: readonly number[] = [793, 794, 795, 796, 797, 798, 799, 803, 804, 805, 806];

export const PARADOX_IDS: readonly number[] = [984, 985, 986, 987, 988, 989, 990, 991, 992, 993, 994, 995, 1005, 1006, 1009, 1010, 1020, 1021, 1022, 1023];

type FormRow = [id: number, species: number, slug: string, name: string, kind: string];
const FORMS = formsData as FormRow[];
const DETAILS = detailsData as unknown as Record<string, { dexNumbers: { dex: string; number: number }[] }>;

const REGION_WORDS = ["alola", "galar", "hisui", "paldea"];

function speciesTarget(p: Pokemon, num = p.id): NeaTarget {
  return { id: p.id, num, species: p.id, name: p.name, slug: p.slug, gen: p.gen };
}

function formTarget(row: FormRow): NeaTarget {
  const [id, speciesId, slug, name, kind] = row;
  const sp = getPokemon(speciesId)!;
  const rest = slug.startsWith(`${sp.slug}-`) ? slug.slice(sp.slug.length + 1).split("-") : slug.split("-").slice(1);
  const region = rest.find((w) => REGION_WORDS.includes(w));
  const qualifier = rest.filter((w) => w !== "mega" && w !== "gmax" && w !== region).join(" ") || undefined;
  return {
    id,
    num: sp.id,
    species: sp.id,
    name: name.replace(/’/g, "'"),
    slug: sp.slug,
    gen: sp.gen,
    form: { kind: kind as NeaFormKind, base: sp.name, ...(region && { region }), ...(qualifier && { qualifier }) },
  };
}

/** Of several forms of one species and kind, the one a bare name means (the first listed: Standard, Amped, Single Strike, Combat Breed). */
const PRIMARY_QUALIFIERS = new Set(["standard", "amped", "single strike", "combat breed"]);

function formTargets(kind: NeaFormKind): NeaTarget[] {
  const list = FORMS.filter((r) => r[4] === kind).map(formTarget);
  for (const t of list) {
    const siblings = list.filter((o) => o.species === t.species && o.form!.region === t.form!.region);
    if (siblings.length > 1 && t.form!.qualifier && PRIMARY_QUALIFIERS.has(t.form!.qualifier)) t.form!.primary = true;
  }
  // National order, forms of one species in the data's order.
  return list.map((t, i) => ({ t, i })).sort((a, b) => a.t.species - b.t.species || a.i - b.i).map(({ t }) => t);
}

function dexTargets(sources: string[]): NeaTarget[] {
  const out: NeaTarget[] = [];
  const seen = new Set<number>();
  let offset = 0;
  for (const source of sources) {
    const part: { p: Pokemon; n: number }[] = [];
    for (const p of POKEDEX) {
      const entry = DETAILS[String(p.id)]?.dexNumbers.find((d) => d.dex === source);
      if (entry) part.push({ p, n: entry.number });
    }
    part.sort((a, b) => a.n - b.n);
    // A multi-part dex (Kalos) numbers its parts one after another.
    const base = offset;
    for (const { p, n } of part) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);
      out.push(speciesTarget(p, base + n));
    }
    offset = out.length ? out[out.length - 1].num : offset;
  }
  return out;
}

const RESTRICTED = new Set(RESTRICTED_LEGENDARY_IDS);
const UB = new Set(ULTRA_BEAST_IDS);
const PARADOX = new Set(PARADOX_IDS);

function build(id: string): NeaTarget[] {
  const species = (test: (p: Pokemon) => boolean) => POKEDEX.filter(test).map((p) => speciesTarget(p));
  if (id === "all") return species(() => true);
  const gen = /^gen-(\d)$/.exec(id);
  if (gen) return species((p) => p.gen === Number(gen[1]));
  const type = /^type-([a-z]+)$/.exec(id);
  if (type) return species((p) => (p.types as string[]).includes(type[1]));
  switch (id) {
    case "legendary":
      return species((p) => p.legendary);
    case "sub-legendary":
      return species((p) => p.legendary && !RESTRICTED.has(p.id));
    case "mythical":
      return species((p) => p.mythical);
    case "ultra-beasts":
      return species((p) => UB.has(p.id));
    case "paradox":
      return species((p) => PARADOX.has(p.id));
    case "mega-evolutions":
      return formTargets("mega");
    case "gigantamax":
      return formTargets("gmax");
    case "regional-forms":
      return formTargets("regional");
  }
  const dex = NEA_DEXES.find((d) => d.id === id);
  if (dex) return dexTargets(dex.sources);
  throw new Error(`Unknown Name 'em All category: ${id}`);
}

const cache = new Map<string, NeaTarget[]>();

/** A category's slots in grid order, or null for an unknown category. */
export function neaTargets(id: string): NeaTarget[] | null {
  if (!neaCategory(id)) return null;
  let list = cache.get(id);
  if (!list) cache.set(id, (list = build(id)));
  return list;
}

/** How many slots each category has (the hub page's counts). */
export function neaCounts(): Record<string, number> {
  return Object.fromEntries(NEA_CATEGORIES.map((c) => [c.id, neaTargets(c.id)!.length]));
}

/** Species names outside a species category, so the game can say "not in this one" (none for form categories). */
export function neaOutsiders(id: string): string[] {
  const list = neaTargets(id);
  if (!list || list.some((t) => t.form)) return [];
  const inside = new Set(list.map((t) => t.species));
  return POKEDEX.filter((p) => !inside.has(p.id)).map((p) => p.name);
}
