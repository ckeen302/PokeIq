import { CAT, GENERATIONS, TYPES, type Mon, type TypeName } from "./types";

/**
 * The Tier List Maker's templates: each one a rule over the roster, never a hand-made list, so new Pokémon join the
 * right ones by themselves. Every template has its own page (/tools/tier-list/<slug>) and offers all four modes.
 */

export type TemplateGroup = "all" | "generation" | "category" | "form" | "type" | "game" | "custom";

export interface Template {
  slug: string;
  group: TemplateGroup;
  /** Message key under templates.* for its name ("gen" and "type" take {n} / {type}). */
  label: "everyPokemon" | "everyForm" | "gen" | "starters" | "legendaries" | "mythicals" | "pseudo" | "megas" | "regional" | "paradox" | "ultraBeasts" | "eeveelutions" | "fossils" | "type" | "champions" | "za" | "custom";
  gen?: number;
  type?: TypeName;
  /** A Pokémon that stands for the template on its card (National Dex number). */
  face: number;
  filter: (m: Mon) => boolean;
}

const species = (m: Mon) => !m.f;
const has = (bit: number) => (m: Mon) => (m.c & bit) !== 0;

/** Each generation's first starter, for the generation cards. */
const GEN_FACE = [0, 25, 155, 258, 448, 571, 658, 778, 887, 1000];
const TYPE_FACE: Record<TypeName, number> = {
  normal: 143, fire: 6, water: 9, electric: 25, grass: 3, ice: 144, fighting: 68, poison: 94, ground: 445,
  flying: 18, psychic: 150, bug: 123, rock: 248, ghost: 94, dragon: 149, dark: 197, steel: 376, fairy: 700,
};

export const TEMPLATES: readonly Template[] = [
  { slug: "every-pokemon", group: "all", label: "everyPokemon", face: 25, filter: species },
  { slug: "starters", group: "category", label: "starters", face: 4, filter: (m) => species(m) && has(CAT.starter)(m) },
  { slug: "legendaries", group: "category", label: "legendaries", face: 384, filter: (m) => species(m) && has(CAT.legendary)(m) },
  { slug: "mythicals", group: "category", label: "mythicals", face: 151, filter: (m) => species(m) && has(CAT.mythical)(m) },
  { slug: "pseudo-legendaries", group: "category", label: "pseudo", face: 149, filter: (m) => species(m) && has(CAT.pseudo)(m) },
  { slug: "eeveelutions", group: "category", label: "eeveelutions", face: 197, filter: (m) => species(m) && has(CAT.eeveelution)(m) },
  { slug: "paradox", group: "category", label: "paradox", face: 1007, filter: (m) => species(m) && has(CAT.paradox)(m) },
  { slug: "ultra-beasts", group: "category", label: "ultraBeasts", face: 793, filter: (m) => species(m) && has(CAT.ultraBeast)(m) },
  { slug: "fossils", group: "category", label: "fossils", face: 142, filter: (m) => species(m) && has(CAT.fossil)(m) },
  { slug: "megas", group: "form", label: "megas", face: 6, filter: (m) => m.f === "mega" },
  { slug: "regional-forms", group: "form", label: "regional", face: 37, filter: (m) => m.f === "regional" },
  { slug: "every-form", group: "all", label: "everyForm", face: 201, filter: () => true },
  { slug: "legends-z-a", group: "game", label: "za", face: 716, filter: has(CAT.za) },
  { slug: "champions", group: "game", label: "champions", face: 445, filter: has(CAT.champions) },
  ...GENERATIONS.map((g): Template => ({ slug: `gen-${g}`, group: "generation", label: "gen", gen: g, face: GEN_FACE[g], filter: (m) => species(m) && m.g === g })),
  ...TYPES.map((t): Template => ({ slug: `${t}-type`, group: "type", label: "type", type: t, face: TYPE_FACE[t], filter: (m) => species(m) && m.t.includes(t) })),
  { slug: "custom", group: "custom", label: "custom", face: 132, filter: () => false },
];

const BY_SLUG = new Map(TEMPLATES.map((t) => [t.slug, t]));
export const getTemplate = (slug: string | null | undefined): Template | undefined => (slug ? BY_SLUG.get(slug) : undefined);
export const DEFAULT_TEMPLATE = "starters";

/** The template's Pokémon, in roster (National Dex) order. */
export function templateMons(t: Template, mons: readonly Mon[]): Mon[] {
  return mons.filter(t.filter);
}
